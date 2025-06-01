// src/components/VirtualScrollChat.jsx
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ChatMessage from './ChatMessage';
import TypingIndicator from './TypingIndicator';

/**
 * Virtual Scrolling Chat Component
 * Renders only visible messages for optimal performance with large chat histories
 * 
 * @param {Array} messages - Array of chat messages
 * @param {boolean} isBotReplying - Whether bot is currently typing
 * @param {number} itemHeight - Estimated height of each message item (default: 80px)
 * @param {number} overscan - Number of items to render outside visible area (default: 5)
 */
const VirtualScrollChat = ({ 
  messages, 
  isBotReplying, 
  itemHeight = 80, 
  overscan = 5 
}) => {
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
  
  // Calculate total height of all messages
  const totalHeight = useMemo(() => {
    return messages.length * itemHeight + (isBotReplying ? itemHeight : 0);
  }, [messages.length, itemHeight, isBotReplying]);
  
  // Calculate visible range of messages
  const calculateVisibleRange = useCallback(() => {
    if (!containerHeight) return { start: 0, end: 0 };
    
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(messages.length, start + visibleCount + overscan * 2);
    
    return { start, end };
  }, [scrollTop, containerHeight, itemHeight, overscan, messages.length]);
  
  // Update visible range when scroll position or container size changes
  useEffect(() => {
    const range = calculateVisibleRange();
    setVisibleRange(range);
  }, [calculateVisibleRange]);
  
  // Handle container resize
  useEffect(() => {
    const handleResize = () => {
      if (scrollContainerRef.current) {
        setContainerHeight(scrollContainerRef.current.clientHeight);
      }
    };
    
    handleResize();
    
    const resizeObserver = new ResizeObserver(handleResize);
    if (scrollContainerRef.current) {
      resizeObserver.observe(scrollContainerRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  // Handle scroll events
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    
    const { scrollTop: newScrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    setScrollTop(newScrollTop);
    
    // Check if user is near bottom (within 100px)
    const isNearBottom = scrollHeight - (newScrollTop + clientHeight) < 100;
    setIsAutoScrollEnabled(isNearBottom);
  }, []);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAutoScrollEnabled && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages.length, isAutoScrollEnabled]);
  
  // Render only visible messages
  const visibleMessages = useMemo(() => {
    const { start, end } = visibleRange;
    return messages.slice(start, end).map((msg, index) => ({
      ...msg,
      actualIndex: start + index
    }));
  }, [messages, visibleRange]);
  
  // Calculate offset for visible messages
  const offsetY = visibleRange.start * itemHeight;
  
  return (
    <div 
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-4 md:px-6 pb-4"
      onScroll={handleScroll}
      style={{ height: '100%', position: 'relative' }}
    >
      {/* Total height container */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Visible messages container */}
        <div 
          style={{
            transform: `translateY(${offsetY}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          <div className="flex flex-col space-y-4 max-w-3xl mx-auto">
            {visibleMessages.map((msg) => (
              <div 
                key={msg.id || msg.timestamp} 
                style={{ height: itemHeight }}
                className="flex items-center"
              >
                <ChatMessage msg={msg} />
              </div>
            ))}
            {isBotReplying && (
              <div style={{ height: itemHeight }} className="flex items-center">
                <TypingIndicator />
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Empty state */}
      {messages.length === 0 && !isBotReplying && (
        <div className="text-center text-gray-500 pt-10 text-sm">
          Send a message to start the conversation.
        </div>
      )}
      
      {/* Scroll to bottom button */}
      {!isAutoScrollEnabled && (
        <button
          onClick={() => {
            setIsAutoScrollEnabled(true);
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
            }
          }}
          className="fixed bottom-24 right-10 bg-gray-700 hover:bg-gray-600 text-white rounded-full p-3 shadow-lg transition-all duration-200"
          aria-label="Scroll to bottom"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default VirtualScrollChat;