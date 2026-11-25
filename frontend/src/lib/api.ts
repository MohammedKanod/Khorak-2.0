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
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearStoredTokens();
        return null;
      }
      const json = await res.json();
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
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError('Network unavailable — device appears offline', 0, 'NETWORK_OFFLINE', true);
  }

  if (response.status === 401 && !options?.skipAuth) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers.Authorization = `Bearer ${newAccess}`;
      try {
        response = await fetch(path, { ...options, headers });
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

  return json as T;
}

