// src/components/GeminiHero.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { IoSend } from "react-icons/io5";

/**
 * Debounce hook for input validation
 */
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Performance-optimized GeminiHero component with input validation and debouncing
 */
const GeminiHero = React.memo(({ 
  onSendMessage, 
  currentUser, 
  isSending, 
  maxLength = 5000 
}) => {
  const [prompt, setPrompt] = useState('');
  const [validationError, setValidationError] = useState('');
  const [charCount, setCharCount] = useState(0);
  const inputRef = useRef(null);
  const sendTimeoutRef = useRef(null);
  
  const isLoggedIn = !!currentUser;
  const debouncedPrompt = useDebounce(prompt, 300);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (sendTimeoutRef.current) {
        clearTimeout(sendTimeoutRef.current);
      }
    };
  }, []);
  
  // Clear input when component remounts
  useEffect(() => {
    setPrompt('');
    setCharCount(0);
    setValidationError('');
  }, []);
  
  // Validate input with debouncing
  useEffect(() => {
    if (!debouncedPrompt) {
      setValidationError('');
      return;
    }
    
    if (debouncedPrompt.length > maxLength) {
      setValidationError(`Message too long. Maximum ${maxLength} characters.`);
    } else if (debouncedPrompt.trim().length === 0) {
      setValidationError('Message cannot be empty.');
    } else {
      setValidationError('');
    }
  }, [debouncedPrompt, maxLength]);
  
  // Memoized input validation
  const isValidInput = useMemo(() => {
    return prompt.trim().length > 0 && 
           prompt.length <= maxLength && 
           !validationError;
  }, [prompt, maxLength, validationError]);
  
  // Optimized input change handler
  const handleInputChange = useCallback((event) => {
    const newValue = event.target.value;
    setPrompt(newValue);
    setCharCount(newValue.length);
  }, []);
  
  // Memoized send handler with debouncing
  const handleSend = useCallback(() => {
    if (!isLoggedIn || !isValidInput || isSending) {
      return;
    }
    
    // Clear any pending send timeout
    if (sendTimeoutRef.current) {
      clearTimeout(sendTimeoutRef.current);
    }
    
    // Debounce rapid clicks
    sendTimeoutRef.current = setTimeout(() => {
      const trimmedPrompt = prompt.trim();
      if (trimmedPrompt !== '') {
        onSendMessage({ text: trimmedPrompt, sender: 'user' });
        setPrompt('');
        setCharCount(0);
        setValidationError('');
      }
    }, 100);
  }, [isLoggedIn, isValidInput, isSending, prompt, onSendMessage]);
  
  // Optimized keyboard handler
  const handleKeyDown = useCallback((event) => {
    if (!isLoggedIn || isSending) return;
    
    // Handle Enter key
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
    
    // Handle Escape key to clear input
    if (event.key === 'Escape') {
      setPrompt('');
      setCharCount(0);
      setValidationError('');
    }
  }, [isLoggedIn, isSending, handleSend]);
  
  // Focus input on mount if logged in
  useEffect(() => {
    if (isLoggedIn && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoggedIn]);
  
  // Memoized placeholder text
  const placeholderText = useMemo(() => {
    if (!isLoggedIn) return "Please sign in first";
    if (isSending) return "Sending...";
    return "Enter a prompt here";
  }, [isLoggedIn, isSending]);
  
  // Memoized button disabled state
  const isButtonDisabled = useMemo(() => {
    return !isLoggedIn || !isValidInput || isSending;
  }, [isLoggedIn, isValidInput, isSending]);
  
  // Memoized character counter color
  const charCounterColor = useMemo(() => {
    const ratio = charCount / maxLength;
    if (ratio > 0.9) return 'text-red-400';
    if (ratio > 0.8) return 'text-yellow-400';
    return 'text-gray-400';
  }, [charCount, maxLength]);
  
  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="space-y-2">
        {/* Character counter and validation error */}
        <div className="flex justify-between items-center px-2 text-xs">
          <span className={`text-red-400 ${validationError ? 'opacity-100' : 'opacity-0'}`}>
            {validationError || ' '}
          </span>
          <span className={`${charCounterColor} transition-colors`}>
            {charCount} / {maxLength}
          </span>
        </div>
        
        {/* Input container */}
        <div className="relative rounded-full shadow-md flex items-center bg-gray-800 border border-gray-700/50 focus-within:border-blue-500 transition-all duration-200">
          <input
            ref={inputRef}
            type="text"
            id="chat-prompt-input"
            className="bg-transparent text-white placeholder-gray-400 w-full rounded-full py-3 pl-5 pr-16 focus:outline-none transition-all duration-200"
            placeholder={placeholderText}
            value={prompt}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={!isLoggedIn || isSending}
            maxLength={maxLength + 100} // Allow some overflow for better UX
            aria-label="Chat message input"
            aria-invalid={!!validationError}
            aria-describedby={validationError ? "input-error" : undefined}
          />
          
          {/* Loading indicator overlay */}
          {isSending && (
            <div className="absolute inset-0 bg-gray-800/50 rounded-full flex items-center justify-center pointer-events-none">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            </div>
          )}
          
          {/* Send button */}
          <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
            <button
              className={`bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-full p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-all duration-200 transform ${
                isButtonDisabled 
                  ? 'opacity-50 cursor-not-allowed scale-95' 
                  : 'opacity-100 hover:scale-105 active:scale-95'
              }`}
              onClick={handleSend}
              disabled={isButtonDisabled}
              aria-label="Send message"
              title={isButtonDisabled ? "Cannot send message" : "Send message"}
            >
              <IoSend className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        {/* Accessibility error message */}
        {validationError && (
          <span id="input-error" className="sr-only">
            {validationError}
          </span>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  return (
    prevProps.currentUser?.uid === nextProps.currentUser?.uid &&
    prevProps.isSending === nextProps.isSending &&
    prevProps.maxLength === nextProps.maxLength &&
    prevProps.onSendMessage === nextProps.onSendMessage
  );
});

// Add display name for better debugging
GeminiHero.displayName = 'GeminiHero';

export default GeminiHero;