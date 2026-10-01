/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: mocks.getState },
}));

import { setupThemeObserver } from '../../../src/client/runtime/ThemeObserver.ts';

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

function captureThemeEvent(): { received: Array<Event>; stop: () => void } {
  const received: Array<Event> = [];
  const handler = (e: Event) => { received.push(e); };
  window.addEventListener(DOM_EVENTS.THEME_CHANGED, handler);
  return { received, stop: () => window.removeEventListener(DOM_EVENTS.THEME_CHANGED, handler) };
}

describe('setupThemeObserver', () => {
  beforeEach(() => {
    mocks.getState.mockReset();
    mocks.setTheme.mockReset();
    mocks.getState.mockReturnValue({ theme: 'light', setTheme: mocks.setTheme });
    document.body.removeAttribute('data-ds-dark-theme');
  });

  afterEach(() => {
    activeDisposers.forEach((d) => d());
    activeDisposers = [];
    document.body.removeAttribute('data-ds-dark-theme');
  });

  it('returns early when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    const effectSpy = vi.fn();
    const ctx = { effect: effectSpy, emit: vi.fn() } as unknown as Context;
    setupThemeObserver(ctx);
    expect(effectSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('switches to dark theme when data-ds-dark-theme attribute added', async () => {
    const cap = captureThemeEvent();
    const { ctx } = createCtx();
    setupThemeObserver(ctx);
    document.body.setAttribute('data-ds-dark-theme', '');
    await vi.waitFor(() => expect(mocks.setTheme).toHaveBeenCalledWith('dark'));
    expect(cap.received.length).toBeGreaterThan(0);
    cap.stop();
  });

  it('switches to light theme when data-ds-dark-theme attribute removed', async () => {
    document.body.setAttribute('data-ds-dark-theme', '');
    mocks.getState.mockReturnValue({ theme: 'dark', setTheme: mocks.setTheme });
    const cap = captureThemeEvent();
    const { ctx } = createCtx();
    setupThemeObserver(ctx);
    document.body.removeAttribute('data-ds-dark-theme');
    await vi.waitFor(() => expect(mocks.setTheme).toHaveBeenCalledWith('light'));
    expect(cap.received.length).toBeGreaterThan(0);
    cap.stop();
  });

  it('does not set theme when already matching', async () => {
    mocks.getState.mockReturnValue({ theme: 'dark', setTheme: mocks.setTheme });
    const { ctx } = createCtx();
    setupThemeObserver(ctx);
    document.body.setAttribute('data-ds-dark-theme', '');
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it('cleanup disconnects observer', async () => {
    const { ctx, disposers } = createCtx();
    setupThemeObserver(ctx);
    disposers[0]!();
    mocks.setTheme.mockClear();
    document.body.setAttribute('data-ds-dark-theme', '');
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });
});