/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { logger } from '../../../src/shared/Logger.ts';

import { setupRejectionHandler } from '../../../src/client/runtime/RejectionHandler.ts';

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

describe('setupRejectionHandler', () => {
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
    setupRejectionHandler(ctx);
    expect(effectSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('registers unhandledrejection listener via ctx.effect', () => {
    const { ctx } = createCtx();
    setupRejectionHandler(ctx);
    expect(addSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
  });

  it('handler logs warn and calls preventDefault', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupRejectionHandler(ctx);
    const handler = addSpy.mock.calls[0]![1] as (e: PromiseRejectionEvent) => void;
    const preventDefault = vi.fn();
    handler({ reason: 'oops', preventDefault } as unknown as PromiseRejectionEvent);
    expect(warnSpy).toHaveBeenCalledWith('client', 'unhandled promise rejection', 'oops');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('cleanup removes the listener', () => {
    const { ctx, disposers } = createCtx();
    setupRejectionHandler(ctx);
    const handler = addSpy.mock.calls[0]![1] as (e: PromiseRejectionEvent) => void;
    disposers[0]!();
    expect(removeSpy).toHaveBeenCalledWith('unhandledrejection', handler);
  });
});