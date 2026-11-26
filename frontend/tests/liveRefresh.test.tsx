import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_CHANGED, REFRESH_INTERVAL, useLiveRefresh } from '../src/hooks/useLiveRefresh';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('Live data without signing out', () => {
  it('loads once, refreshes in the background, and refreshes after a mutation', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useLiveRefresh(loader));
    await flush();
    expect(loader).toHaveBeenCalledWith(false);
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL); });
    expect(loader).toHaveBeenLastCalledWith(true);
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event(DATA_CHANGED)); await vi.advanceTimersByTimeAsync(350); });
    expect(loader).toHaveBeenCalledTimes(3);
  });
  it('does not overlap requests even when focus and reconnect fire together', async () => {
    let complete!: () => void;
    const loader = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useLiveRefresh(loader));
    await flush();
    act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    expect(loader).toHaveBeenCalledTimes(1);
    await act(async () => { complete(); });
    expect(result.current.refreshing).toBe(false);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    await act(async () => { complete(); });
  });
  it('retains the last successful timestamp on failure and recovers on reconnect', async () => {
    const loader = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useLiveRefresh(loader));
    await flush();
    const previous = result.current.lastUpdated;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe('Offline');
    expect(result.current.lastUpdated).toBe(previous);
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(result.current.error).toBeNull();
  });
  it('pauses hidden-page polling and releases all timers on unmount', async () => {
    const loader = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useLiveRefresh(loader));
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL * 2); });
    expect(loader).toHaveBeenCalledTimes(1);
    unmount();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL); });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
