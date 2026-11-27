import { Capacitor } from '@capacitor/core';

// Both web and native builds use this same backend origin.
const NATIVE_API_CONFIGURED = Boolean(import.meta.env.VITE_API_BASE_URL);
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  ''
).replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (Capacitor.isNativePlatform() && !NATIVE_API_CONFIGURED) {
    throw new Error('Set VITE_API_BASE_URL to the shared backend URL and rebuild the app.');
  }
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly isOffline: boolean;

  constructor(message: string, status: number, code: string, isOffline = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.isOffline = isOffline;
  }
}

const ACCESS_KEY = 'khorak_access_token';
const REFRESH_KEY = 'khorak_refresh_token';

export function getStoredTokens() {
  return {
    accessToken: localStorage.getItem(ACCESS_KEY),
    refreshToken: localStorage.getItem(REFRESH_KEY),
  };
}

export function setStoredTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearStoredTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem('khorak_user_profile');
}

let refreshingPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshingPromise) return refreshingPromise;
  const { refreshToken } = getStoredTokens();
  if (!refreshToken) return null;

  refreshingPromise = (async () => {
    try {
      const res = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) clearStoredTokens();
        return null;
      }
      const json = await res.json().catch(() => null);
      if (!json?.data?.accessToken || !json?.data?.refreshToken) {
        clearStoredTokens();
        return null;
      }
      setStoredTokens(json.data.accessToken, json.data.refreshToken);
      return json.data.accessToken as string;
    } catch {
      return null;
    } finally {
      refreshingPromise = null;
    }
  })();

  return refreshingPromise;
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit & { skipAuth?: boolean }
): Promise<T> {
  const { accessToken } = getStoredTokens();
  const isFormData = options?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options?.headers as Record<string, string> | undefined),
  };

  if (!options?.skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  const targetUrl = apiUrl(path);
  try {
    response = await fetch(targetUrl, { cache: 'no-store', ...options, headers, signal: options?.signal ?? AbortSignal.timeout(45000) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new ApiError('The server is taking longer than expected. Please refresh to try again.', 0, 'REQUEST_TIMEOUT', true);
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK_OFFLINE', true);
  }

  if (response.status === 401 && !options?.skipAuth) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers.Authorization = `Bearer ${newAccess}`;
      try {
        response = await fetch(targetUrl, { cache: 'no-store', ...options, headers, signal: options?.signal ?? AbortSignal.timeout(45000) });
      } catch {
        throw new ApiError('Network unavailable', 0, 'NETWORK_OFFLINE', true);
      }
    }
  }

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = json?.error?.message || `Request failed (${response.status})`;
    const code = json?.error?.code || 'API_ERROR';
    throw new ApiError(msg, response.status, code, false);
  }
  if (!json || typeof json !== 'object') {
    throw new ApiError(
      'Server returned an invalid or non-JSON response. Please check backend connectivity.',
      response.status || 502,
      'INVALID_JSON_RESPONSE',
      false
    );
  }

  const method = (options?.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method) && !path.startsWith('/api/auth/') && path !== '/api/sync/push') {
    window.dispatchEvent(new Event('khorak:data-changed'));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('khorak:data-changed');
      channel.postMessage('refresh');
      channel.close();
    }
  }
  return json as T;
}

