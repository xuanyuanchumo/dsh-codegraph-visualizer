// host 侧 `saveSnapshot` 防缩水（cycle-110 / P0-7，cycle-109 carry-over）。
//
// 本文件回答三个问题，缺一个都不算验完：
//   1. **判定本身**对不对（纯函数 `evaluateSnapshotShrink`：阈值、方向、规模下限、边界）；
//   2. **真实写入点**接上了没有（`triggerBackgroundBuild` + 真 GraphRepository，
//      一次断崖缩水必须让 `saveSnapshot` 一次都不被调用）；
//   3. **拒绝写入不等于拒绝服务**（"快照不决定永远"）：同一轮里内存图、扫描缓存、
//      两个事件照样前进——只跳过落盘。
//
// 第 3 点是本任务最容易写错的地方：把守卫写成 `if (!allowed) return;` 会让一次守卫命中
// 连整轮构建一起掐断。这里用一个正向用例（拒绝后 `setLastGraphData` / `ctx.emit` 都发生了）
// 把它钉死，而不是靠读代码判断。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../src/tools.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools.ts')>();
  return {
    ...actual,
    fetchMergedGraph: vi.fn(),
    createInvoke: vi.fn(() => vi.fn()),
  };
});

const { fetchMergedGraph } = await import('../../../src/tools.ts');
const { triggerBackgroundBuild } = await import('../../../src/host/routes/shared.ts');
const { GraphRepository } = await import('../../../src/host/db/GraphRepository.ts');
const {
  evaluateSnapshotShrink,
  rememberRefusedSnapshot,
  wasRefusedBefore,
  clearRefusedSnapshot,
  resetSnapshotShrinkState,
} = await import('../../../src/host/compat/snapshotShrinkGuard.ts');
const { GRAPH_DELTA_SHRINK } = await import('../../../src/shared/graphDelta.ts');
const { makeNode, makeEdge, makeGraphData } = await import('../../helpers.ts');

import type { GraphData } from '../../../src/types/index.ts';
import type { VisualizerConfig } from '../../../src/host/config.ts';

const RATIO = GRAPH_DELTA_SHRINK.MIN_RETAIN_RATIO;
const NODE_FLOOR = GRAPH_DELTA_SHRINK.MIN_GUARDED_NODES;
const EDGE_FLOOR = GRAPH_DELTA_SHRINK.MIN_GUARDED_EDGES;

// ── 1. 纯判定 ─────────────────────────────────────────────────────────

describe('evaluateSnapshotShrink — 纯判定', () => {
  it('没有基线（首次写入）时放行，且不编造比例', () => {
    const d = evaluateSnapshotShrink(null, { nodeCount: 5, edgeCount: 5 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('no-previous');
    expect(d.nodeRatio).toBeNull();
    expect(d.edgeRatio).toBeNull();
  });

  it('未传阈值 = 关闭守卫（既有调用方行为一位不变）', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 400, edgeCount: 400 }, { nodeCount: 4, edgeCount: 4 });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('guard-off');
  });

  it('显式传 0 也等于关闭，而不是"拒绝一切"', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 400, edgeCount: 400 }, { nodeCount: 4, edgeCount: 4 }, { minRetainRatio: 0 });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('guard-off');
  });

  it('节点断崖：400 → 40（保留 10%）被拒绝', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 400, edgeCount: 0 }, { nodeCount: 40, edgeCount: 0 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('shrink-refused');
    expect(d.nodeRatio).toBeCloseTo(0.1, 6);
  });

  it('边断崖也能独立触发：节点没少、边从 400 掉到 40', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 100, edgeCount: 400 }, { nodeCount: 100, edgeCount: 40 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(false);
    expect(d.edgeRatio).toBeCloseTo(0.1, 6);
  });

  it('恰好等于阈值放行（判定是严格小于，与 canApplyGraphDelta 同一语义）', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 100, edgeCount: 100 }, { nodeCount: 50, edgeCount: 50 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('within-budget');
  });

  it('比阈值少一个节点就被拒绝 —— 边界只有一格', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 100, edgeCount: 100 }, { nodeCount: 49, edgeCount: 100 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(false);
  });

  it('纯增长永远放行', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 100, edgeCount: 100 }, { nodeCount: 500, edgeCount: 500 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(true);
  });

  it('一个维度增长、另一个断崖缩水时仍然拒绝 —— 判定逐维度，不是总量', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 100, edgeCount: 100 }, { nodeCount: 500, edgeCount: 5 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(false);
    expect(d.nodeRatio).toBe(5);              // 节点涨了 5 倍
    expect(d.edgeRatio).toBeCloseTo(0.05, 6); // 而边只剩 5%
  });

  it('规模下限以下没有保护：3 个节点删到 1 个照样写（刻意留的洞）', () => {
    expect(NODE_FLOOR).toBeGreaterThan(3);
    const d = evaluateSnapshotShrink({ nodeCount: 3, edgeCount: 2 }, { nodeCount: 1, edgeCount: 0 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('below-floor');
  });

  it('节点在保护线之上、边在下限之下时，只有节点维度参与判定', () => {
    const d = evaluateSnapshotShrink(
      { nodeCount: NODE_FLOOR, edgeCount: EDGE_FLOOR - 1 },
      { nodeCount: NODE_FLOOR, edgeCount: 0 },
      { minRetainRatio: RATIO },
    );
    expect(d.allowed).toBe(true);
  });

  it('基线为 0 时比例记 1（没有可缩水的基数）', () => {
    const d = evaluateSnapshotShrink({ nodeCount: 0, edgeCount: 0 }, { nodeCount: 10, edgeCount: 10 }, { minRetainRatio: RATIO });
    expect(d.allowed).toBe(true);
    expect(d.nodeRatio).toBe(1);
  });
});

describe('两次确认的状态机', () => {
  beforeEach(() => { resetSnapshotShrinkState(); });
  afterEach(() => { resetSnapshotShrinkState(); });

  it('登记后同一指纹可被识别，不同指纹不会误判', () => {
    rememberRefusedSnapshot('repo-a', 'v1:aaaa');
    expect(wasRefusedBefore('repo-a', 'v1:aaaa')).toBe(true);
    expect(wasRefusedBefore('repo-a', 'v1:bbbb')).toBe(false);
    expect(wasRefusedBefore('repo-b', 'v1:aaaa')).toBe(false);
  });

  it('清除后不再认得（写入成功即前移基线）', () => {
    rememberRefusedSnapshot('repo-a', 'v1:aaaa');
    clearRefusedSnapshot('repo-a');
    expect(wasRefusedBefore('repo-a', 'v1:aaaa')).toBe(false);
  });

  it('重置是全局的（插件卸载 / 用例隔离依赖它）', () => {
    rememberRefusedSnapshot('repo-a', 'v1:aaaa');
    rememberRefusedSnapshot('repo-b', 'v1:bbbb');
    resetSnapshotShrinkState();
    expect(wasRefusedBefore('repo-a', 'v1:aaaa')).toBe(false);
    expect(wasRefusedBefore('repo-b', 'v1:bbbb')).toBe(false);
  });
});

// ── 2. 真实写入点 ─────────────────────────────────────────────────────

const WORKSPACE = '/test/workspace';

type MockCtx = {
  effect: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  provide: ReturnType<typeof vi.fn>;
  webServer: { register: ReturnType<typeof vi.fn> };
  tools: { get: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
};

function makeMockCtx(): MockCtx {
  return {
    effect: vi.fn((cb: () => unknown) => cb()),
    emit: vi.fn(),
    on: vi.fn(),
    provide: vi.fn(),
    webServer: { register: vi.fn() },
    tools: { get: vi.fn(), execute: vi.fn() },
  };
}

function makeConfig(overrides: Partial<VisualizerConfig> = {}): VisualizerConfig {
  return {
    dataSource: 'auto',
    requestTimeout: 5000,
    scanCacheTtl: 30000,
    scanCacheLimit: 4,
    maxBodyBytes: 1024 * 1024,
    prerequisiteRetryDelay: 3000,
    watchDebounce: 500,
    maxNodes: 10000,
    allowedOrigins: [],
    panelMinHeight: 240,
    panelDefaultHeight: 600,
    ...overrides,
  };
}

/** `nodeCount` 个节点 + `edgeCount` 条边（全部 n1 → n2，保证端点存在）。 */
function graphOfSize(nodeCount: number, edgeCount = 0, repoId = WORKSPACE): GraphData {
  const nodes = Array.from({ length: nodeCount }, (_, i) =>
    makeNode(`n${i + 1}`, `N${i + 1}`, 'function', 'src/a.ts', i + 1));
  const edges = Array.from({ length: edgeCount }, (_, i) =>
    makeEdge(`e${i + 1}`, 'n1', nodeCount > 1 ? 'n2' : 'n1', 'call'));
  return makeGraphData(nodes, edges, repoId, 1);
}

interface Harness {
  ctx: MockCtx;
  deps: Parameters<typeof triggerBackgroundBuild>[0];
  repo: InstanceType<typeof GraphRepository>;
  lastGraphWasSet: () => GraphData | null;
}

function makeHarness(dir: string): Harness {
  const ctx = makeMockCtx();
  const repo = new GraphRepository(dir);
  expect(repo.init()).toBe(true);
  let last: GraphData | null = null;
  const scanCache = new Map<string, { data: GraphData; timestamp: number }>();
  const scanInFlight = new Map<string, Promise<GraphData> | null>();
  const deps = {
    ctx: ctx as never,
    config: makeConfig(),
    securityManager: {} as never,
    getLastGraphData: () => last,
    setLastGraphData: (d: GraphData | null) => { last = d; },
    getLastInitResult: () => null,
    setLastInitResult: () => {},
    getScanCache: () => scanCache,
    getScanInFlight: (p: string) => scanInFlight.get(p) ?? null,
    setScanInFlight: (p: string, promise: Promise<GraphData> | null) => {
      if (promise === null) scanInFlight.delete(p);
      else scanInFlight.set(p, promise);
    },
    graphRepo: repo,
    isDestroyed: () => false,
  } as Parameters<typeof triggerBackgroundBuild>[0];
  return { ctx, deps, repo, lastGraphWasSet: () => last };
}

/** `triggerBackgroundBuild` fire-and-forget：把微任务队列刷到写入落地。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('triggerBackgroundBuild — 真实 saveSnapshot 调用点', () => {
  let dir: string;
  let h: Harness;

  beforeEach(() => {
    resetSnapshotShrinkState();
    dir = mkdtempSync(join(tmpdir(), 'cg-shrink-'));
    h = makeHarness(dir);
    vi.mocked(fetchMergedGraph).mockReset();
  });

  afterEach(() => {
    h.repo.close();
    rmSync(dir, { recursive: true, force: true });
    resetSnapshotShrinkState();
    vi.mocked(fetchMergedGraph).mockReset();
  });

  it('首次构建（无基线）写入一张快照', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(40, 40));
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();
    expect(h.repo.countSnapshots(WORKSPACE)).toBe(1);
  });

  it('断崖缩水：写入被拒绝，磁盘上仍是上一张快照', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(400, 400));
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();
    const baseline = h.repo.getLatestSnapshot(WORKSPACE);
    expect(baseline?.nodeCount).toBe(400);

    // 第二轮扫出 40 个节点 = 10% 保留率 < 50%
    const saveSpy = vi.spyOn(h.repo, 'saveSnapshot');
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(40, 40));
    h.deps.setScanInFlight(WORKSPACE, null);
    h.deps.getScanCache().clear();
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    // 先证明第二轮**真的跑了**：否则 saveSnapshot 零调用可能只是"没构建"。
    expect(h.lastGraphWasSet()?.metadata.nodeCount).toBe(40);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(h.repo.countSnapshots(WORKSPACE)).toBe(1);
    expect(h.repo.getLatestSnapshot(WORKSPACE)?.snapshotHash).toBe(baseline?.snapshotHash);
    saveSpy.mockRestore();
  });

  it('"快照不决定永远"：拒绝落盘的那一轮，内存图/缓存/事件全部照常前进', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(400, 400));
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    const small = graphOfSize(40, 40);
    vi.mocked(fetchMergedGraph).mockResolvedValue(small);
    // 必须显式清掉 scanCache / in-flight：`triggerBackgroundBuild` 在缓存新鲜时**直接早退**，
    // 不清的话第二轮根本没跑，下面的断言会变成"没构建所以没写盘"式的假绿。
    h.deps.setScanInFlight(WORKSPACE, null);
    h.deps.getScanCache().clear();
    h.ctx.emit.mockClear();
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    // 图：内存槽拿到的是**小图**（不是被快照守卫挡回去的旧图）
    expect(h.lastGraphWasSet()?.metadata.nodeCount).toBe(40);
    // 扫描缓存也更新了
    expect(h.deps.getScanCache().get(WORKSPACE)?.data.metadata.nodeCount).toBe(40);
    // 两个事件都发了：updated 与 data
    const emitted = h.ctx.emit.mock.calls.map((c) => c[0] as string);
    expect(emitted).toContain('codegraph-visualizer/graph/updated');
    expect(emitted).toContain('codegraph-visualizer/graph/data');
    // 而磁盘上仍是旧快照
    expect(h.repo.getLatestSnapshot(WORKSPACE)?.nodeCount).toBe(400);
  });

  it('两次确认：同一张缩水图连续出现第二轮时写入（否则基线被永久锁死）', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(400, 400));
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    // 第一轮缩水：被拒
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(40, 40));
    h.deps.setScanInFlight(WORKSPACE, null);
    h.deps.getScanCache().clear();
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();
    expect(h.repo.getLatestSnapshot(WORKSPACE)?.nodeCount).toBe(400);

    // 第二轮：**完全相同**的小图 —— 缩水是真实改动，放行
    h.deps.setScanInFlight(WORKSPACE, null);
    h.deps.getScanCache().clear();
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();
    expect(h.repo.getLatestSnapshot(WORKSPACE)?.nodeCount).toBe(40);
  });

  it('规模下限以下不设防：10 节点掉到 2 节点仍然写入', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(10, 10));
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(2, 1));
    h.deps.setScanInFlight(WORKSPACE, null);
    h.deps.getScanCache().clear();
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    expect(h.repo.getLatestSnapshot(WORKSPACE)?.nodeCount).toBe(2);
    expect(h.repo.countSnapshots(WORKSPACE)).toBe(2);
  });

  it('增长照常写入（守卫只拦缩水）', async () => {
    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(40, 40));
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    vi.mocked(fetchMergedGraph).mockResolvedValue(graphOfSize(400, 400));
    h.deps.setScanInFlight(WORKSPACE, null);
    h.deps.getScanCache().clear();
    triggerBackgroundBuild(h.deps, vi.fn() as never, WORKSPACE);
    await settle();

    expect(h.repo.getLatestSnapshot(WORKSPACE)?.nodeCount).toBe(400);
  });
});
