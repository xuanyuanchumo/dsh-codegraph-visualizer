/**
 * @vitest-environment jsdom
 *
 * `usePanelTier` 的测量路径（cycle-110 / T3）。
 *
 * 纯函数 `resolvePanelTier` 的分档边界由 `tests/unit/panelTierContract.test.ts` 钉住，
 * 这里只覆盖**接线**：ResizeObserver 回调是否真的把宽度喂进档位、没有 RO 时是否
 * 退回首帧测量、以及外部 ref 复用（不新建 DOM 节点）是否成立。
 *
 * 为什么必须真的挂载：jsdom 里 `clientWidth` 恒为 0，只有显式 stub（RO 或
 * `clientWidth`）才能让档位离开 `wide`；不挂载就写成的断言只能证明「初始值正确」。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';

import { usePanelTier, resolvePanelTier, PANEL_TIER_NARROW_PX, PANEL_TIER_COMPACT_PX } from '../../src/client/hooks/usePanelTier.ts';

/** 可手动触发的 ResizeObserver 替身。 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) { this.observed.push(target); }
  unobserve() { /* no-op */ }
  disconnect() { this.disconnected = true; }
  emit(width: number) {
    this.callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

function Probe({ onTier }: { onTier: (tier: string, sameNode: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tier = usePanelTier(ref);
  onTier(tier, ref.current === null || ref.current === document.querySelector('#probe'));
  return <div id="probe" ref={ref} data-tier={tier} />;
}

const originalRO = globalThis.ResizeObserver;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
  vi.restoreAllMocks();
});

describe('usePanelTier', () => {
  it('starts wide before any measurement arrives', () => {
    render(<Probe onTier={() => {}} />);
    expect(document.querySelector('#probe')!.getAttribute('data-tier')).toBe('wide');
  });

  it('observes the caller ref and follows ResizeObserver updates', () => {
    render(<Probe onTier={() => {}} />);
    const observer = FakeResizeObserver.instances[0];
    expect(observer).toBeDefined();
    // 观察的是调用方持有的那个节点（同一个元素，不新建 ref）
    expect(observer!.observed[0]).toBe(document.querySelector('#probe'));

    act(() => { observer!.emit(PANEL_TIER_NARROW_PX - 1); });
    expect(document.querySelector('#probe')!.getAttribute('data-tier')).toBe('narrow');

    act(() => { observer!.emit(PANEL_TIER_COMPACT_PX - 1); });
    expect(document.querySelector('#probe')!.getAttribute('data-tier')).toBe('compact');

    act(() => { observer!.emit(1280); });
    expect(document.querySelector('#probe')!.getAttribute('data-tier')).toBe('wide');
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Probe onTier={() => {}} />);
    const observer = FakeResizeObserver.instances[0]!;
    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it('falls back to the first clientWidth measurement when ResizeObserver is missing', () => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = undefined;
    // 无 RO 时唯一的测量来源是挂载时读一次 clientWidth
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(PANEL_TIER_NARROW_PX - 1);
    render(<Probe onTier={() => {}} />);
    expect(document.querySelector('#probe')!.getAttribute('data-tier')).toBe('narrow');
    expect(resolvePanelTier(PANEL_TIER_NARROW_PX - 1)).toBe('narrow');
  });
});
