import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value immediately', async () => {
    const { useDebounce } = await import('../../src/client/hooks/index.ts');
    const { result } = renderHook(() => useDebounce('initial', 300));
    expect(result.current).toBe('initial');
  });

  it('updates value after delay', async () => {
    const { useDebounce } = await import('../../src/client/hooks/index.ts');
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'first', delay: 300 },
    });
    rerender({ value: 'second', delay: 300 });
    expect(result.current).toBe('first');
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('second');
  });

  it('does not update before delay expires', async () => {
    const { useDebounce } = await import('../../src/client/hooks/index.ts');
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'first', delay: 500 },
    });
    rerender({ value: 'second', delay: 500 });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('first');
  });

  it('resets timer on rapid changes', async () => {
    const { useDebounce } = await import('../../src/client/hooks/index.ts');
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'a', delay: 300 },
    });
    rerender({ value: 'b', delay: 300 });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ value: 'c', delay: 300 });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe('c');
  });

  it('clears timeout on unmount', async () => {
    const { useDebounce } = await import('../../src/client/hooks/index.ts');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = renderHook(() => useDebounce('value', 300));
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('handles zero delay', async () => {
    const { useDebounce } = await import('../../src/client/hooks/index.ts');
    const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
      initialProps: { value: 'first', delay: 0 },
    });
    rerender({ value: 'second', delay: 0 });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toBe('second');
  });
});

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback at specified interval', async () => {
    const { usePolling } = await import('../../src/client/hooks/index.ts');
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 1000));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('does not call callback when disabled', async () => {
    const { usePolling } = await import('../../src/client/hooks/index.ts');
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 1000, false));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not call callback when interval is zero or negative', async () => {
    const { usePolling } = await import('../../src/client/hooks/index.ts');
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 0));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).not.toHaveBeenCalled();
  });

  it('clears interval on unmount', async () => {
    const { usePolling } = await import('../../src/client/hooks/index.ts');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 1000));
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('skips callback when document is hidden', async () => {
    const { usePolling } = await import('../../src/client/hooks/index.ts');
    const callback = vi.fn();
    const hiddenGetter = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderHook(() => usePolling(callback, 1000));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).not.toHaveBeenCalled();
    hiddenGetter.mockReturnValue(false);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);
    hiddenGetter.mockRestore();
  });

  it('uses latest callback via ref without resetting interval', async () => {
    const { usePolling } = await import('../../src/client/hooks/index.ts');
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 1000), {
      initialProps: { cb: callback1 },
    });
    rerender({ cb: callback2 });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});