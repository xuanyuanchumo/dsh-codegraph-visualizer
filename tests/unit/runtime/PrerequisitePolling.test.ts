/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { logger } from '../../../src/shared/Logger.ts';

const mocks = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  getState: vi.fn(),
  setPrerequisites: vi.fn(),
}));

vi.mock('../../../src/client/api/index.ts', () => ({
  fetchStatus: mocks.fetchStatus,
}));

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: { getState: mocks.getState },
}));

import { setupPrerequisitePolling } from '../../../src/client/runtime/PrerequisitePolling.ts';

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

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    panelVisible: true,
    prerequisites: { codegraph: false, lens: false, builtin: true },
    setPrerequisites: mocks.setPrerequisites,
    ...overrides,
  };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('setupPrerequisitePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchStatus.mockReset();
    mocks.setPrerequisites.mockReset();
    mocks.getState.mockReset();
    mocks.getState.mockReturnValue(createStore());
  });

  afterEach(() => {
    activeDisposers.forEach((d) => d());
    activeDisposers = [];
    vi.useRealTimers();
  });

  it('initial check calls fetchStatus and setPrerequisites with builtin default true', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: true, lens: false });
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setPrerequisites).toHaveBeenCalledWith({ codegraph: true, lens: false, builtin: true });
  });

  it('uses builtin from status when provided', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: false, lens: true, builtin: false });
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(mocks.setPrerequisites).toHaveBeenCalledWith({ codegraph: false, lens: true, builtin: false });
  });

  it('schedules delayed check after PREREQ_INITIAL_DELAY_MS', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: true, lens: false, builtin: true });
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('does not log info when status key unchanged on subsequent check', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: true, lens: false, builtin: true });
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    infoSpy.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it('initial check failure logs warn and does not throw', async () => {
    mocks.fetchStatus.mockRejectedValue(new Error('boom'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'initial status check failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('dispose before delayed check prevents subsequent check', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: true, lens: false, builtin: true });
    const { ctx, disposers } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    disposers[0]!();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('interval skips when document.hidden is true', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: false, lens: false, builtin: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('interval skips when panelVisible is false', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: false, lens: false, builtin: true });
    mocks.getState.mockReturnValue(createStore({ panelVisible: false }));
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('interval clears itself when prerequisites satisfied', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: true, lens: true, builtin: true });
    mocks.getState.mockReturnValue(
      createStore({ prerequisites: { codegraph: true, lens: true, builtin: true } }),
    );
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('interval polls checkStatus when prerequisites not satisfied', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: false, lens: false, builtin: true });
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('interval check failure logs warn', async () => {
    let count = 0;
    mocks.fetchStatus.mockImplementation(() => {
      count++;
      if (count <= 2) return Promise.resolve({ codegraph: false, lens: false, builtin: true });
      return Promise.reject(new Error('poll boom'));
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    await vi.advanceTimersByTimeAsync(27000);
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'prereq polling failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('delayed check failure logs warn', async () => {
    let count = 0;
    mocks.fetchStatus.mockImplementation(() => {
      count++;
      if (count === 1) return Promise.resolve({ codegraph: false, lens: false, builtin: true });
      return Promise.reject(new Error('delayed boom'));
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(warnSpy).toHaveBeenCalledWith('client', 'prereq delayed check failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('dispose clears prereq timer and interval', async () => {
    mocks.fetchStatus.mockResolvedValue({ codegraph: false, lens: false, builtin: true });
    const { ctx, disposers } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    disposers[0]!();
    disposers[1]!();
    await vi.advanceTimersByTimeAsync(60000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
  });
});