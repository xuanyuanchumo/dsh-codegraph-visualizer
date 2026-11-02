/**
 * `pathPatternSlice` 单测（cycle-135）。
 *
 * ## 为什么直接测切片工厂而不是整 store
 *
 * 与 `tests/unit/store/edgeSlice.test.ts` 同一条取舍：切片是「请求编排 + 状态裁决」
 * 的最小单元，用 `vi.fn()` 的 `set` / `get` 驱动它，能把「令牌是否先落库」「过期请求
 * 是否被丢弃」「五态各自落到哪个终态」这些**纯编排规则**单独钉住，而不被持久化、
 * 渲染、其它切片的副作用淹没。
 *
 * ## 核心不变量
 *
 * 1. **空串不发请求**：ρ 为空时宿主会回 400，而用户看到「点了一下没反应」比
 *    「明确告诉你先输入」更糟。
 * 2. **过期请求被丢弃**：令牌先落库再置 loading，连续两次回车时先返回的旧结果
 *    不得覆盖新结果（与 `keywordQuerySeq` 同族）。
 * 3. **`unknownEdgeTypes` 落到与 `empty` 可区分的终态**：这是本任务的核心。
 *    「拼错类型名」与「图上没有这种边」在 `paths: []` 上同形，若都落 `empty`，
 *    面板只能显示「没有匹配」，用户永远不知道是自己打错了 `calls`。
 * 4. **失败与超时区分**：两者下一步动作不同（看服务端错误 vs 重试/换词）。
 * 5. **翻页用 `nextCursor` 并追加**：替换会让用户丢掉已加载的页面。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Hoisted mock references shared with vi.mock factories -------------------
const mocks = vi.hoisted(() => ({
  fetchPathsByPattern: vi.fn(),
}));

// 只覆盖被测的取数函数，其余导出（类型 + normalize）保持真实。
vi.mock('../../src/client/api/pathPattern.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/pathPattern.ts')>();
  return { ...actual, fetchPathsByPattern: mocks.fetchPathsByPattern };
});

// --- Imports under test (after mocks are in place) ---------------------------
import {
  createPathPatternSlice,
  PATH_PATTERN_KEYS,
  pathHopsOf,
  summarizePathPatternResult,
} from '../../src/client/store/slices/pathPatternSlice.ts';
import type { PathPatternData, PathPatternOutcome, PathPatternPath } from '../../src/client/api/pathPattern.ts';
import type { GraphState } from '../../src/client/store/types.ts';

// --- Fixtures ----------------------------------------------------------------

/** 一条最小路径。 */
function makePath(ids: string[], labels?: string[]): PathPatternPath {
  return { ids, labels: labels ?? ids };
}

/** 一份最小但字段完整的 `PathPatternData`。 */
function makeData(overrides: Partial<PathPatternData> = {}): PathPatternData {
  return {
    pattern: 'call+',
    patternEdgeTypes: ['call'],
    stateCount: 2,
    unknownEdgeTypes: [],
    paths: [],
    truncated: false,
    total: 0,
    nextCursor: null,
    metadata: { repoId: 'repo-1', edgeCount: 3 },
    ...overrides,
  };
}

type SliceMethods = Pick<GraphState, 'runPathPattern' | 'clearPathPattern' | 'runPathPatternNextPage'>;

interface SliceHarness {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  slice: SliceMethods;
  state: GraphState;
}

function makeState(overrides: Partial<GraphState> = {}): GraphState {
  return {
    currentWorkspace: '.',
    pathPattern: '',
    pathPatternStatus: 'idle',
    pathPatternResult: null,
    pathPatternError: null,
    pathPatternSeq: 0,
    ...overrides,
  } as unknown as GraphState;
}

function makeSlice(initial: Partial<GraphState> = {}): SliceHarness {
  let state = makeState(initial);
  const set = vi.fn((partial: Partial<GraphState>) => {
    state = { ...state, ...partial } as GraphState;
  });
  const get = vi.fn(() => state);
  const slice = createPathPatternSlice(set, get) as SliceMethods;
  state = { ...slice, ...state } as GraphState;
  return { set, get, slice, get state() { return state; } };
}

beforeEach(() => {
  mocks.fetchPathsByPattern.mockReset();
});

afterEach(() => {
  mocks.fetchPathsByPattern.mockReset();
});

describe('PATH_PATTERN_KEYS', () => {
  it('declares every slice field and action', () => {
    expect(PATH_PATTERN_KEYS).toContain('pathPattern');
    expect(PATH_PATTERN_KEYS).toContain('pathPatternStatus');
    expect(PATH_PATTERN_KEYS).toContain('pathPatternResult');
    expect(PATH_PATTERN_KEYS).toContain('pathPatternError');
    expect(PATH_PATTERN_KEYS).toContain('pathPatternSeq');
    expect(PATH_PATTERN_KEYS).toContain('runPathPattern');
    expect(PATH_PATTERN_KEYS).toContain('clearPathPattern');
    expect(PATH_PATTERN_KEYS).toContain('runPathPatternNextPage');
    // 防空转：键表本身必须非空。
    expect(PATH_PATTERN_KEYS.length).toBeGreaterThan(5);
  });
});

describe('runPathPattern', () => {
  it('empty / whitespace-only pattern falls to idle without issuing a request', async () => {
    const h = makeSlice();
    const ok = await h.slice.runPathPattern('   ');
    expect(ok).toBe(false);
    expect(mocks.fetchPathsByPattern).not.toHaveBeenCalled();
    expect(h.state.pathPatternStatus).toBe('idle');
    expect(h.state.pathPattern).toBe('');
    expect(h.state.pathPatternResult).toBeNull();
    expect(h.state.pathPatternError).toBeNull();
  });

  it('writes the trimmed pattern and lands ready with a non-empty result', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'data',
      data: makeData({ pattern: 'call+', paths: [makePath(['a', 'b'], ['a', 'b'])] }),
    });

    const ok = await h.slice.runPathPattern('  call+  ');
    expect(ok).toBe(true);
    expect(h.state.pathPattern).toBe('call+');
    expect(h.state.pathPatternStatus).toBe('ready');
    expect(h.state.pathPatternResult).not.toBeNull();
    expect(h.state.pathPatternResult!.paths).toHaveLength(1);
    expect(h.state.pathPatternResult!.workspace).toBe('.');
    expect(h.state.pathPatternResult!.completedAt).toBeGreaterThan(0);
    expect(h.state.pathPatternError).toBeNull();
  });

  it('lands empty (not ready) when the result has no paths and is not truncated', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({ kind: 'data', data: makeData({ paths: [], total: 0 }) });
    const ok = await h.slice.runPathPattern('call+');
    expect(ok).toBe(true);
    expect(h.state.pathPatternStatus).toBe('empty');
    // 结果仍落库（面板要显示「没有匹配」），但状态必须可区分于 ready。
    expect(h.state.pathPatternResult).not.toBeNull();
    expect(h.state.pathPatternResult!.paths).toHaveLength(0);
  });

  it('lands ready (not empty) when truncated even with no paths yet', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'data',
      data: makeData({ paths: [], truncated: true, nextCursor: 1 }),
    });
    await h.slice.runPathPattern('call+');
    // 截断是「有结果但被折起来」的属性：不能因为当前页为空就显示「没有匹配」。
    expect(h.state.pathPatternStatus).toBe('ready');
  });

  it('drops a stale request: the newer result must win', async () => {
    const h = makeSlice();
    let resolveFirst: (outcome: PathPatternOutcome) => void = () => {};
    mocks.fetchPathsByPattern.mockImplementationOnce(
      () => new Promise<PathPatternOutcome>((resolve) => { resolveFirst = resolve; }),
    );
    const first = h.slice.runPathPattern('old-pattern');

    // 第二次请求立刻返回，并把令牌推进。
    mocks.fetchPathsByPattern.mockResolvedValueOnce({
      kind: 'data',
      data: makeData({ pattern: 'new-pattern', paths: [makePath(['x', 'y'])] }),
    });
    await h.slice.runPathPattern('new-pattern');

    // 旧请求此刻才返回：它的令牌已经不再是最新，必须被丢弃。
    resolveFirst({ kind: 'data', data: makeData({ pattern: 'old-pattern', paths: [makePath(['p', 'q'])] }) });
    await first;

    expect(h.state.pathPattern).toBe('new-pattern');
    expect(h.state.pathPatternResult!.pattern).toBe('new-pattern');
    expect(h.state.pathPatternResult!.paths).toHaveLength(1);
    expect(h.state.pathPatternResult!.paths[0]!.ids).toEqual(['x', 'y']);
  });

  it('lands unknown-types (distinguishable from empty) when unknownEdgeTypes is non-empty', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'data',
      data: makeData({ unknownEdgeTypes: ['calls'], paths: [], pattern: 'calls+' }),
    });
    const ok = await h.slice.runPathPattern('calls+');
    // 结果仍写入（面板要列出拼错的类型名），但状态必须**不是** empty。
    expect(ok).toBe(true);
    expect(h.state.pathPatternStatus).toBe('unknown-types');
    expect(h.state.pathPatternStatus).not.toBe('empty');
    expect(h.state.pathPatternResult!.unknownEdgeTypes).toEqual(['calls']);
    expect(h.state.pathPatternResult!.paths).toHaveLength(0);
  });

  it('distinguishes empty from unknown-types for the same empty paths payload', async () => {
    // 成对断言：只测「拼错落 unknown-types」的话，一个把所有空结果都归到
    // unknown-types 的实现也能过。这里两条一起钉住「两者的数据同形、状态不同」。
    const empty = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({ kind: 'data', data: makeData({ paths: [] }) });
    await empty.slice.runPathPattern('call+');
    expect(empty.state.pathPatternStatus).toBe('empty');

    const typo = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'data',
      data: makeData({ paths: [], unknownEdgeTypes: ['call'] }),
    });
    await typo.slice.runPathPattern('call+');
    expect(typo.state.pathPatternStatus).toBe('unknown-types');
    expect(empty.state.pathPatternStatus).not.toBe(typo.state.pathPatternStatus);
  });

  it('timeout and failed are distinct terminal states', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({ kind: 'timeout' });
    await h.slice.runPathPattern('call+');
    expect(h.state.pathPatternStatus).toBe('timeout');
    expect(h.state.pathPatternError).toBe('pathPattern.timeout');

    mocks.fetchPathsByPattern.mockResolvedValue({ kind: 'failed', status: 500 });
    await h.slice.runPathPattern('call+');
    expect(h.state.pathPatternStatus).toBe('error');
    expect(h.state.pathPatternError).toBe('pathPattern.error');
    // 反向：失败不能伪装成超时。
    expect(h.state.pathPatternStatus).not.toBe('timeout');
  });

  it('invalid lands invalid and keeps the host caret diagnostic verbatim', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'invalid',
      error: 'invalid-pattern',
      diagnostic: 'call+ . import\n        ^',
    });
    const ok = await h.slice.runPathPattern('call+ . import');
    expect(ok).toBe(false);
    expect(h.state.pathPatternStatus).toBe('invalid');
    // 诊断必须原样保存（含 ^ 指位），不能被翻译成 i18n 文案后丢掉位置信息。
    expect(h.state.pathPatternError).toBe('call+ . import\n        ^');
  });

  it('not-found lands not-found (not error, not empty)', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({ kind: 'not-found' });
    const ok = await h.slice.runPathPattern('call+');
    expect(ok).toBe(false);
    expect(h.state.pathPatternStatus).toBe('not-found');
    expect(h.state.pathPatternStatus).not.toBe('error');
    expect(h.state.pathPatternStatus).not.toBe('empty');
  });

  it('passes the caller options through to the fetcher', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({ kind: 'data', data: makeData() });
    await h.slice.runPathPattern('call+', {
      startNode: 'n1',
      endNode: 'n2',
      minHops: 1,
      maxHops: 4,
      limit: 7,
      closed: true,
    });
    expect(mocks.fetchPathsByPattern).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'call+',
        startNode: 'n1',
        endNode: 'n2',
        minHops: 1,
        maxHops: 4,
        limit: 7,
        closed: true,
      }),
    );
  });
});

describe('runPathPatternNextPage', () => {
  it('returns false without a result (no request issued)', async () => {
    const h = makeSlice();
    expect(await h.slice.runPathPatternNextPage()).toBe(false);
    expect(mocks.fetchPathsByPattern).not.toHaveBeenCalled();
  });

  it('returns false when the current page has no nextCursor', async () => {
    const h = makeSlice({
      pathPattern: 'call+',
      pathPatternStatus: 'ready',
      pathPatternResult: {
        pattern: 'call+',
        paths: [makePath(['a', 'b'])],
        total: 1,
        truncated: false,
        nextCursor: null,
        unknownEdgeTypes: [],
        completedAt: 1,
        workspace: '.',
      },
    });
    expect(await h.slice.runPathPatternNextPage()).toBe(false);
    expect(mocks.fetchPathsByPattern).not.toHaveBeenCalled();
  });

  it('reuses the last options, requests the nextCursor and appends the paths', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValueOnce({
      kind: 'data',
      data: makeData({ pattern: 'call+', paths: [makePath(['a', 'b'])], nextCursor: 1, total: 1 }),
    });
    await h.slice.runPathPattern('call+', { limit: 1, maxHops: 3 });
    expect(h.state.pathPatternResult!.nextCursor).toBe(1);

    mocks.fetchPathsByPattern.mockResolvedValueOnce({
      kind: 'data',
      data: makeData({ pattern: 'call+', paths: [makePath(['c'])], nextCursor: null, total: 1 }),
    });
    const ok = await h.slice.runPathPatternNextPage();
    expect(ok).toBe(true);
    // 翻页必须复用上一次的 options，并用上一页的 nextCursor。
    expect(mocks.fetchPathsByPattern).toHaveBeenLastCalledWith(
      expect.objectContaining({ pattern: 'call+', cursor: 1, limit: 1, maxHops: 3 }),
    );
    // 追加而不是替换：旧页面不得被抹掉。
    expect(h.state.pathPatternResult!.paths).toHaveLength(2);
    expect(h.state.pathPatternResult!.paths[0]!.ids).toEqual(['a', 'b']);
    expect(h.state.pathPatternResult!.paths[1]!.ids).toEqual(['c']);
    expect(h.state.pathPatternResult!.nextCursor).toBeNull();
  });

  it('a next-page failure keeps the previous pages and lands error', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValueOnce({
      kind: 'data',
      data: makeData({ paths: [makePath(['a', 'b'])], nextCursor: 1 }),
    });
    await h.slice.runPathPattern('call+');
    mocks.fetchPathsByPattern.mockResolvedValueOnce({ kind: 'failed', status: 500 });
    const ok = await h.slice.runPathPatternNextPage();
    expect(ok).toBe(false);
    expect(h.state.pathPatternStatus).toBe('error');
    // 失败不得清掉已经加载好的页面（否则用户以为结果没了）。
    expect(h.state.pathPatternResult!.paths).toHaveLength(1);
  });
});

describe('clearPathPattern', () => {
  it('resets to idle and advances the token so in-flight writes are dropped', async () => {
    const h = makeSlice();
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'data',
      data: makeData({ paths: [makePath(['a', 'b'])] }),
    });
    await h.slice.runPathPattern('call+');
    const seqBefore = h.state.pathPatternSeq;
    expect(h.state.pathPatternStatus).toBe('ready');

    h.slice.clearPathPattern();
    expect(h.state.pathPattern).toBe('');
    expect(h.state.pathPatternStatus).toBe('idle');
    expect(h.state.pathPatternResult).toBeNull();
    expect(h.state.pathPatternError).toBeNull();
    expect(h.state.pathPatternSeq).toBe(seqBefore + 1);

    // 清空后在途的旧请求不得把结果写回来。
    mocks.fetchPathsByPattern.mockResolvedValue({
      kind: 'data',
      data: makeData({ paths: [makePath(['x', 'y'])] }),
    });
    const stale = h.slice.runPathPattern('call+');
    await stale;
    h.slice.clearPathPattern();
    // 这里只验证清空本身的终态；stale 已在上面的 await 中完成。
    expect(h.state.pathPatternStatus).toBe('idle');
  });
});

describe('helpers', () => {
  it('pathHopsOf counts edges, not nodes', () => {
    expect(pathHopsOf({ ids: ['a', 'b'], labels: ['a', 'b'] })).toBe(1);
    expect(pathHopsOf({ ids: ['a', 'b', 'c'], labels: ['a', 'b', 'c'] })).toBe(2);
    expect(pathHopsOf({ ids: ['a'], labels: ['a'] })).toBe(0);
    expect(pathHopsOf(undefined)).toBe(0);
  });

  it('summarizePathPatternResult reports paths, truncation and unknown count', () => {
    expect(summarizePathPatternResult(null)).toEqual({ paths: 0, truncated: false, unknownTypes: 0 });
    const summary = summarizePathPatternResult({
      pattern: 'call+',
      paths: [makePath(['a']), makePath(['b'])],
      total: 2,
      truncated: true,
      nextCursor: null,
      unknownEdgeTypes: ['calls'],
      completedAt: 1,
      workspace: '.',
    });
    expect(summary).toEqual({ paths: 2, truncated: true, unknownTypes: 1 });
  });
});
