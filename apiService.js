// src/services/apiService.js
import { onAuthStateChanged } from "firebase/auth";
import { auth } from '../firebase/firebaseConfig';

// URLs de API Gateway desde variables de entorno
const API_GATEWAY_GENERATE_URL = import.meta.env.VITE_API_GATEWAY_URL;
const API_GATEWAY_ENCRYPT_URL = import.meta.env.VITE_ENCRYPT_CHAT_API_URL;
const API_GATEWAY_DECRYPT_URL = import.meta.env.VITE_DECRYPT_CHAT_API_URL;

// Token cache to avoid unnecessary token refreshes
let tokenCache = {
  token: null,
  expiryTime: null,
  refreshPromise: null
};

// Request queue for debouncing
const requestQueue = new Map();
const DEBOUNCE_DELAY = 300; // ms

// Response cache for duplicate requests
const responseCache = new Map();
const CACHE_TTL = 5000; // 5 seconds

/**
 * Debounce function for API calls
 * Prevents rapid-fire requests to the same endpoint
 */
function debounceRequest(key, fn, delay = DEBOUNCE_DELAY) {
  return new Promise((resolve, reject) => {
    const existing = requestQueue.get(key);
    
    if (existing) {
      clearTimeout(existing.timeout);
      existing.promises.push({ resolve, reject });
    } else {
      requestQueue.set(key, {
        promises: [{ resolve, reject }],
        timeout: null
      });
    }
    
    const entry = requestQueue.get(key);
    
    entry.timeout = setTimeout(async () => {
      try {
        const result = await fn();
        entry.promises.forEach(p => p.resolve(result));
      } catch (error) {
        entry.promises.forEach(p => p.reject(error));
      } finally {
        requestQueue.delete(key);
      }
    }, delay);
  });
}

/**
 * Cache response with TTL
 */
function cacheResponse(key, response) {
  responseCache.set(key, {
    data: response,
    timestamp: Date.now()
  });
  
  // Auto-cleanup after TTL
  setTimeout(() => {
    responseCache.delete(key);
  }, CACHE_TTL);
}

/**
 * Get cached response if valid
 */
function getCachedResponse(key) {
  const cached = responseCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  responseCache.delete(key);
  return null;
}

/**
 * Gets the current user's ID token with automatic refresh handling.
 * Implements token caching to minimize unnecessary Firebase calls.
 * @returns {Promise<string|null>} The current user's ID token or null if not authenticated
 */
const getCurrentUserToken = async () => {
  // If we have a valid cached token, return it immediately
  if (tokenCache.token && tokenCache.expiryTime && Date.now() < tokenCache.expiryTime) {
    return tokenCache.token;
  }

  // If a refresh is already in progress, wait for it
  if (tokenCache.refreshPromise) {
    return tokenCache.refreshPromise;
  }

  // Create a new refresh promise to prevent concurrent refreshes
  tokenCache.refreshPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      
      if (user) {
        try {
          // Force refresh to get a fresh token
          const token = await user.getIdToken(true);
          
          // Cache the token with a 50-minute validity (tokens expire after 60 minutes)
          tokenCache.token = token;
          tokenCache.expiryTime = Date.now() + (50 * 60 * 1000);
          tokenCache.refreshPromise = null;
          
          resolve(token);
        } catch (error) {
          console.error("Error getting ID token:", error);
          tokenCache.token = null;
          tokenCache.expiryTime = null;
          tokenCache.refreshPromise = null;
          reject(error);
        }
      } else {
        // No user logged in
        tokenCache.token = null;
        tokenCache.expiryTime = null;
        tokenCache.refreshPromise = null;
        resolve(null);
      }
    }, (error) => {
      console.error("Auth state change error:", error);
      tokenCache.refreshPromise = null;
      reject(error);
    });
  });

  return tokenCache.refreshPromise;
};

/**
 * Clears the token cache. Should be called on logout.
 */
export const clearTokenCache = () => {
  tokenCache.token = null;
  tokenCache.expiryTime = null;
  tokenCache.refreshPromise = null;
};

/**
 * Makes an authenticated API request with automatic retry on auth failures.
 * Includes request deduplication and response caching.
 * @param {string} url - The API endpoint URL
 * @param {object} options - Fetch options (method, body, etc.)
 * @param {number} retryCount - Number of retries attempted (internal use)
 * @param {boolean} useCache - Whether to use response caching
 * @returns {Promise<Response>} The fetch response
 */
const makeAuthenticatedRequest = async (url, options = {}, retryCount = 0, useCache = false) => {
  const maxRetries = 2;
  
  // Create cache key from request
  const cacheKey = useCache ? `${url}:${JSON.stringify(options.body)}` : null;
  
  // Check cache first
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return cached;
    }
  }
  
  try {
    const idToken = await getCurrentUserToken();
    
    if (!idToken) {
      throw new Error("Authentication required. Please sign in.");
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers,
      // Add abort signal for timeout
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    // Handle token expiration and refresh
    if ((response.status === 401 || response.status === 403) && retryCount < maxRetries) {
      console.log(`Auth error (${response.status}), refreshing token and retrying...`);
      
      // Clear the cached token to force a refresh
      tokenCache.token = null;
      tokenCache.expiryTime = null;
      
      // Retry the request with a fresh token
      return makeAuthenticatedRequest(url, options, retryCount + 1, useCache);
    }

    // Cache successful responses if requested
    if (useCache && response.ok) {
      cacheResponse(cacheKey, response.clone());
    }

    return response;
  } catch (error) {
    // Handle timeout errors
    if (error.name === 'AbortError') {
      throw new Error("Request timeout. The server took too long to respond.");
    }
    
    // Network errors or other fetch failures
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error("Network error. Please check your internet connection.");
    }
    throw error;
  }
};

/**
 * Validates API configuration and provides helpful error messages.
 * @param {string} urlKey - The environment variable key
 * @param {string} url - The actual URL value
 * @param {string} serviceName - Human-readable service name
 */
const validateApiUrl = (urlKey, url, serviceName) => {
  if (!url || url.includes("URL_PLACEHOLDER")) {
    const errorMsg = `${serviceName} URL (${urlKey}) is not configured. Please check your environment variables.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
};

/**
 * Gets a response from the Gemini AI bot with debouncing.
 * @param {string} userPrompt - The user's message
 * @returns {Promise<string>} The bot's response text
 */
export const getBotResponse = async (userPrompt) => {
  validateApiUrl('VITE_API_GATEWAY_URL', API_GATEWAY_GENERATE_URL, 'API Gateway for Gemini');
  
  console.log("Fetching bot response from API Gateway:", API_GATEWAY_GENERATE_URL);
  
  // Use debouncing for rapid requests
  return debounceRequest(`bot-response:${userPrompt}`, async () => {
    try {
      const response = await makeAuthenticatedRequest(API_GATEWAY_GENERATE_URL, {
        method: 'POST',
        body: JSON.stringify({ prompt: userPrompt }),
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { message: await response.text() || `API Error: ${response.status}` };
        }
        
        console.error("getBotResponse API Error:", errorData);
        
        // Provide user-friendly error messages
        if (response.status === 429) {
          throw new Error("Too many requests. Please wait a moment and try again.");
        } else if (response.status === 500) {
          throw new Error("Server error. The AI service is temporarily unavailable.");
        } else if (response.status === 400) {
          throw new Error("Invalid request. Please try rephrasing your message.");
        }
        
        throw new Error(errorData.message || `API request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.response) {
        throw new Error("Invalid response format from Gemini API.");
      }
      
      return data.response;
    } catch (error) {
      console.error('Error in getBotResponse:', error);
      
      // Add context to errors for better debugging
      if (error.message.includes('Network error')) {
        throw new Error("Unable to connect to the AI service. Please check your internet connection.");
      }
      
      throw error;
    }
  });
};

/**
 * Encrypts a chat message using Cloud KMS with request batching.
 * @param {string} plaintext - The message to encrypt
 * @returns {Promise<{ciphertext: string, kmsKeyVersionName: string}>} Encrypted data
 */
export const encryptChatMessageAPI = async (plaintext) => {
  validateApiUrl('VITE_ENCRYPT_CHAT_API_URL', API_GATEWAY_ENCRYPT_URL, 'Encrypt chat API');
  
  console.log("Encrypting chat message via API");
  
  try {
    const response = await makeAuthenticatedRequest(API_GATEWAY_ENCRYPT_URL, {
      method: 'POST',
      body: JSON.stringify({ plaintext }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ 
        message: `Encryption API Error: ${response.status} ${response.statusText}` 
      }));
      
      console.error("Encryption API Error Response:", errorData);
      
      if (response.status === 413) {
        throw new Error("Message too large. Please try a shorter message.");
      }
      
      throw new Error(errorData.message || `Encryption failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    // Validate the response format
    if (!result.ciphertext || !result.kmsKeyVersionName) {
      throw new Error("Invalid encryption response format");
    }
    
    return result;
  } catch (error) {
    console.error('Error in encryptChatMessageAPI:', error);
    
    // Wrap technical errors in user-friendly messages
    if (error.message.includes('Network error')) {
      throw new Error("Unable to encrypt message. Please check your connection and try again.");
    }
    
    throw error;
  }
};

/**
 * Decrypts a chat message using Cloud KMS with caching for identical requests.
 * @param {string} ciphertext - The encrypted message
 * @param {string} kmsKeyVersionName - The KMS key version used for encryption
 * @returns {Promise<{plaintext: string}>} Decrypted data
 */
export const decryptChatMessageAPI = async (ciphertext, kmsKeyVersionName) => {
  validateApiUrl('VITE_DECRYPT_CHAT_API_URL', API_GATEWAY_DECRYPT_URL, 'Decrypt chat API');
  
  console.log("Decrypting chat message via API");
  
  // Use caching for decryption since the same message might be requested multiple times
  const cacheKey = `decrypt:${ciphertext}:${kmsKeyVersionName}`;
  
  try {
    const response = await makeAuthenticatedRequest(API_GATEWAY_DECRYPT_URL, {
      method: 'POST',
      body: JSON.stringify({ ciphertext, kmsKeyVersionName }),
    }, 0, true); // Enable caching for decrypt requests

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ 
        message: `Decryption API Error: ${response.status} ${response.statusText}` 
      }));
      
      console.error("Decryption API Error Response:", errorData);
      
      if (response.status === 400) {
        throw new Error("Unable to decrypt message. The message may be corrupted.");
      } else if (response.status === 403) {
        throw new Error("Access denied. You don't have permission to decrypt this message.");
      }
      
      throw new Error(errorData.message || `Decryption failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    // Validate the response format
    if (!result.plaintext) {
      throw new Error("Invalid decryption response format");
    }
    
    return result;
  } catch (error) {
    console.error('Error in decryptChatMessageAPI:', error);
    
    // Wrap technical errors in user-friendly messages
    if (error.message.includes('Network error')) {
      throw new Error("Unable to decrypt message. Please check your connection and try again.");
    }
    
    throw error;
  }
};

/**
 * Batch encrypt multiple messages for better performance
 * @param {Array<string>} messages - Array of messages to encrypt
 * @returns {Promise<Array<{ciphertext: string, kmsKeyVersionName: string}>>}
 */
export const batchEncryptMessages = async (messages) => {
  const results = await Promise.allSettled(
    messages.map(msg => encryptChatMessageAPI(msg))
  );
  
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`Failed to encrypt message ${index}:`, result.reason);
      return null;
    }
  }).filter(Boolean);
};

/**
 * Batch decrypt multiple messages for better performance
 * @param {Array<{ciphertext: string, kmsKeyVersionName: string}>} encryptedMessages
 * @returns {Promise<Array<{plaintext: string}>>}
 */
export const batchDecryptMessages = async (encryptedMessages) => {
  const results = await Promise.allSettled(
    encryptedMessages.map(msg => 
      decryptChatMessageAPI(msg.ciphertext, msg.kmsKeyVersionName)
    )
  );
  
  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`Failed to decrypt message ${index}:`, result.reason);
      return { plaintext: '[Error: Failed to decrypt]' };
    }
  });
};

/**
 * Utility to handle API errors consistently across the application.
 * @param {Error} error - The error to handle
 * @param {string} context - Context about where the error occurred
 * @returns {string} User-friendly error message
 */
export const handleApiError = (error, context) => {
  console.error(`API Error in ${context}:`, error);
  
  // Check for specific error types and provide helpful messages
  if (error.message.includes('Authentication required')) {
    return "Please sign in to continue.";
  } else if (error.message.includes('Network error')) {
    return "Connection error. Please check your internet and try again.";
  } else if (error.message.includes('Too many requests')) {
    return "You're sending messages too quickly. Please slow down.";
  } else if (error.message.includes('Server error')) {
    return "The service is temporarily unavailable. Please try again later.";
  } else if (error.message.includes('timeout')) {
    return "Request timed out. Please try again.";
  }
  
  // Return the error message if it's already user-friendly
  if (error.message && !error.message.includes('API Error')) {
    return error.message;
  }
  
  // Generic fallback
  return `An error occurred in ${context}. Please try again.`;
};

// Clean up caches periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      responseCache.delete(key);
    }
  }
}, 60000); // Clean up every minute