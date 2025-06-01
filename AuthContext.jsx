// src/context/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "firebase/auth";
import { auth } from '../firebase/firebaseConfig';

// Create the Context
const AuthContext = createContext({
  currentUser: null,
  loading: true,
  error: null,
  signInWithGoogle: async () => {},
  logout: async () => {},
  clearError: () => {}
});

// Custom hook to use the Auth Context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Auth Provider Component
export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Refs to track component state
  const mountedRef = useRef(true);
  const authStateListenerRef = useRef(null);
  
  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Enhanced sign in with Google
  const signInWithGoogle = useCallback(async (rememberMe = true) => {
    clearError();
    
    try {
      // Set persistence based on user preference
      await setPersistence(
        auth, 
        rememberMe ? browserLocalPersistence : browserSessionPersistence
      );
      
      const provider = new GoogleAuthProvider();
      
      // Add custom parameters for better UX
      provider.setCustomParameters({
        prompt: 'select_account', // Always show account selection
        access_type: 'offline', // Get refresh token
        include_granted_scopes: 'true' // Incremental auth
      });
      
      // Perform sign in
      const result = await signInWithPopup(auth, provider);
      
      // Log successful sign in
      console.log('User signed in successfully:', result.user.email);
      
      // Get additional user info if needed
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      // You can store the token for additional API calls if needed
      if (token) {
        sessionStorage.setItem('google_access_token', token);
      }
      
      return result.user;
    } catch (error) {
      console.error('Sign in error:', error);
      
      // Handle specific error cases
      let errorMessage = 'Failed to sign in. ';
      
      switch (error.code) {
        case 'auth/popup-closed-by-user':
          errorMessage += 'Sign in cancelled.';
          break;
        case 'auth/popup-blocked':
          errorMessage += 'Please allow popups for this site.';
          break;
        case 'auth/cancelled-popup-request':
          errorMessage += 'Another sign in request is already pending.';
          break;
        case 'auth/network-request-failed':
          errorMessage += 'Network error. Please check your connection.';
          break;
        case 'auth/too-many-requests':
          errorMessage += 'Too many failed attempts. Please try again later.';
          break;
        case 'auth/user-disabled':
          errorMessage += 'This account has been disabled.';
          break;
        case 'auth/operation-not-allowed':
          errorMessage += 'Google sign in is not enabled. Please contact support.';
          break;
        default:
          errorMessage += error.message || 'Please try again.';
      }
      
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [clearError]);

  // Enhanced logout with cleanup
  const logout = useCallback(async () => {
    clearError();
    
    try {
      // Clear any stored tokens
      sessionStorage.removeItem('google_access_token');
      
      // Sign out from Firebase
      await signOut(auth);
      
      console.log('User signed out successfully');
    } catch (error) {
      console.error('Logout error:', error);
      
      let errorMessage = 'Failed to sign out. ';
      
      if (error.code === 'auth/network-request-failed') {
        errorMessage += 'Network error. You may still be signed out locally.';
      } else {
        errorMessage += error.message || 'Please try again.';
      }
      
      setError(errorMessage);
      
      // Even if sign out fails, clear local user state
      setCurrentUser(null);
      
      throw new Error(errorMessage);
    }
  }, [clearError]);

  // Set up auth state listener
  useEffect(() => {
    mountedRef.current = true;
    
    // Clean up any existing listener
    if (authStateListenerRef.current) {
      authStateListenerRef.current();
    }
    
    console.log('Setting up auth state listener...');
    
    // Set up the auth state listener
    authStateListenerRef.current = onAuthStateChanged(
      auth,
      async (user) => {
        if (!mountedRef.current) return;
        
        try {
          if (user) {
            // User is signed in
            console.log('Auth state changed: User signed in', user.email);
            
            // You can fetch additional user data here if needed
            // For example, from Firestore user profile
            
            // Get fresh token to ensure it's valid
            const token = await user.getIdToken();
            
            // Store user with additional metadata
            const userWithMetadata = {
              ...user,
              // Add any additional user data here
              metadata: {
                lastSignInTime: user.metadata.lastSignInTime,
                creationTime: user.metadata.creationTime,
              }
            };
            
            setCurrentUser(userWithMetadata);
          } else {
            // User is signed out
            console.log('Auth state changed: User signed out');
            setCurrentUser(null);
          }
        } catch (error) {
          console.error('Error in auth state change handler:', error);
          setError('Failed to verify authentication status.');
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        // Handle errors in the auth state listener
        console.error('Auth state listener error:', error);
        
        if (!mountedRef.current) return;
        
        let errorMessage = 'Authentication error. ';
        
        if (error.code === 'auth/network-request-failed') {
          errorMessage += 'Please check your internet connection.';
        } else {
          errorMessage += 'Please refresh the page.';
        }
        
        setError(errorMessage);
        setLoading(false);
      }
    );
    
    // Cleanup function
    return () => {
      mountedRef.current = false;
      
      if (authStateListenerRef.current) {
        authStateListenerRef.current();
        authStateListenerRef.current = null;
      }
    };
  }, []); // Empty dependency array - only run once on mount

  // Auto-clear errors after 10 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        clearError();
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // Context value with all auth functionality
  const value = {
    currentUser,
    loading,
    error,
    signInWithGoogle,
    logout,
    clearError,
    // Additional helpers
    isAuthenticated: !!currentUser,
    isEmailVerified: currentUser?.emailVerified || false,
  };

  // Show loading state while checking auth
  if (loading) {
    return (
      <AuthContext.Provider value={value}>
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Verificando autenticación...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};