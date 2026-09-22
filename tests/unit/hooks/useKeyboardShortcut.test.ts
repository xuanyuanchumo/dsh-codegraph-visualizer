// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcut } from '../../../src/client/hooks/useKeyboardShortcut.ts';

function fireKey(key: string, opts: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    altKey: opts.alt ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应在按下匹配键时调用回调', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('Escape', cb));
    fireKey('Escape');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('不应在按下不匹配键时调用回调', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('Escape', cb));
    fireKey('Enter');
    expect(cb).not.toHaveBeenCalled();
  });

  it('应支持 Ctrl 组合键', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('s', cb, { ctrl: true }));
    fireKey('s', { ctrl: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('不应在未按 Ctrl 时触发 Ctrl 组合键', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('s', cb, { ctrl: true }));
    fireKey('s');
    expect(cb).not.toHaveBeenCalled();
  });

  it('应支持 Shift 组合键', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('A', cb, { shift: true }));
    fireKey('A', { shift: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('应支持 Alt 组合键', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('F', cb, { alt: true }));
    fireKey('F', { alt: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('应忽略 INPUT 元素中的按键（非 Escape/Slash）', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('a', cb));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(cb).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('应忽略 TEXTAREA 元素中的按键（非 Escape/Slash）', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('a', cb));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);
    expect(cb).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('Escape 键即使在 INPUT 中也应触发', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('Escape', cb));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(cb).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });

  it('Slash 键即使在 INPUT 中也应触发', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('/', cb));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(cb).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });

  it('应支持 preventDefault=false 选项', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('a', cb, { preventDefault: false }));
    const event = fireKey('a');
    expect(event.defaultPrevented).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('默认应调用 preventDefault', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('a', cb));
    const event = fireKey('a');
    expect(event.defaultPrevented).toBe(true);
  });

  it('键名应不区分大小写', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('a', cb));
    fireKey('A');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('卸载时应移除事件监听器', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcut('a', cb));
    unmount();
    fireKey('a');
    expect(cb).not.toHaveBeenCalled();
  });
});