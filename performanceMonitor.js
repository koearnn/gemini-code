// src/utils/performanceMonitor.js
/**
 * Performance monitoring utility for tracking React app performance
 * Helps identify bottlenecks and optimize rendering
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      renders: new Map(),
      apiCalls: new Map(),
      memoryUsage: [],
      errors: []
    };
    this.isMonitoring = false;
    this.observers = [];
  }

  /**
   * Start monitoring performance
   */
  start() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('🚀 Performance monitoring started');
    
    // Monitor memory usage
    this.memoryInterval = setInterval(() => {
      if (performance.memory) {
        this.metrics.memoryUsage.push({
          timestamp: Date.now(),
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        });
        
        // Keep only last 100 entries
        if (this.metrics.memoryUsage.length > 100) {
          this.metrics.memoryUsage.shift();
        }
      }
    }, 5000); // Check every 5 seconds
    
    // Monitor long tasks
    if ('PerformanceObserver' in window) {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          console.warn(`⚠️ Long task detected: ${entry.duration}ms`, entry);
        }
      });
      
      try {
        this.longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        console.log('Long task monitoring not supported');
      }
    }
  }

  /**
   * Stop monitoring performance
   */
  stop() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    console.log('🛑 Performance monitoring stopped');
    
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
    }
    
    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
    }
  }

  /**
   * Track component render
   * @param {string} componentName - Name of the component
   * @param {number} renderTime - Time taken to render in ms
   */
  trackRender(componentName, renderTime) {
    if (!this.isMonitoring) return;
    
    const renders = this.metrics.renders.get(componentName) || {
      count: 0,
      totalTime: 0,
      maxTime: 0,
      minTime: Infinity,
      lastRender: null
    };
    
    renders.count++;
    renders.totalTime += renderTime;
    renders.maxTime = Math.max(renders.maxTime, renderTime);
    renders.minTime = Math.min(renders.minTime, renderTime);
    renders.lastRender = Date.now();
    renders.avgTime = renders.totalTime / renders.count;
    
    this.metrics.renders.set(componentName, renders);
    
    // Warn if render time is too high
    if (renderTime > 16) { // More than one frame (60fps)
      console.warn(`⚠️ Slow render in ${componentName}: ${renderTime.toFixed(2)}ms`);
    }
  }

  /**
   * Track API call performance
   * @param {string} endpoint - API endpoint
   * @param {number} duration - Duration in ms
   * @param {boolean} success - Whether call was successful
   */
  trackApiCall(endpoint, duration, success = true) {
    if (!this.isMonitoring) return;
    
    const calls = this.metrics.apiCalls.get(endpoint) || {
      count: 0,
      totalTime: 0,
      failures: 0,
      maxTime: 0,
      minTime: Infinity,
      lastCall: null
    };
    
    calls.count++;
    calls.totalTime += duration;
    calls.maxTime = Math.max(calls.maxTime, duration);
    calls.minTime = Math.min(calls.minTime, duration);
    calls.lastCall = Date.now();
    calls.avgTime = calls.totalTime / calls.count;
    
    if (!success) {
      calls.failures++;
    }
    
    this.metrics.apiCalls.set(endpoint, calls);
    
    // Warn if API call is too slow
    if (duration > 3000) { // More than 3 seconds
      console.warn(`⚠️ Slow API call to ${endpoint}: ${duration.toFixed(2)}ms`);
    }
  }

  /**
   * Track errors
   * @param {Error} error - The error object
   * @param {string} context - Where the error occurred
   */
  trackError(error, context) {
    this.metrics.errors.push({
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack,
      context
    });
    
    // Keep only last 50 errors
    if (this.metrics.errors.length > 50) {
      this.metrics.errors.shift();
    }
  }

  /**
   * Get performance report
   * @returns {Object} Performance metrics
   */
  getReport() {
    const report = {
      renders: {},
      apiCalls: {},
      memory: {
        current: null,
        average: null,
        peak: null
      },
      errors: this.metrics.errors.slice(-10) // Last 10 errors
    };
    
    // Process render metrics
    this.metrics.renders.forEach((value, key) => {
      report.renders[key] = {
        count: value.count,
        avgTime: value.avgTime.toFixed(2),
        maxTime: value.maxTime.toFixed(2),
        minTime: value.minTime.toFixed(2),
        lastRender: new Date(value.lastRender).toISOString()
      };
    });
    
    // Process API metrics
    this.metrics.apiCalls.forEach((value, key) => {
      report.apiCalls[key] = {
        count: value.count,
        avgTime: value.avgTime.toFixed(2),
        maxTime: value.maxTime.toFixed(2),
        minTime: value.minTime.toFixed(2),
        failureRate: ((value.failures / value.count) * 100).toFixed(2) + '%',
        lastCall: new Date(value.lastCall).toISOString()
      };
    });
    
    // Process memory metrics
    if (this.metrics.memoryUsage.length > 0) {
      const memoryData = this.metrics.memoryUsage;
      const currentMemory = memoryData[memoryData.length - 1];
      
      report.memory.current = {
        used: (currentMemory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        total: (currentMemory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        limit: (currentMemory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
      };
      
      const avgMemory = memoryData.reduce((sum, m) => sum + m.usedJSHeapSize, 0) / memoryData.length;
      report.memory.average = (avgMemory / 1024 / 1024).toFixed(2) + ' MB';
      
      const peakMemory = Math.max(...memoryData.map(m => m.usedJSHeapSize));
      report.memory.peak = (peakMemory / 1024 / 1024).toFixed(2) + ' MB';
    }
    
    return report;
  }

  /**
   * Log performance report to console
   */
  logReport() {
    const report = this.getReport();
    
    console.group('📊 Performance Report');
    
    console.group('🎨 Component Renders');
    console.table(report.renders);
    console.groupEnd();
    
    console.group('🌐 API Calls');
    console.table(report.apiCalls);
    console.groupEnd();
    
    console.group('💾 Memory Usage');
    console.log('Current:', report.memory.current);
    console.log('Average:', report.memory.average);
    console.log('Peak:', report.memory.peak);
    console.groupEnd();
    
    if (report.errors.length > 0) {
      console.group('❌ Recent Errors');
      report.errors.forEach(error => {
        console.error(`[${new Date(error.timestamp).toISOString()}] ${error.context}:`, error.message);
      });
      console.groupEnd();
    }
    
    console.groupEnd();
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.renders.clear();
    this.metrics.apiCalls.clear();
    this.metrics.memoryUsage = [];
    this.metrics.errors = [];
    console.log('🔄 Performance metrics reset');
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

// Export React hook for component performance tracking
export const usePerformanceTracking = (componentName) => {
  useEffect(() => {
    const startTime = performance.now();
    
    return () => {
      const renderTime = performance.now() - startTime;
      performanceMonitor.trackRender(componentName, renderTime);
    };
  });
};

// Export HOC for component performance tracking
export const withPerformanceTracking = (Component, componentName) => {
  return React.memo((props) => {
    usePerformanceTracking(componentName || Component.displayName || Component.name);
    return <Component {...props} />;
  });
};

// Export the singleton instance
export default performanceMonitor;