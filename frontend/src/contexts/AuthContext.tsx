import React, { createContext, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { UserProfile } from '../types';
import {
  apiRequest,
  apiUrl,
  clearStoredTokens,
  getStoredTokens,
  setStoredTokens,
} from '../lib/api';
import { checkServerConnectivity } from '../lib/offlineDb';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  isOnline: boolean;
  refreshConnectivity: () => Promise<boolean>;
  login: (username: string, password: string, portal?: 'staff' | 'beneficiary') => Promise<UserProfile>;
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
  const [loading, setLoading] = useState(() => {
    const hasToken = Boolean(getStoredTokens().accessToken);
    const hasCachedUser = Boolean(localStorage.getItem(USER_CACHE_KEY));
    return hasToken && !hasCachedUser;
  });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const refreshConnectivity = async (): Promise<boolean> => {
    const reachable = await checkServerConnectivity();
    setIsOnline(reachable);
    return reachable;
  };

  useEffect(() => {
    refreshConnectivity().catch(() => undefined);

    const handleOnline = () => {
      refreshConnectivity().catch(() => undefined);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleOnline);
    const interval = setInterval(() => {
      refreshConnectivity().catch(() => undefined);
    }, 30000);

    const networkListener = Capacitor.isNativePlatform()
      ? Network.addListener('networkStatusChange', (status) => {
          if (status.connected) {
            window.dispatchEvent(new Event('khorak:data-changed'));
            refreshConnectivity().catch(() => undefined);
          } else {
            setIsOnline(false);
          }
        })
      : null;

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleOnline);
      clearInterval(interval);
      networkListener?.then((h) => h.remove()).catch(() => undefined);
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
      if (res?.data?.id) {
        setUser(res.data);
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.data));
      }
    } catch (err: unknown) {
      const anyErr = err as { status?: number };
      if (anyErr.status === 401 || anyErr.status === 403) {
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

  useEffect(() => {
    const updateSession = (event: StorageEvent) => {
      if (event.key !== USER_CACHE_KEY && event.key !== null) return;
      try { setUser(JSON.parse(localStorage.getItem(USER_CACHE_KEY) || 'null')); }
      catch { setUser(null); }
    };
    window.addEventListener('storage', updateSession);
    return () => window.removeEventListener('storage', updateSession);
  }, []);

  const login = async (username: string, password: string, portal?: 'staff' | 'beneficiary'): Promise<UserProfile> => {
    const res = await apiRequest<{
      success: boolean;
      data: { accessToken: string; refreshToken: string; user: UserProfile };
    }>('/api/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ username, password, portal }),
    });

    if (!res?.data?.accessToken || !res?.data?.user) {
      throw new Error('Authentication server returned an unexpected empty response.');
    }

    setStoredTokens(res.data.accessToken, res.data.refreshToken);
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.data.user));
    setUser(res.data.user);

    return res.data.user;
  };

  const logout = async () => {
    const { accessToken, refreshToken } = getStoredTokens();
    // Clear local session immediately so Sign Out UI feels instant
    clearStoredTokens();
    setUser(null);

    if (accessToken) {
      fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  };

  return React.createElement(
    AuthContext.Provider,
    { value: { user, loading, isOnline, refreshConnectivity, login, logout, refreshUser } },
    children
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

