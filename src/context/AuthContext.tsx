import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { api } from '../services/api';
import { safeStorage } from '../utils/storage';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setupCompleted: boolean;
  loading: boolean;
  systemRecordsCount: number;
  login: (email: string, pass: string) => Promise<{ success: boolean; user: User; token: string; mustChangePassword?: boolean }>;
  setupSuperAdmin: (email: string, pass: string, name?: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
  refreshCurrentUser: () => Promise<void>;
  setAuthData: (user: User, token: string) => void;
  refreshSystemStatus: () => Promise<void>;
  showFirstLoginPasswordModal: boolean;
  setShowFirstLoginPasswordModal: (show: boolean) => void;
  tempSessionPassword: string;
  setTempSessionPassword: (pwd: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    () => safeStorage.getItem('plsms_auth_token')
  );
  const [setupCompleted, setSetupCompleted] = useState<boolean>(true);
  const [systemRecordsCount, setSystemRecordsCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [showFirstLoginPasswordModal, setShowFirstLoginPasswordModal] = useState<boolean>(false);
  const [tempSessionPassword, setTempSessionPassword] = useState<string>('');

  const refreshSystemStatus = async () => {
    try {
      const status = await api.getSystemStatus();
      setSetupCompleted(status.setupCompleted);
      setSystemRecordsCount(status.recordsCount);
    } catch (err: any) {
      console.warn('[PLSMS Auth] Notice fetching system status (will retry):', err?.message || err);
    }
  };

  const refreshCurrentUser = async () => {
    const storedToken = safeStorage.getItem('plsms_auth_token');
    if (!storedToken) return;
    try {
      const res = await api.getCurrentUser();
      if (res?.user) {
        setUser(res.user);
        setToken(storedToken);
      }
    } catch (err: any) {
      // Clear token ONLY on explicit HTTP 401 Unauthorized
      if (err?.status === 401 || err?.response?.status === 401) {
        console.warn('[PLSMS Auth] Stored token expired (HTTP 401). Clearing session.');
        safeStorage.removeItem('plsms_auth_token');
        setUser(null);
        setToken(null);
      }
    }
  };

  // Verify auth on mount and listen to window focus
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await api.waitForServerReady(8000);
      await refreshSystemStatus();

      const storedToken = safeStorage.getItem('plsms_auth_token');
      if (storedToken) {
        setToken(storedToken);
        try {
          const res = await api.getCurrentUser();
          setUser(res.user);
          if (res.user?.mustChangePassword) {
            setShowFirstLoginPasswordModal(true);
          }
        } catch (err: any) {
          // AUTH SESSION RESILIENCE:
          // Clear token ONLY for an actual HTTP 401 Unauthorized authentication response.
          // Do NOT log out the user for ERR_CONNECTION_REFUSED, network timeout, 502, 503, server restart, or transient network failure!
          const isExplicitUnauthorized =
            err?.status === 401 ||
            err?.response?.status === 401;

          if (isExplicitUnauthorized) {
            console.warn('[PLSMS Auth] Stored token explicitly unauthorized or expired (HTTP 401). Clearing session.');
            safeStorage.removeItem('plsms_auth_token');
            setUser(null);
            setToken(null);
          } else {
            console.warn('[PLSMS Auth] Server temporarily unreachable or starting up. Preserving login session token:', err?.message || err);
            // Retain token in storage and state so session is never lost across server restarts
          }
        }
      }
      setLoading(false);
    };

    init();

    const handleFocus = () => {
      refreshCurrentUser();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Automatic recovery when server returns after temporary restart or network drop
  useEffect(() => {
    if (!token || user) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.getCurrentUser();
        if (res?.user) {
          setUser(res.user);
          refreshSystemStatus();
          clearInterval(interval);
        }
      } catch (err: any) {
        if (err?.status === 401 || err?.response?.status === 401) {
          safeStorage.removeItem('plsms_auth_token');
          setUser(null);
          setToken(null);
          clearInterval(interval);
        }
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [token, user]);

  const login = async (email: string, pass: string) => {
    const res = await api.login({ email, password: pass });
    safeStorage.setItem('plsms_auth_token', res.token);
    setUser(res.user);
    setToken(res.token);
    await refreshSystemStatus();
    if (res.mustChangePassword || (res as any).isFirstLogin || res.user?.mustChangePassword) {
      setTempSessionPassword(pass);
      setShowFirstLoginPasswordModal(true);
    }
    return res;
  };

  const setAuthData = (newUser: User, newToken: string) => {
    safeStorage.setItem('plsms_auth_token', newToken);
    setUser(newUser);
    setToken(newToken);
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const setupSuperAdmin = async (email: string, pass: string, name?: string) => {
    const res = await api.setupSuperAdmin({ email, password: pass, name });
    safeStorage.setItem('plsms_auth_token', res.token);
    setUser(res.user);
    setToken(res.token);
    setSetupCompleted(true);
    await refreshSystemStatus();
  };

  const logout = () => {
    safeStorage.removeItem('plsms_auth_token');
    setUser(null);
    setToken(null);
    setShowFirstLoginPasswordModal(false);
    setTempSessionPassword('');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        setupCompleted,
        loading,
        systemRecordsCount,
        login,
        setupSuperAdmin,
        logout,
        updateUser,
        refreshCurrentUser,
        setAuthData,
        refreshSystemStatus,
        showFirstLoginPasswordModal,
        setShowFirstLoginPasswordModal,
        tempSessionPassword,
        setTempSessionPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
