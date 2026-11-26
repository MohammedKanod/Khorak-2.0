import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export const DATA_CHANGED = 'khorak:data-changed';
export const REFRESH_INTERVAL = 10_000;

/** One request at a time; background refresh never replaces an open form. */
export function useLiveRefresh(load: (background: boolean) => Promise<void>) {
  const loader = useRef(load);
  loader.current = load;
  const running = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((background = true): Promise<void> => {
    if (running.current) return running.current;
    if (!mounted.current) return Promise.resolve();
    setRefreshing(true);
    running.current = Promise.resolve().then(() => loader.current(background)).then(() => {
      if (mounted.current) {
        setLastUpdated(new Date());
        setError(null);
      }
    }).catch((err: unknown) => {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Refresh failed');
    }).finally(() => {
      running.current = null;
      if (mounted.current) setRefreshing(false);
    });
    return running.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh(false);
    const onResume = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    // Delay mutation invalidations until the submitting screen has finished its own refresh.
    let mutationTimer: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(onResume, 350);
    };
    const timer = setInterval(onResume, REFRESH_INTERVAL);
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener(DATA_CHANGED, onChange);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DATA_CHANGED) : null;
    if (channel) channel.onmessage = onChange;
    const nativeListener = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh(); })
      : null;
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearTimeout(mutationTimer);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener(DATA_CHANGED, onChange);
      channel?.close();
      nativeListener?.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [refresh]);

  return { refresh, refreshing, lastUpdated, error };
}
