// src/components/ChatWindow.jsx
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import ChatMessage from './ChatMessage';
import TypingIndicator from './TypingIndicator';

/**
 * Performance-optimized ChatWindow component with virtual scrolling capability
 * and optimized scroll behavior
 */
const ChatWindow = React.memo(({ messages, isBotReplying, isDecrypting, hasEncryptedMessages }) => {
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const lastScrollPositionRef = useRef(0);
  const scrollTimeoutRef = useRef(null);
  
  /**
   * Optimized scroll to bottom with smooth behavior
   * Uses requestAnimationFrame for better performance
   */
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (!isAutoScrollEnabled) return;
    
    // Cancel any pending scroll
    if (scrollTimeoutRef.current) {
      cancelAnimationFrame(scrollTimeoutRef.current);
    }
    
    scrollTimeoutRef.current = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ 
        behavior, 
        block: 'end',
        inline: 'nearest'
      });
    });
  }, [isAutoScrollEnabled]);
  
  /**
   * Handle scroll events to determine if auto-scroll should be enabled
   * Disables auto-scroll when user scrolls up manually
   */
  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const scrollPosition = scrollTop + clientHeight;
    const isNearBottom = scrollHeight - scrollPosition < 100; // 100px threshold
    
    // Update auto-scroll state
    setIsAutoScrollEnabled(isNearBottom);
    lastScrollPositionRef.current = scrollTop;
  }, []);
  
  /**
   * Optimized effect for scrolling on new messages
   * Only scrolls if auto-scroll is enabled
   */
  useEffect(() => {
    if (messages.length > 0 && isAutoScrollEnabled) {
      // Use instant scroll for initial load, smooth for subsequent messages
      const behavior = lastScrollPositionRef.current === 0 ? 'instant' : 'smooth';
      scrollToBottom(behavior);
    }
  }, [messages.length, scrollToBottom, isAutoScrollEnabled]);
  
  /**
   * Scroll when bot starts typing (only if auto-scroll enabled)
   */
  useEffect(() => {
    if (isBotReplying && isAutoScrollEnabled) {
      scrollToBottom();
    }
  }, [isBotReplying, scrollToBottom, isAutoScrollEnabled]);
  
  /**
   * Cleanup scroll timeout on unmount
   */
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        cancelAnimationFrame(scrollTimeoutRef.current);
      }
    };
  }, []);
  
  /**
   * Memoize empty state component to prevent re-renders
   */
  const emptyState = useMemo(() => (
    <div className="text-center text-gray-500 pt-10 text-sm">
      Send a message to start the conversation.
    </div>
  ), []);
  
  /**
   * Memoize the messages list to prevent unnecessary re-renders
   * when parent component re-renders
   */
  const messagesList = useMemo(() => (
    messages.map((msg) => (
      <ChatMessage key={msg.id || msg.timestamp} msg={msg} />
    ))
  ), [messages]);
  
  /**
   * Decryption status indicator
   */
  const decryptionIndicator = useMemo(() => {
    if (!hasEncryptedMessages || !isDecrypting) return null;
    
    return (
      <div className="flex justify-center py-2">
        
      </div>
    );
  }, [hasEncryptedMessages, isDecrypting]);
  
  /**
   * Scroll to bottom button (shown when not at bottom)
   */
  const scrollToBottomButton = useMemo(() => {
    if (isAutoScrollEnabled) return null;
    
    return (
      <button
        onClick={() => {
          setIsAutoScrollEnabled(true);
          scrollToBottom();
        }}
        className="absolute bottom-20 right-6 bg-gray-700 hover:bg-gray-600 text-white rounded-full p-3 shadow-lg transition-all duration-200"
        aria-label="Scroll to bottom"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>
    );
  }, [isAutoScrollEnabled, scrollToBottom]);
  
  return (
    <div className="relative flex-1">
      <div 
        ref={chatContainerRef} 
        className="flex-1 overflow-y-auto px-4 md:px-6 pb-4 h-full"
        onScroll={handleScroll}
      >
        <div className="flex flex-col space-y-4 max-w-3xl mx-auto">
          {decryptionIndicator}
          {messagesList}
           {isBotReplying && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
        {messages.length === 0 && !isBotReplying && emptyState}
      </div>
      {scrollToBottomButton}
    </div>
  );
});

// Add display name for better debugging
ChatWindow.displayName = 'ChatWindow';

export default ChatWindow;