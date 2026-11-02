/**
 * `graph_slice` 工具的契约测试（cycle-135）。
 *
 * 它同时是 `businessRegistry.ts` 里 `graph_slice` 条目的 `guardTest`
 * （`registryContract.test.ts` 要求每个 guardTest 指向真实存在的测试文件）。
 *
 * 覆盖：
 * ① factory 返回的 `graph_slice` 名字与参数枚举（view / granularity）与
 *    `GRAPH_SLICE_VIEWS` / `GRAPH_SLICE_GRANULARITIES` 单一真源一致；
 * ② `executeGraphSlice` 把 `commitLog` / `blameLog` 解析成时序/所有权事实后
 *    真的改变了切片结果（而不是参数加了没人传）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';

vi.mock('../../src/adapters/CodeGraphAdapter.ts', () => {
  const mockFetchData = vi.fn().mockResolvedValue({
    nodes: [
      { id: 'n1', label: 'n1', type: 'function', filePath: 'src/a.ts', lineNumber: 1, properties: {} },
      { id: 'n2', label: 'n2', type: 'function', filePath: 'src/a.ts', lineNumber: 2, properties: {} },
      { id: 'n3', label: 'n3', type: 'function', filePath: 'src/b.ts', lineNumber: 1, properties: {} },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
      { id: 'e2', source: 'n2', target: 'n3', type: 'call', properties: {} },
    ],
    source: 'codegraph' as const,
    timestamp: 1,
  });
  return {
    CodeGraphAdapter: vi.fn().mockImplementation(() => ({ fetchData: mockFetchData, source: 'codegraph' as const })),
  };
});

vi.mock('../../src/adapters/LensAdapter.ts', () => {
  const mockFetchData = vi.fn().mockResolvedValue({ nodes: [], edges: [], source: 'lens' as const, timestamp: 1 });
  return {
    LensAdapter: vi.fn().mockImplementation(() => ({ fetchData: mockFetchData, source: 'lens' as const })),
  };
});

const { createGraphTools, executeGraphSlice } = await import('../../src/tools.ts');
const { GRAPH_SLICE_VIEWS, GRAPH_SLICE_GRANULARITIES } = await import('../../src/shared/domain.ts');

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

const NO_OP_INVOKE = async () => null;

describe('graph_slice tool factory', () => {
  it('createGraphTools 返回名为 graph_slice 的第 14 个工具', async () => {
    const tools = await createGraphTools(makeMockCtx());
    expect(tools.graphSlice.name).toBe('graph_slice');
    expect(Object.keys(tools).filter((key) => key !== 'dispose')).toHaveLength(14);
  });

  it('view / granularity 参数枚举与单一真源一致（不复制字面量）', async () => {
    const tools = await createGraphTools(makeMockCtx());
    // defineTool 把参数编译成 JSON Schema，形状是 { type, properties, required }。
    const schema = tools.graphSlice.parameters as {
      properties?: { view?: { enum?: readonly string[] }; granularity?: { enum?: readonly string[] } };
    };
    expect(schema.properties?.view?.enum).toEqual([...GRAPH_SLICE_VIEWS]);
    expect(schema.properties?.granularity?.enum).toEqual([...GRAPH_SLICE_GRANULARITIES]);
  });
});

describe('executeGraphSlice', () => {
  it('structural 视图：无 focus 时返回整图', async () => {
    const result = await executeGraphSlice({ repoId: 'r', view: 'structural' }, NO_OP_INVOKE);
    expect(result.available).toBe(true);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
  });

  it('temporal 视图：commitLog 真的驱动切片（缺它则 available:false）', async () => {
    const commitLog = '\x1eaaaa111\x1f1000\nsrc/b.ts\n';
    const withLog = await executeGraphSlice(
      { repoId: 'r', view: 'temporal', commitLog },
      NO_OP_INVOKE,
    );
    expect(withLog.available).toBe(true);
    expect(withLog.nodes.map((n) => n.id)).toEqual(['n3']);

    const withoutLog = await executeGraphSlice({ repoId: 'r', view: 'temporal' }, NO_OP_INVOKE);
    expect(withoutLog.available).toBe(false);
  });

  it('ownership 视图：blameLog 真的驱动作者标注', async () => {
    const blameLog = [
      'aaa1111 1 1 1',
      'author Alice',
      'author-mail <alice@example.com>',
      'filename src/a.ts',
      '',
      'line1',
      'bbb2222 2 2 1',
      'author Bob',
      'author-mail <bob@example.com>',
      'filename src/a.ts',
      '',
      'line2',
      'ccc3333 1 1 1',
      'author Carol',
      'author-mail <carol@example.com>',
      'filename src/b.ts',
      '',
      'line1',
    ].join('\n');
    const result = await executeGraphSlice(
      { repoId: 'r', view: 'ownership', blameLog },
      NO_OP_INVOKE,
    );
    expect(result.viewDataAvailable).toBe(true);
    expect(result.labels).toMatchObject({ n1: 'Alice', n2: 'Bob', n3: 'Carol' });

    const withoutBlame = await executeGraphSlice({ repoId: 'r', view: 'ownership' }, NO_OP_INVOKE);
    expect(withoutBlame.available).toBe(true);
    expect(withoutBlame.viewDataAvailable).toBe(false);
  });

  it('focus 参数真的收窄切片', async () => {
    const result = await executeGraphSlice(
      { repoId: 'r', view: 'structural', focus: 'src/b.ts' },
      NO_OP_INVOKE,
    );
    expect(result.nodes.map((n) => n.id)).toEqual(['n3']);
  });

  it('工具 execute 面直接返回切片（走 defineTool 的执行门，不只看 executeGraphSlice）', async () => {
    const tools = await createGraphTools(makeMockCtx());
    const exec = { deferContext: () => {}, concludeTurn: () => {} } as unknown as Parameters<
      Awaited<ReturnType<typeof createGraphTools>>['graphSlice']['execute']
    >[1];
    // defineTool 会在 execute 前做参数校验；这里传 schema-valid 参数，确保走的是真执行面。
    const raw = await tools.graphSlice.execute({ repoId: 'r', view: 'structural' }, exec);
    const slice = raw as unknown as { available: boolean; nodes: Array<{ id: string }> };
    expect(slice.available).toBe(true);
    expect(slice.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
  });
});
