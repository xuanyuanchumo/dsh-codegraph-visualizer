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

  it('应忽略 contenteditable 元素中的按键（非 Escape/Slash）', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('a', cb));
    const div = document.createElement('div');
    // jsdom 不实现 contenteditable 的继承语义，显式补上 isContentEditable；
    // 宿主 DSH 的输入框是 <div class="uV2eYG_input">（J0 Round 12 / BUG-R12-04）。
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
    document.body.appendChild(div);
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    div.dispatchEvent(event);
    expect(cb).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it('Shift+F10 不应在 contenteditable 输入框中触发（J0 Round 12 / BUG-R12-04）', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('F10', cb, { shift: true }));
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
    document.body.appendChild(div);
    const event = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    div.dispatchEvent(event);
    expect(cb).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it('Escape 键即使在 contenteditable 中也应触发', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('Escape', cb));
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
    document.body.appendChild(div);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    div.dispatchEvent(event);
    expect(cb).toHaveBeenCalledTimes(1);
    document.body.removeChild(div);
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

  // cycle-112：`/` 豁免的本意是宿主输入框（BUG-R12-04），却把本插件搜索框也豁免了——
  // 用户输入路径片段（`src/`）时每敲一个 `/` 搜索框就被关掉。目标是 `#graph-search` 时
  // `/` 必须是普通字符（不开、也不关）。上一条用例（无 id 的 input ⇒ 触发）与本条
  // （graph-search ⇒ 不触发）构成一对，只留任何一半都会让另一个方向回归。
  it('Slash 键在本插件搜索框（#graph-search）内不触发（普通字符）', () => {
    const cb = vi.fn();
    renderHook(() => useKeyboardShortcut('/', cb));
    const input = document.createElement('input');
    input.id = 'graph-search';
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(cb).not.toHaveBeenCalled();
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