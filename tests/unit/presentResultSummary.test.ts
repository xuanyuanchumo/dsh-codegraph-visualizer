// presentResult UI-channel summary contract tests (15 graph_* tools).
//
// Contract under test (the design principle of this change):
//   model channel = output.render(args, value)              — canonical value → model-facing text;
//   UI channel    = output.presentationMeta(args, value)    — canonical value → tool/result.meta
//                   (persisted, single tool ≤10 keys, each value ≤200 chars;
//                    dsh-tools lib/types/index.d.ts:112, lib/index.js:843/860-862)
//                   → presentResult(result.meta)            — meta → GenericResultView.content
//                     (≤300 chars per block; dsh-llm TextBlock types.d.ts:46-49).
//
// The two channels must NEVER reference each other's fields:
//   - presentResult reads ONLY result.meta on success; when meta is absent it omits
//     content entirely (the UI falls back to the raw result per GenericResultView) —
//     it must never fall back to reading result.content (the model channel projection);
//   - output.render never receives meta at all (defineTool wiring, lib/index.js:857-858).
// Failure summaries are derived ONLY from result.content (the host-rendered error
// projection); an empty projection yields no content — never a fabricated detail.
//
// The presenter fixtures below are structural transcriptions of
// node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:182-205 (ToolDefinition
// presentResult / ToolResult) — fixture rule: cite the source, never invent a contract.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/adapters/CodeGraphAdapter.ts', () => {
  const fetchData = vi.fn().mockResolvedValue({ nodes: [], edges: [], source: 'codegraph' as const, timestamp: 1 });
  return { CodeGraphAdapter: vi.fn().mockImplementation(() => ({ fetchData, source: 'codegraph' as const })) };
});

vi.mock('../../src/adapters/LensAdapter.ts', () => {
  const fetchData = vi.fn().mockResolvedValue({ nodes: [], edges: [], source: 'lens' as const, timestamp: 1 });
  return { LensAdapter: vi.fn().mockImplementation(() => ({ fetchData, source: 'lens' as const })) };
});

const { createGraphTools } = await import('../../src/tools.ts');
import type { Context } from '@deepseek-ai/cordis';

type GraphTools = Awaited<ReturnType<typeof createGraphTools>>;
type PresentableKey = Exclude<keyof GraphTools, 'dispose'>;

type MockCtx = Context & {
  tools: { register: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  effect: ReturnType<typeof vi.fn>;
};

function makeMockCtx(): MockCtx {
  return {
    tools: {
      register: vi.fn(),
      execute: vi.fn().mockResolvedValue({ isError: false, value: null }),
      get: vi.fn().mockReturnValue(undefined),
    },
    on: vi.fn(),
    emit: vi.fn(),
    effect: vi.fn(),
  } as unknown as MockCtx;
}

/** Narrow one tool to its UI-channel surface without fighting the union. */
function uiChannelOf(tools: GraphTools, key: PresentableKey) {
  return tools[key] as unknown as {
    presentResult?: (
      args: unknown,
      result: { content?: unknown[]; isError: boolean; meta?: unknown },
    ) => { card?: string; title?: string; content?: Array<{ type: string; text: string }> } | undefined;
    output: {
      render: (args: unknown, value: unknown) => Array<{ type: string; text: string }>;
      presentationMeta?: (args: unknown, value: unknown) => unknown;
    };
  };
}

// Schema-valid args per tool (structural transcription of tests/unit/tools.test.ts
// VALID_ARGS — the defineTool validation gate short-circuits invalid args, so every
// case below must satisfy each `required: true` parameter).
const VALID_ARGS: Record<PresentableKey, Record<string, unknown>> = {
  graphStatus: { repoId: 'repo-1' },
  graphData: { repoId: 'repo-1', source: 'codegraph' },
  graphSymbol: { symbolId: 'sym-1' },
  graphImpact: { symbolId: 'sym-1' },
  graphPathFind: { repoId: 'repo-1', sourceSymbol: 'sym-a', targetSymbol: 'sym-b' },
  graphPathEnumerate: { repoId: 'repo-1', sourceSymbol: 'sym-a', targetSymbol: 'sym-b' },
  graphPathPattern: { repoId: 'repo-1', pattern: 'call+' },
  graphCycles: { repoId: 'repo-1' },
  graphHealth: { repoId: 'repo-1' },
  graphRulesCheck: { repoId: 'repo-1' },
  graphFocus: { repoId: 'repo-1', symbolId: 'sym-1' },
  graphQuery: { repoId: 'repo-1', query: 'graphStore' },
  graphIntegrity: { repoId: 'repo-1' },
  graphSlice: { repoId: 'repo-1', view: 'structural' },
  graphViews: { repoId: 'repo-1' },
};

const ALL_KEYS = Object.keys(VALID_ARGS) as PresentableKey[];

// Success-shaped sample canonical VALUES (what each execute returns), per tool.
const SAMPLE_VALUES: Record<PresentableKey, unknown> = {
  graphStatus: { status: 'ready', nodeCount: 12, edgeCount: 34, sources: { codegraph: true, lens: false } },
  graphData: { nodes: [], edges: [], metadata: { repoId: 'repo-1', timestamp: 1, nodeCount: 12, edgeCount: 34, graphLayer: 'upstream', xuanji: { applied: true, addedPaths: 5 } } },
  graphSymbol: { name: 'createGraphTools', category: 'function', file: 'src/tools.ts', line: 494 },
  graphImpact: { affected: ['a', 'b', 'c', 'd', 'e', 'f'], depth: 2 },
  graphPathFind: { path: ['a', 'b', 'c'], length: 2 },
  graphPathEnumerate: { paths: [['a', 'b'], ['a', 'c', 'b']], truncated: false, total: 2, nextCursor: null },
  graphPathPattern: { paths: [['a', 'b']], truncated: false, total: 1, nextCursor: null, pattern: 'call+', patternEdgeTypes: ['call'], stateCount: 2 },
  graphCycles: { paths: [['a', 'b', 'a'], ['c', 'd', 'c'], ['e', 'f', 'e']], truncated: false, total: 3, nextCursor: null },
  graphHealth: { coupling: 80, cohesion: 75, cyclicDependencyRate: 90, modularity: 60, overall: 78 },
  graphRulesCheck: [
    { ruleId: 'max-indegree', severity: 'warning', message: 'node a exceeds indegree 10' },
    { ruleId: 'max-outdegree', severity: 'error', message: 'node b exceeds outdegree 15' },
  ],
  graphFocus: { symbolId: 'sym-1', neighbors: ['n1', 'n2', 'n3', 'n4'] },
  graphQuery: { query: 'graphStore', terms: ['graphstore'], seeds: [{ id: 's1', label: 'graphStore', score: 1000 }], text: 'subgraph text', tokens: 420, truncated: false, reason: 'fits', nodeCount: 7, edgeCount: 9 },
  graphIntegrity: { loaded: true, graph: { nodes: 10, edges: 20, version: 3 }, changeLog: { pending: 4, dropped: 1, drained: null }, rules: [{ name: 'r1', counters: { total: 10, stale: 2 } }], incrementalIdle: true },
  graphSlice: { view: 'temporal', granularity: 'file', nodes: [], edges: [], labels: { 'a.ts': '3' }, available: true, viewDataAvailable: true, metadata: {} },
  graphViews: { nodes: [{ id: 'a', views: ['structural', 'domain'] }], edges: [], viewCounts: { structural: 1, domain: 1 }, edgeViewCounts: {}, domain: { domainCount: 2, domainNames: ['core', 'ui'] } },
};

// Exact titles (same pin as tests/unit/tools.test.ts RESULT_TITLES).
const TITLES: Record<PresentableKey, { ok: string; fail: string }> = {
  graphStatus: { ok: 'Graph status', fail: 'Graph status failed' },
  graphData: { ok: 'Code graph fetched', fail: 'Graph fetch failed' },
  graphSymbol: { ok: 'Symbol resolved', fail: 'Symbol resolution failed' },
  graphImpact: { ok: 'Impact analyzed', fail: 'Impact analysis failed' },
  graphPathFind: { ok: 'Call path', fail: 'Path search failed' },
  graphPathEnumerate: { ok: 'Paths enumerated', fail: 'Path enumeration failed' },
  graphPathPattern: { ok: 'Pattern paths', fail: 'Path pattern failed' },
  graphCycles: { ok: 'Dependency cycles', fail: 'Cycle enumeration failed' },
  graphHealth: { ok: 'Health score', fail: 'Health scoring failed' },
  graphRulesCheck: { ok: 'Rules checked', fail: 'Rules check failed' },
  graphFocus: { ok: 'Symbol neighborhood', fail: 'Focus failed' },
  graphQuery: { ok: 'Graph query result', fail: 'Graph query failed' },
  graphIntegrity: { ok: 'Graph integrity', fail: 'Integrity check failed' },
  graphSlice: { ok: 'Graph slice', fail: 'Graph slice failed' },
  graphViews: { ok: 'View partition Π', fail: 'View partition failed' },
};

// Honest-degradation projections: each value is what execute can return in a degraded
// branch; `contains` is the one fact the UI summary must carry.
const EDGE_CASES: Array<{ key: PresentableKey; value: unknown; contains: string }> = [
  { key: 'graphData', value: { metadata: { nodeCount: 5, edgeCount: 6, xuanji: { applied: false } } }, contains: 'full rebuild' },
  { key: 'graphData', value: { metadata: { nodeCount: 5, edgeCount: 6 } }, contains: 'no delta signal' },
  { key: 'graphPathFind', value: { path: [], length: 0, truncated: true }, contains: 'too large' },
  { key: 'graphPathPattern', value: { pattern: 'call+', paths: [], total: 0, error: 'Invalid path pattern: oops' }, contains: 'Pattern error: Invalid path pattern: oops' },
  { key: 'graphPathPattern', value: { pattern: 'call+', paths: [], total: 0, unknownEdgeTypes: ['foo'] }, contains: 'Unknown edge type(s): foo' },
  { key: 'graphPathPattern', value: { pattern: 'call+', paths: [], total: 0, temporal: { requested: true, available: false }, reason: 'no commit log' }, contains: 'temporal slice unavailable' },
  { key: 'graphSlice', value: { available: false, reason: 'no commit history' }, contains: 'Slice unavailable: no commit history' },
  { key: 'graphIntegrity', value: { loaded: false, graph: { nodes: 0, edges: 0, version: 0 }, changeLog: { pending: 0, dropped: 0, drained: null }, rules: [], incrementalIdle: false }, contains: 'not loaded' },
  { key: 'graphImpact', value: { affected: [], depth: 2 }, contains: 'No affected symbols.' },
  { key: 'graphSymbol', value: null, contains: 'Symbol not found.' },
  { key: 'graphRulesCheck', value: [], contains: 'No rule violations.' },
  { key: 'graphCycles', value: { paths: [], total: 0 }, contains: 'No dependency cycles detected.' },
  { key: 'graphPathEnumerate', value: { paths: [], total: 0 }, contains: 'No path found.' },
  { key: 'graphHealth', value: null, contains: 'Insufficient data' },
  { key: 'graphFocus', value: null, contains: 'Symbol not found in graph.' },
  { key: 'graphQuery', value: { text: '', seeds: [] }, contains: 'No seed matched the query.' },
];

describe('presentResult UI-channel summaries (15 tools)', () => {
  let ctx: MockCtx;
  beforeEach(() => {
    ctx = makeMockCtx();
  });

  it('covers exactly the 15 graph_* tools', () => {
    expect(ALL_KEYS).toHaveLength(15);
  });

  it.each(ALL_KEYS)('%s: presentationMeta projects a ≤200-char line; presentResult yields title + content from meta', async (rawKey) => {
    const key = rawKey as PresentableKey;
    const tools = await createGraphTools(ctx);
    const { presentResult, output } = uiChannelOf(tools, key);
    expect(typeof output.presentationMeta).toBe('function');

    const meta = output.presentationMeta!(VALID_ARGS[key], SAMPLE_VALUES[key]) as string;
    expect(typeof meta).toBe('string');
    expect(meta.length).toBeGreaterThan(0);
    expect(meta.length).toBeLessThanOrEqual(200);

    const view = presentResult!(VALID_ARGS[key], { content: [], isError: false, meta });
    expect(view).toEqual({ card: 'generic', title: TITLES[key].ok, content: [{ type: 'text', text: meta }] });
    expect(view?.content?.[0]?.text.length).toBeLessThanOrEqual(300);
  });

  it.each(ALL_KEYS)('%s: isError branch renders a one-line failure summary from the error projection', async (rawKey) => {
    const key = rawKey as PresentableKey;
    const tools = await createGraphTools(ctx);
    const { presentResult } = uiChannelOf(tools, key);
    const view = presentResult!(VALID_ARGS[key], {
      content: [{ type: 'text', text: 'upstream\n  unreachable   after 3000ms' }],
      isError: true,
    });
    expect(view?.title).toBe(TITLES[key].fail);
    expect(view?.content?.[0]?.text).toBe('Failed: upstream unreachable after 3000ms');
  });

  it.each(ALL_KEYS)('%s: isError with an empty projection honestly omits content (no fabricated detail)', async (rawKey) => {
    const key = rawKey as PresentableKey;
    const tools = await createGraphTools(ctx);
    const { presentResult } = uiChannelOf(tools, key);
    expect(presentResult!(VALID_ARGS[key], { content: [], isError: true })).toEqual({
      card: 'generic',
      title: TITLES[key].fail,
    });
    // result.content absent entirely (hostContract replays `{ isError: true }`): must not throw.
    expect(presentResult!(VALID_ARGS[key], { isError: true })).toEqual({
      card: 'generic',
      title: TITLES[key].fail,
    });
  });

  it.each(ALL_KEYS)('%s: success without meta NEVER falls back to the model channel content', async (rawKey) => {
    const key = rawKey as PresentableKey;
    const tools = await createGraphTools(ctx);
    const { presentResult } = uiChannelOf(tools, key);
    const view = presentResult!(VALID_ARGS[key], {
      content: [{ type: 'text', text: 'MODEL-CHANNEL-SENTINEL' }],
      isError: false,
    });
    expect(view).toEqual({ card: 'generic', title: TITLES[key].ok });
    expect(JSON.stringify(view)).not.toContain('MODEL-CHANNEL-SENTINEL');
  });

  it.each(EDGE_CASES)('$key presentationMeta degrades honestly: $contains', async ({ key, value, contains }) => {
    const tools = await createGraphTools(ctx);
    const { output } = uiChannelOf(tools, key);
    const meta = output.presentationMeta!(VALID_ARGS[key], value) as string;
    expect(typeof meta).toBe('string');
    expect(meta).toContain(contains);
    expect(meta.length).toBeLessThanOrEqual(200);
  });

  it('契约：模型通道 render 与 UI 通道 content 互不引用对方字段', async () => {
    const tools = await createGraphTools(ctx);
    const { presentResult, output } = uiChannelOf(tools, 'graphStatus');
    const renderSpy = vi.spyOn(output, 'render');

    // (a) UI 通道：成功摘要只来自 meta；模型通道载荷（result.content）绝不漏进 content，
    //     且 presentResult 绝不借道 output.render。
    const view = presentResult!(VALID_ARGS.graphStatus, {
      content: [{ type: 'text', text: 'MODEL-CHANNEL-SENTINEL' }],
      isError: false,
      meta: 'UI-CHANNEL-SUMMARY',
    });
    expect(view?.content?.[0]?.text).toBe('UI-CHANNEL-SUMMARY');
    expect(JSON.stringify(view)).not.toContain('MODEL-CHANNEL-SENTINEL');
    expect(renderSpy).not.toHaveBeenCalled();

    // (b) 模型通道：render(args, value) 签名里根本没有 meta —— 同一 value 恒定输出，
    //     UI 摘要字符串对 render 不可见也不可影响。
    const value = { status: 'ready', nodeCount: 3, edgeCount: 4, sources: { codegraph: true, lens: false } };
    expect(output.render(VALID_ARGS.graphStatus, value)).toEqual(output.render(VALID_ARGS.graphStatus, value));
    expect(JSON.stringify(output.render(VALID_ARGS.graphStatus, value))).not.toContain('UI-CHANNEL-SUMMARY');
  });
});