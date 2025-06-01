// src/hooks/useChatStore.js
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { db } from '../firebase/firebaseConfig';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, updateDoc, arrayUnion, deleteDoc,
  serverTimestamp, Timestamp, limit, startAfter,
  getDocs
} from "firebase/firestore";
import { v4 as uuidv4 } from 'uuid';
import { encryptChatMessageAPI, decryptChatMessageAPI, batchDecryptMessages } from '../services/apiService';

// Configuration constants
const MAX_DECRYPTION_RETRIES = 3;
const DECRYPTION_RETRY_DELAY = 1000; // 1 second
const MAX_CONCURRENT_DECRYPTIONS = 5;
const DECRYPTION_TIMEOUT = 30000; // 30 seconds
const INITIAL_CHAT_LIMIT = 20; // Initial number of chats to load
const CHAT_PAGE_SIZE = 10; // Number of chats to load per page
const MAX_MESSAGES_IN_MEMORY = 1000; // Maximum messages to keep in memory
const CLEANUP_INTERVAL = 300000; // 5 minutes

/**
 * Memory-efficient LRU cache for decrypted messages
 */
class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    // Add to end
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

/**
 * Custom hook for managing chat state with Firestore integration and encryption.
 * Optimized for performance with pagination, batching, and memory management.
 * @param {string} userId - The authenticated user's ID
 */
export const useChatStore = (userId) => {
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  
  // Pagination state
  const lastVisibleChatRef = useRef(null);
  const loadedChatsCountRef = useRef(0);
  
  // References for cleanup
  const unsubscribeChatsRef = useRef(null);
  const decryptionQueuesRef = useRef(new Map());
  const decryptionTimeoutsRef = useRef(new Map());
  const mountedRef = useRef(true);
  const memoryCleanupIntervalRef = useRef(null);
  
  // Optimized memory-efficient caches
  const decryptedMessagesCache = useRef(new LRUCache(MAX_MESSAGES_IN_MEMORY));
  const [decryptingMessageIds, setDecryptingMessageIds] = useState(new Set());
  const retryCountsRef = useRef(new Map());
  
  // Batch processing queue
  const batchDecryptionQueueRef = useRef([]);
  const batchDecryptionTimeoutRef = useRef(null);

  // Memoized decrypted messages map for component access
  const decryptedMessagesMap = useMemo(() => {
    const map = new Map();
    for (const [key, value] of decryptedMessagesCache.current.cache) {
      map.set(key, value);
    }
    return map;
  }, [chats]); // Recalculate when chats change

  // Cleanup effect
  useEffect(() => {
    mountedRef.current = true;
    
    // Set up periodic memory cleanup
    memoryCleanupIntervalRef.current = setInterval(() => {
      cleanupMemory();
    }, CLEANUP_INTERVAL);
    
    return () => {
      mountedRef.current = false;
      
      // Clear all intervals and timeouts
      if (memoryCleanupIntervalRef.current) {
        clearInterval(memoryCleanupIntervalRef.current);
      }
      
      if (batchDecryptionTimeoutRef.current) {
        clearTimeout(batchDecryptionTimeoutRef.current);
      }
      
      decryptionTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      decryptionTimeoutsRef.current.clear();
      
      decryptionQueuesRef.current.clear();
      retryCountsRef.current.clear();
      decryptedMessagesCache.current.clear();
    };
  }, []);

  /**
   * Memory cleanup function to remove old decrypted messages
   */
  const cleanupMemory = useCallback(() => {
    if (!mountedRef.current) return;
    
    console.log(`Memory cleanup: Current cache size ${decryptedMessagesCache.current.size}`);
    
    // Remove retry counts for messages no longer in view
    const visibleMessageIds = new Set();
    chats.forEach(chat => {
      chat.messages?.forEach(msg => visibleMessageIds.add(msg.id));
    });
    
    for (const [msgId] of retryCountsRef.current) {
      if (!visibleMessageIds.has(msgId)) {
        retryCountsRef.current.delete(msgId);
      }
    }
  }, [chats]);

  /**
   * Batch decrypt messages for better performance
   */
  const processBatchDecryption = useCallback(async () => {
    if (!mountedRef.current || batchDecryptionQueueRef.current.length === 0) return;
    
    const batch = batchDecryptionQueueRef.current.splice(0, MAX_CONCURRENT_DECRYPTIONS);
    
    try {
      const encryptedMessages = batch.map(msg => ({
        ciphertext: msg.messageCiphertextKMS,
        kmsKeyVersionName: msg.kmsKeyVersionName
      }));
      
      const results = await batchDecryptMessages(encryptedMessages);
      
      results.forEach((result, index) => {
        const message = batch[index];
        if (mountedRef.current && result.plaintext) {
          decryptedMessagesCache.current.set(message.id, result.plaintext);
          setDecryptingMessageIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(message.id);
            return newSet;
          });
        }
      });
      
      // Force re-render to update decrypted messages
      setChats(prevChats => [...prevChats]);
      
      // Process next batch if any
      if (batchDecryptionQueueRef.current.length > 0) {
        processBatchDecryption();
      }
    } catch (error) {
      console.error('Batch decryption error:', error);
      
      // Fall back to individual decryption
      batch.forEach(msg => decryptSingleMessage(msg));
    }
  }, []);

  /**
   * Add message to batch decryption queue
   */
  const queueBatchDecryption = useCallback((message) => {
    if (!message.messageCiphertextKMS || decryptedMessagesCache.current.has(message.id)) {
      return;
    }
    
    batchDecryptionQueueRef.current.push(message);
    
    // Clear existing timeout
    if (batchDecryptionTimeoutRef.current) {
      clearTimeout(batchDecryptionTimeoutRef.current);
    }
    
    // Process batch after a short delay to collect more messages
    batchDecryptionTimeoutRef.current = setTimeout(() => {
      processBatchDecryption();
    }, 100);
  }, [processBatchDecryption]);

  /**
   * Decrypts a single message with retry logic
   */
  const decryptSingleMessage = useCallback(async (message) => {
    if (!mountedRef.current) return;
    
    const messageId = message.id;
    const retryCount = retryCountsRef.current.get(messageId) || 0;
    
    if (retryCount >= MAX_DECRYPTION_RETRIES) {
      console.warn(`Max retries reached for message ${messageId}`);
      if (mountedRef.current) {
        decryptedMessagesCache.current.set(messageId, "[Error al descifrar - Límite de reintentos alcanzado]");
        setChats(prevChats => [...prevChats]); // Force re-render
      }
      return;
    }

    setDecryptingMessageIds(prev => new Set(prev).add(messageId));

    const timeoutId = setTimeout(() => {
      if (mountedRef.current && decryptingMessageIds.has(messageId)) {
        console.error(`Decryption timeout for message ${messageId}`);
        setDecryptingMessageIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        decryptedMessagesCache.current.set(messageId, "[Error al descifrar - Tiempo agotado]");
        setChats(prevChats => [...prevChats]); // Force re-render
      }
    }, DECRYPTION_TIMEOUT);

    decryptionTimeoutsRef.current.set(messageId, timeoutId);

    try {
      console.log(`Decrypting message ${messageId} (attempt ${retryCount + 1})`);
      
      const { plaintext } = await decryptChatMessageAPI(
        message.messageCiphertextKMS, 
        message.kmsKeyVersionName
      );
      
      clearTimeout(timeoutId);
      decryptionTimeoutsRef.current.delete(messageId);
      
      if (mountedRef.current) {
        decryptedMessagesCache.current.set(messageId, plaintext);
        retryCountsRef.current.delete(messageId);
        setChats(prevChats => [...prevChats]); // Force re-render
      }
    } catch (decryptionError) {
      console.error(`Failed to decrypt message ${messageId}:`, decryptionError);
      
      clearTimeout(timeoutId);
      decryptionTimeoutsRef.current.delete(messageId);
      
      if (mountedRef.current) {
        if (retryCount < MAX_DECRYPTION_RETRIES - 1) {
          const delay = DECRYPTION_RETRY_DELAY * Math.pow(2, retryCount);
          console.log(`Scheduling retry for message ${messageId} in ${delay}ms`);
          
          retryCountsRef.current.set(messageId, retryCount + 1);
          
          setTimeout(() => {
            if (mountedRef.current) {
              setDecryptingMessageIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(messageId);
                return newSet;
              });
              
              decryptSingleMessage(message);
            }
          }, delay);
        } else {
          decryptedMessagesCache.current.set(messageId, "[Error al descifrar]");
          retryCountsRef.current.delete(messageId);
          setChats(prevChats => [...prevChats]); // Force re-render
        }
      }
    } finally {
      if (mountedRef.current) {
        setDecryptingMessageIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
      }
    }
  }, [decryptingMessageIds]);

  /**
   * Public method to decrypt a message if needed
   */
  const decryptMessageIfNeeded = useCallback(async (message) => {
    if (!message.messageCiphertextKMS || 
        !message.kmsKeyVersionName || 
        decryptedMessagesCache.current.has(message.id) || 
        decryptingMessageIds.has(message.id)) {
      return;
    }

    // Use batch decryption for better performance
    queueBatchDecryption(message);
  }, [decryptingMessageIds, queueBatchDecryption]);

  /**
   * Load more chats (pagination)
   */
  const loadMoreChats = useCallback(async () => {
    if (!userId || loadingMore || !hasMore || !lastVisibleChatRef.current) return;
    
    setLoadingMore(true);
    
    try {
      const nextQuery = query(
        collection(db, "chats"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
        startAfter(lastVisibleChatRef.current),
        limit(CHAT_PAGE_SIZE)
      );
      
      const snapshot = await getDocs(nextQuery);
      
      if (snapshot.empty) {
        setHasMore(false);
        return;
      }
      
      const newChats = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId,
          title: data.title || 'Untitled Chat',
          createdAt: data.createdAt instanceof Timestamp 
            ? data.createdAt.toDate() 
            : new Date(data.createdAt?.seconds * 1000 || Date.now()),
          messages: Array.isArray(data.messages) 
            ? data.messages.map(msg => ({
                ...msg,
                id: msg.id || uuidv4(),
                timestamp: msg.timestamp instanceof Timestamp
                  ? msg.timestamp.toDate()
                  : new Date(msg.timestamp?.seconds * 1000 || msg.timestamp || Date.now()),
                sender: msg.originalSender || msg.sender || 'unknown'
              })).sort((a, b) => a.timestamp - b.timestamp)
            : []
        };
      });
      
      lastVisibleChatRef.current = snapshot.docs[snapshot.docs.length - 1];
      loadedChatsCountRef.current += newChats.length;
      
      setChats(prevChats => [...prevChats, ...newChats]);
      setHasMore(snapshot.docs.length === CHAT_PAGE_SIZE);
    } catch (error) {
      console.error('Error loading more chats:', error);
      setError('Failed to load more chats');
    } finally {
      setLoadingMore(false);
    }
  }, [userId, loadingMore, hasMore]);

  // Main effect for initial Firestore subscription
  useEffect(() => {
    if (unsubscribeChatsRef.current) {
      unsubscribeChatsRef.current();
      unsubscribeChatsRef.current = null;
    }

    setError(null);
    decryptedMessagesCache.current.clear();
    setDecryptingMessageIds(new Set());
    decryptionQueuesRef.current.clear();
    retryCountsRef.current.clear();
    lastVisibleChatRef.current = null;
    loadedChatsCountRef.current = 0;
    setHasMore(true);
    
    decryptionTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
    decryptionTimeoutsRef.current.clear();

    if (!userId) {
      setChats([]);
      setLoadingChats(false);
      return;
    }

    setLoadingChats(true);
    
    const chatsQuery = query(
      collection(db, "chats"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(INITIAL_CHAT_LIMIT)
    );

    console.log(`Setting up Firestore listener for user ${userId}`);
    
    unsubscribeChatsRef.current = onSnapshot(
      chatsQuery, 
      (querySnapshot) => {
        if (!mountedRef.current) return;
        
        const fetchedChats = querySnapshot.docs.map((doc, index) => {
          const data = doc.data();
          
          // Track last visible document for pagination
          if (index === querySnapshot.docs.length - 1) {
            lastVisibleChatRef.current = doc;
          }
          
          return {
            id: doc.id,
            userId: data.userId,
            title: data.title || 'Untitled Chat',
            createdAt: data.createdAt instanceof Timestamp 
              ? data.createdAt.toDate() 
              : new Date(data.createdAt?.seconds * 1000 || Date.now()),
            messages: Array.isArray(data.messages) 
              ? data.messages.map(msg => ({
                  ...msg,
                  id: msg.id || uuidv4(),
                  timestamp: msg.timestamp instanceof Timestamp
                    ? msg.timestamp.toDate()
                    : new Date(msg.timestamp?.seconds * 1000 || msg.timestamp || Date.now()),
                  sender: msg.originalSender || msg.sender || 'unknown'
                })).sort((a, b) => a.timestamp - b.timestamp)
              : []
          };
        });
        
        loadedChatsCountRef.current = fetchedChats.length;
        setChats(fetchedChats);
        setLoadingChats(false);
        setError(null);
        setHasMore(querySnapshot.docs.length === INITIAL_CHAT_LIMIT);
        
        console.log(`Loaded ${fetchedChats.length} chats for user ${userId}`);
      },
      (err) => {
        console.error(`Firestore listener error for user ${userId}:`, err);
        
        if (!mountedRef.current) return;
        
        let errorMessage = "Failed to load chats. ";
        
        if (err.code === 'permission-denied') {
          errorMessage += "You don't have permission to access these chats.";
        } else if (err.code === 'unavailable') {
          errorMessage += "The service is temporarily unavailable. Please try again later.";
        } else if (err.code === 'failed-precondition') {
          errorMessage += "Please ensure you have the required indexes set up in Firestore.";
        } else {
          errorMessage += err.message || "An unknown error occurred.";
        }
        
        setError(errorMessage);
        setLoadingChats(false);
        setChats([]);
      }
    );

    return () => {
      if (unsubscribeChatsRef.current) {
        unsubscribeChatsRef.current();
        unsubscribeChatsRef.current = null;
      }
    };
  }, [userId]);

  /**
   * Creates a new chat with an encrypted first message
   */
  const createNewChat = useCallback(async (firstMessageText) => {
    if (!userId) {
      throw new Error("User not authenticated.");
    }
    
    if (!firstMessageText?.trim()) {
      throw new Error("Message cannot be empty.");
    }
    
    setError(null);
    
    console.log(`Creating new chat for user ${userId}`);
    
    try {
      const { ciphertext, kmsKeyVersionName } = await encryptChatMessageAPI(firstMessageText.trim());

      const chatData = {
        userId: userId,
        title: firstMessageText.substring(0, 40) + (firstMessageText.length > 40 ? '...' : ''),
        createdAt: serverTimestamp(),
        messages: []
      };
      
      const chatRef = await addDoc(collection(db, "chats"), chatData);
      console.log(`New chat created with ID: ${chatRef.id}`);

      const firstMessageToStore = {
        id: uuidv4(),
        messageCiphertextKMS: ciphertext,
        kmsKeyVersionName: kmsKeyVersionName,
        originalSender: 'user',
        timestamp: Timestamp.now(),
      };

      await updateDoc(chatRef, {
        messages: arrayUnion(firstMessageToStore)
      });
      
      console.log(`First message added to chat ${chatRef.id}`);
      return chatRef.id;
    } catch (err) {
      console.error("Error creating new chat:", err);
      
      let errorMessage = "Failed to create chat. ";
      
      if (err.message.includes('encrypt')) {
        errorMessage += "Unable to secure your message. ";
      }
      
      errorMessage += err.message || "Please try again.";
      
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [userId]);

  /**
   * Adds an encrypted message to an existing chat
   */
  const addMessageToChat = useCallback(async (chatId, messageData) => {
    if (!userId || !chatId) {
      throw new Error("User or chat ID missing");
    }
    
    if (!messageData?.text?.trim() || !messageData.sender) {
      throw new Error("Invalid message data.");
    }
    
    setError(null);
    
    console.log(`Adding message to chat ${chatId} from ${messageData.sender}`);
    
    try {
      const { ciphertext, kmsKeyVersionName } = await encryptChatMessageAPI(messageData.text.trim());

      const messageToStore = {
        id: uuidv4(),
        messageCiphertextKMS: ciphertext,
        kmsKeyVersionName: kmsKeyVersionName,
        originalSender: messageData.sender,
        timestamp: Timestamp.now(),
      };

      const chatRef = doc(db, "chats", chatId);
      await updateDoc(chatRef, {
        messages: arrayUnion(messageToStore)
      });
      
      console.log(`Message added to chat ${chatId}`);
    } catch (err) {
      console.error(`Error adding message to chat ${chatId}:`, err);
      
      let errorMessage = "Failed to send message. ";
      
      if (err.message.includes('encrypt')) {
        errorMessage += "Unable to secure your message. ";
      } else if (err.code === 'not-found') {
        errorMessage += "Chat not found. ";
      }
      
      errorMessage += err.message || "Please try again.";
      
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [userId]);

  /**
   * Deletes a chat and cleans up associated data
   */
  const deleteChat = useCallback(async (chatIdToDelete) => {
    if (!userId) {
      const errorMsg = "User not authenticated. Cannot delete chat.";
      console.error(errorMsg);
      setError(errorMsg);
      throw new Error(errorMsg);
    }
    
    setError(null);
    
    try {
      console.log(`Deleting chat ${chatIdToDelete}`);
      
      // Clear any decryption data for this chat
      const chatMessages = chats.find(chat => chat.id === chatIdToDelete)?.messages || [];
      chatMessages.forEach(msg => {
        // Remove from cache if exists
        if (decryptedMessagesCache.current.has(msg.id)) {
          // Don't need to manually remove from LRU cache
        }
        
        decryptingMessageIds.delete(msg.id);
        retryCountsRef.current.delete(msg.id);
        
        // Clear any pending timeouts
        const timeoutId = decryptionTimeoutsRef.current.get(msg.id);
        if (timeoutId) {
          clearTimeout(timeoutId);
          decryptionTimeoutsRef.current.delete(msg.id);
        }
      });
      
      // Clear decryption queue for this chat
      decryptionQueuesRef.current.delete(chatIdToDelete);
      
      await deleteDoc(doc(db, "chats", chatIdToDelete));
      console.log(`Chat ${chatIdToDelete} deleted successfully`);
    } catch (err) {
      console.error(`Error deleting chat ${chatIdToDelete}:`, err);
      
      let errorMessage = "Failed to delete chat. ";
      
      if (err.code === 'permission-denied') {
        errorMessage += "You don't have permission to delete this chat.";
      } else if (err.code === 'not-found') {
        errorMessage += "Chat not found.";
      } else {
        errorMessage += err.message || "Please try again.";
      }
      
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [userId, chats, decryptingMessageIds]);

  /**
   * Get memory usage statistics for monitoring
   */
  const getMemoryStats = useCallback(() => {
    return {
      cachedMessages: decryptedMessagesCache.current.size,
      decryptingMessages: decryptingMessageIds.size,
      retryQueue: retryCountsRef.current.size,
      pendingTimeouts: decryptionTimeoutsRef.current.size,
      loadedChats: loadedChatsCountRef.current,
      totalMessages: chats.reduce((sum, chat) => sum + (chat.messages?.length || 0), 0)
    };
  }, [chats, decryptingMessageIds]);

  return {
    chats,
    loadingChats,
    loadingMore,
    hasMore,
    error,
    createNewChat,
    addMessageToChat,
    deleteChat,
    decryptedMessagesMap,
    decryptingMessageIds,
    decryptMessageIfNeeded,
    loadMoreChats,
    getMemoryStats,
  };
};