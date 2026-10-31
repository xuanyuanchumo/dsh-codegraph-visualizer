/**
 * 会话工作区跟随（session-follow）契约 —— 图谱画布默认工作区 = 对话会话工作区。
 *
 * 缺陷现场：当前对话在 dsh-codegraph-visualizer，面板却加载 dsh-anic 的图。
 * 三层根因（详见 src/client/runtime/sessionFollow.ts 头注）：宿主 `/workspace`
 * 返回 registry 首条；WorkspaceBootstrap 轮询强制覆盖；面板从不消费会话身份。
 *
 * 宿主证据（asar 0.2.1-rc.2）：conversation.view 渲染在 session scope，
 * `standardProps` 自动注入 `sessionId` + `useSessions`（官方 FilesBody 用
 * `useSessions(s => s.byId[sessionId]?.cwd)` 读会话工作区）。
 *
 * 契约矩阵：
 * A. readSessionCwd 降级（scope 缺失/行无 cwd/选择器抛错 ⇒ null，宁缺勿猜）
 * B. useSessionWorkspaceFollow 三态（跟随 / pin 粘性 / 不可知维持现状）
 * C. pinWorkspace 语义（写 pin 走 setCurrentWorkspace 的身份失效；解除 pin
 *    立即对齐会话工作区；pin 不进持久化）
 * D. 轮询抑制（WorkspaceBootstrap 在 pin 在场时不得覆盖）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readSessionCwd, useSessionWorkspaceFollow, type SessionScopeProps } from '../../src/client/runtime/sessionFollow.ts';
import { useGraphStore } from '../../src/client/store/graphStore.ts';

/** 构造宿主会话 scope props（useSessions 是 zustand/shallow 可调用形态）。 */
function makeScopeProps(sessionId: string | undefined, cwd: string | undefined | null): SessionScopeProps {
  if (sessionId === undefined) return { sessionId: undefined, useSessions: undefined };
  const byId: Record<string, { cwd?: string } | undefined> = {
    [sessionId]: cwd === null ? undefined : { cwd: cwd ?? undefined },
  };
  return {
    sessionId,
    useSessions: (selector: (s: { byId: Record<string, { cwd?: string } | undefined> }) => unknown) =>
      selector({ byId }),
  };
}

function resetStore(): void {
  useGraphStore.setState({
    currentWorkspace: '.',
    sessionWorkspace: null,
    pinnedWorkspace: null,
    graphEtag: null,
    diffResult: null,
  });
}

beforeEach(() => {
  resetStore();
});

describe('readSessionCwd — 降级纪律', () => {
  it('A1 会话 scope 完整 → cwd', () => {
    expect(readSessionCwd(makeScopeProps('s1', 'D:\\proj\\a'))).toBe('D:\\proj\\a');
  });

  it('A2 sessionId 缺失 → null（sessionless 渲染）', () => {
    expect(readSessionCwd(makeScopeProps(undefined, 'D:\\x'))).toBeNull();
  });

  it('A3 useSessions 非 function（旧代宿主）→ null', () => {
    expect(readSessionCwd({ sessionId: 's1', useSessions: 'not-a-fn' as unknown as SessionScopeProps['useSessions'] })).toBeNull();
  });

  it('A4 行缺失（未知会话 id）→ null', () => {
    expect(readSessionCwd(makeScopeProps('s1', null))).toBeNull();
  });

  it('A5 行有但 cwd 空/缺失 → null', () => {
    expect(readSessionCwd(makeScopeProps('s1', undefined))).toBeNull();
  });

  it('A6 选择器抛错 → null（不炸渲染）', () => {
    expect(readSessionCwd({
      sessionId: 's1',
      useSessions: () => { throw new Error('host gone'); },
    })).toBeNull();
  });

  it('A7 props 整体缺失 → null', () => {
    expect(readSessionCwd(null)).toBeNull();
    expect(readSessionCwd(undefined)).toBeNull();
  });
});

describe('useSessionWorkspaceFollow — 跟随三态', () => {
  it('B1 跟随态：会话 cwd 写真相源并对齐 currentWorkspace', () => {
    const props = makeScopeProps('s1', 'D:\\proj\\session-ws');
    renderHook(() => useSessionWorkspaceFollow(props));
    const s = useGraphStore.getState();
    expect(s.sessionWorkspace).toBe('D:\\proj\\session-ws');
    expect(s.currentWorkspace).toBe('D:\\proj\\session-ws');
  });

  it('B2 pin 在场：真相源更新但 currentWorkspace 不被覆盖', () => {
    useGraphStore.setState({ pinnedWorkspace: 'D:\\proj\\pinned' });
    const props = makeScopeProps('s1', 'D:\\proj\\session-ws');
    renderHook(() => useSessionWorkspaceFollow(props));
    const s = useGraphStore.getState();
    expect(s.sessionWorkspace).toBe('D:\\proj\\session-ws');
    expect(s.currentWorkspace).toBe('.'); // 未被跟随覆盖
  });

  it('B3 cwd 不可知：真相源为 null 且 currentWorkspace 维持现状', () => {
    useGraphStore.setState({ currentWorkspace: 'D:\\proj\\existing' });
    renderHook(() => useSessionWorkspaceFollow(makeScopeProps(undefined, undefined)));
    const s = useGraphStore.getState();
    expect(s.sessionWorkspace).toBeNull();
    expect(s.currentWorkspace).toBe('D:\\proj\\existing');
  });

  it('B4 cwd 变化（会话切换）：跟随切换', () => {
    let cwd: string | null = 'D:\\proj\\one';
    const props: SessionScopeProps = {
      sessionId: 's1',
      useSessions: (selector: (s: { byId: Record<string, { cwd?: string } | undefined> }) => unknown) =>
        selector({ byId: { s1: cwd === null ? undefined : { cwd } } }),
    };
    const { rerender } = renderHook(() => useSessionWorkspaceFollow(props));
    expect(useGraphStore.getState().currentWorkspace).toBe('D:\\proj\\one');
    act(() => { cwd = 'D:\\proj\\two'; });
    rerender();
    expect(useGraphStore.getState().currentWorkspace).toBe('D:\\proj\\two');
  });

  it('B5 同值幂等：cwd 不变时不产生多余写（currentWorkspace 引用稳定）', () => {
    const props = makeScopeProps('s1', 'D:\\proj\\same');
    renderHook(() => useSessionWorkspaceFollow(props));
    const spy = vi.spyOn(useGraphStore.getState(), 'setCurrentWorkspace');
    renderHook(() => useSessionWorkspaceFollow(props));
    // 第二次渲染 cwd 相同 ⇒ setCurrentWorkspace 不再被调
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('pinWorkspace — 粘性覆盖语义', () => {
  it('C1 写 pin 走 setCurrentWorkspace：etag/diff 作废 + currentWorkspace 更新', () => {
    useGraphStore.setState({
      graphEtag: 'stale' as unknown as string,
      // DiffState 形状无关紧要（断言只看「被作废为 null」），但 must 类型完整。
      diffResult: { from: 'a', to: 'b', nodes: [], edges: [], index: {} as never, requestedAt: 0, granularity: 'file' } as never,
    });
    act(() => { useGraphStore.getState().pinWorkspace('D:\\proj\\pinned'); });
    const s = useGraphStore.getState();
    expect(s.pinnedWorkspace).toBe('D:\\proj\\pinned');
    expect(s.currentWorkspace).toBe('D:\\proj\\pinned');
    expect(s.graphEtag).toBeNull();
    expect(s.diffResult).toBeNull();
  });

  it('C2 解除 pin：回到会话工作区（一次到位，不等轮询）', () => {
    useGraphStore.setState({
      pinnedWorkspace: 'D:\\proj\\pinned',
      currentWorkspace: 'D:\\proj\\pinned',
      sessionWorkspace: 'D:\\proj\\session-ws',
    });
    act(() => { useGraphStore.getState().pinWorkspace(null); });
    const s = useGraphStore.getState();
    expect(s.pinnedWorkspace).toBeNull();
    expect(s.currentWorkspace).toBe('D:\\proj\\session-ws');
  });

  it('C3 解除 pin 但会话不可知：仅解除，currentWorkspace 维持', () => {
    useGraphStore.setState({
      pinnedWorkspace: 'D:\\proj\\pinned',
      currentWorkspace: 'D:\\proj\\pinned',
      sessionWorkspace: null,
    });
    act(() => { useGraphStore.getState().pinWorkspace(null); });
    const s = useGraphStore.getState();
    expect(s.pinnedWorkspace).toBeNull();
    expect(s.currentWorkspace).toBe('D:\\proj\\pinned');
  });

  it('C4 解除 pin 且会话=当前：currentWorkspace 不变（同值不写）', () => {
    useGraphStore.setState({
      pinnedWorkspace: 'D:\\x',
      currentWorkspace: 'D:\\proj\\session-ws',
      sessionWorkspace: 'D:\\proj\\session-ws',
    });
    act(() => { useGraphStore.getState().pinWorkspace(null); });
    expect(useGraphStore.getState().currentWorkspace).toBe('D:\\proj\\session-ws');
  });
});

describe('持久化边界 — pin 不进 persist', () => {
  it('D1 partialize 不含 pinnedWorkspace / sessionWorkspace（刷新后回跟随态）', async () => {
    // 直接断言源码形状：partialize 的字段清单里没有这两个键。
    // 用 path.resolve（jsdom 环境下 import.meta.url 是 http: scheme，URL 不可用）。
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const src = readFileSync(resolve(dirname('.'), 'src/client/store/graphStore.ts'), 'utf-8');
    const pz = src.slice(src.indexOf('partialize:'), src.indexOf('partialize:') + 800);
    expect(pz).not.toMatch(/pinnedWorkspace/);
    expect(pz).not.toMatch(/sessionWorkspace/);
    // 而持久化身份字段仍在（防扫描区间漂移的反向自检）。
    expect(pz).toMatch(/currentWorkspace/);
  });
});
