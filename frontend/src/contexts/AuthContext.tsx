import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserProfile } from '../types';
import {
  apiRequest,
  clearStoredTokens,
  getStoredTokens,
  setStoredTokens,
} from '../lib/api';
import { pullCentreSnapshot, syncOutboxOperations } from '../lib/offlineDb';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  isOnline: boolean;
  login: (username: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_CACHE_KEY = 'khorak_user_profile';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserProfile;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (user?.centreId) {
        syncOutboxOperations(user.centreId).catch(() => undefined);
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user?.centreId]);

  const refreshUser = async () => {
    const { accessToken } = getStoredTokens();
    if (!accessToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await apiRequest<{ success: boolean; data: UserProfile }>('/api/auth/me');
      setUser(res.data);
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.data));
      if (res.data.centreId && navigator.onLine) {
        await pullCentreSnapshot(res.data.centreId);
      }
    } catch (err: unknown) {
      const anyErr = err as { isOffline?: boolean };
      if (!anyErr?.isOffline) {
        clearStoredTokens();
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (username: string, password: string): Promise<UserProfile> => {
    const res = await apiRequest<{
      success: boolean;
      data: { accessToken: string; refreshToken: string; user: UserProfile };
    }>('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ username, password }),
    });

    setStoredTokens(res.data.accessToken, res.data.refreshToken);
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.data.user));
    setUser(res.data.user);

    if (res.data.user.centreId) {
      pullCentreSnapshot(res.data.user.centreId).catch(() => undefined);
    }

    return res.data.user;
  };

  const logout = async () => {
    const { refreshToken } = getStoredTokens();
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Ignore network errors during logout
    }
    clearStoredTokens();
    setUser(null);
  };

  return React.createElement(
    AuthContext.Provider,
    { value: { user, loading, isOnline, login, logout, refreshUser } },
    children
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

