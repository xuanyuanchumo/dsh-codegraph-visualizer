/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';

import { setupPanelEventBridge } from '../../../src/client/runtime/PanelEventBridge.ts';

let activeDisposers: Array<() => void> = [];
function createCtx(): { ctx: Context; disposers: Array<() => void> } {
  const disposers: Array<() => void> = [];
  activeDisposers = disposers;
  const ctx = {
    effect: vi.fn((setup: () => (() => void) | void) => {
      const d = setup();
      if (typeof d === 'function') disposers.push(d);
    }),
    emit: vi.fn(),
  } as unknown as Context;
  return { ctx, disposers };
}

describe('setupPanelEventBridge', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, 'addEventListener');
    removeSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    activeDisposers.forEach((d) => d());
    activeDisposers = [];
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('returns early when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    const effectSpy = vi.fn();
    const ctx = { effect: effectSpy, emit: vi.fn() } as unknown as Context;
    setupPanelEventBridge(ctx);
    expect(effectSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('registers toggle filter and toggle export listeners', () => {
    const { ctx } = createCtx();
    setupPanelEventBridge(ctx);
    const types = addSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain(DOM_EVENTS.TOGGLE_FILTER_PANEL);
    expect(types).toContain(DOM_EVENTS.TOGGLE_EXPORT_MENU);
  });

  it('labels the effect for diagnostics', () => {
    const { ctx } = createCtx();
    setupPanelEventBridge(ctx);
    expect(ctx.effect).toHaveBeenCalledWith(expect.any(Function), 'codegraph: panel event bridge');
  });

  it('toggle filter event clicks filter button when present', () => {
    const btn = document.createElement('button');
    btn.className = 'cg-filter-panel-btn';
    document.body.appendChild(btn);
    const clickSpy = vi.spyOn(btn, 'click');
    const { ctx } = createCtx();
    setupPanelEventBridge(ctx);
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_FILTER_PANEL));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    document.body.removeChild(btn);
  });

  it('toggle filter event does not throw when button absent', () => {
    const { ctx } = createCtx();
    setupPanelEventBridge(ctx);
    expect(() => window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_FILTER_PANEL))).not.toThrow();
  });

  it('toggle export event clicks export button when present', () => {
    const btn = document.createElement('button');
    btn.className = 'cg-export-btn';
    document.body.appendChild(btn);
    const clickSpy = vi.spyOn(btn, 'click');
    const { ctx } = createCtx();
    setupPanelEventBridge(ctx);
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_EXPORT_MENU));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    document.body.removeChild(btn);
  });

  it('toggle export event does not throw when button absent', () => {
    const { ctx } = createCtx();
    setupPanelEventBridge(ctx);
    expect(() => window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_EXPORT_MENU))).not.toThrow();
  });

  it('cleanup removes both listeners', () => {
    const { ctx, disposers } = createCtx();
    setupPanelEventBridge(ctx);
    disposers[0]!();
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.TOGGLE_FILTER_PANEL, expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(DOM_EVENTS.TOGGLE_EXPORT_MENU, expect.any(Function));
  });
});
