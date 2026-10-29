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

/** 归一化后的能力位（真实 `fetchStatus` 的返回形状）。 */
function makeStatus(overrides: Partial<{
  codegraph: boolean; lens: boolean; astSource: boolean; graphSource: boolean;
}> = {}) {
  const astSource = overrides.astSource ?? false;
  return {
    codegraph: overrides.codegraph ?? false,
    lens: overrides.lens ?? false,
    astSource,
    graphSource: overrides.graphSource ?? false,
    builtin: astSource,
  };
}

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
    prerequisites: { codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false },
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

  it('writes the status through unchanged on the initial check', async () => {
    // `fetchStatus` 已经归一化过（`normalizePrerequisiteStatus`），轮询层**不许再兜一次**。
    // 修前这里写的是 `{…, builtin: status.builtin ?? true}` —— 那个 `?? true` 会把
    // 「宿主没应答」重新变成「内置可用」，正是 §61.10 的假叙事在客户端的镜像。
    const status = {
      codegraph: true, lens: false, astSource: true, graphSource: false, builtin: true,
    };
    mocks.fetchStatus.mockResolvedValue(status);
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
    // 同一个对象引用原样写入：连字段都被重建过都算漂移（新增位时最容易漏掉这里）。
    expect(mocks.setPrerequisites).toHaveBeenCalledWith(status);
  });

  it('does not resurrect a true default when every capability is false', async () => {
    // 反向用例：全 false 必须原样落地。若有人在轮询层加回 `?? true`，
    // 这条会读到 `builtin: true` 而变红 —— 上面那条「原样写入」察觉不到这种改动，
    // 因为它的输入本来就是 true。
    const status = {
      codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false,
    };
    mocks.fetchStatus.mockResolvedValue(status);
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(mocks.setPrerequisites).toHaveBeenCalledWith(status);
  });

  it('schedules delayed check after PREREQ_INITIAL_DELAY_MS', async () => {
    mocks.fetchStatus.mockResolvedValue(makeStatus({ codegraph: true }));
    const { ctx } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('does not log info when status key unchanged on subsequent check', async () => {
    mocks.fetchStatus.mockResolvedValue(makeStatus({ codegraph: true }));
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
    mocks.fetchStatus.mockResolvedValue(makeStatus({ codegraph: true }));
    const { ctx, disposers } = createCtx();
    setupPrerequisitePolling(ctx);
    await flush();
    disposers[0]!();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('interval skips when document.hidden is true', async () => {
    mocks.fetchStatus.mockResolvedValue(makeStatus());
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
    mocks.fetchStatus.mockResolvedValue(makeStatus());
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
    mocks.fetchStatus.mockResolvedValue(makeStatus({ codegraph: true, lens: true }));
    mocks.getState.mockReturnValue(
      createStore({ prerequisites: { codegraph: true, lens: true, astSource: true, graphSource: true, builtin: true } }),
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
    mocks.fetchStatus.mockResolvedValue(makeStatus());
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
      if (count <= 2) return Promise.resolve(makeStatus());
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
      if (count === 1) return Promise.resolve(makeStatus());
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
    mocks.fetchStatus.mockResolvedValue(makeStatus());
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