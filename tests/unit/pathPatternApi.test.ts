/**
 * ρ 路径模式客户端取数层（`src/client/api/pathPattern.ts`）的契约测试（cycle-135）。
 *
 * ## 这个文件守的是什么
 *
 * `fetchPathsByPattern` 是 ρ 从宿主走进客户端的**唯一入口**。它守的契约不是「能发请求」，
 * 而是「**四种返回态在类型层面不可混淆**」：
 *
 * 1. **语法错误（400）与零结果（200 + `paths: []`）必须分开**——本仓最贵的教训之一
 *    （`calls+` 与「图上没有 call 边」同形会让调用方误判）。宿主用 400 表达前者，
 *    这里必须把它归入 `invalid` 分支，绝不能当成网络失败或空数据。
 * 2. **`no-graph-data` 必须与 `empty` 分开**——前者是「现在没有可查的图」（下一步是
 *    先扫描/等索引），后者是「这条 ρ 在该图上没有匹配」（下一步是换 ρ）。
 * 3. **超时与网络失败必须分开**——`fetchWithTimeout` 的 AbortError 与真正的网络错误
 *    在异常层面同形，而用户下一步动作不同。
 * 4. **拼错类型名（`unknownEdgeTypes`）必须逐字段透传**，不能被归一化丢掉——
 *    它是「为什么零结果」的唯一证据。
 *
 * 策略：**直接替换 `globalThis.fetch`**（与 `tests/unit/api.test.ts` 同款），
 * 逐分支断言返回态，而不是断言 URL 拼接（URL 的字段级契约由路由测试与类型承担）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPathsByPattern, fetchPathPatternSyntax } from '../../src/client/api/pathPattern.ts';

/** 构造一个最小的成功响应体（与宿主 `runPatternBranch` 的字段对齐）。 */
function successBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pattern: 'call+',
    patternEdgeTypes: ['call'],
    stateCount: 4,
    unknownEdgeTypes: [],
    paths: [{ ids: ['n1', 'n2'], labels: ['alpha', 'beta'] }],
    truncated: false,
    total: 1,
    nextCursor: null,
    metadata: { repoId: 'w1', edgeCount: 10 },
    ...overrides,
  };
}

function mockFetch(impl: unknown): void {
  // `impl` 可以是 Response 形状的对象（直接 resolve）或一个函数（用于断言 URL）。
  const stub = typeof impl === 'function' ? impl : vi.fn().mockResolvedValue(impl);
  globalThis.fetch = stub as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchPathsByPattern: 成功路径', () => {
  it('200 + 有结果 ⇒ kind: data，且逐字段透传（含 unknownEdgeTypes）', async () => {
    mockFetch({ ok: true, json: async () => successBody() });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('data');
    if (outcome.kind !== 'data') return;
    expect(outcome.data.pattern).toBe('call+');
    expect(outcome.data.patternEdgeTypes).toEqual(['call']);
    expect(outcome.data.stateCount).toBe(4);
    expect(outcome.data.unknownEdgeTypes).toEqual([]);
    expect(outcome.data.paths).toEqual([{ ids: ['n1', 'n2'], labels: ['alpha', 'beta'] }]);
    expect(outcome.data.truncated).toBe(false);
    expect(outcome.data.nextCursor).toBeNull();
    expect(outcome.data.metadata.repoId).toBe('w1');
    expect(outcome.data.metadata.edgeCount).toBe(10);
  });

  it('拼错类型名（unknownEdgeTypes 非空）必须原样透传，不能被丢掉', async () => {
    mockFetch({ ok: true, json: async () => successBody({ paths: [], unknownEdgeTypes: ['calls'], total: 0 }) });
    const outcome = await fetchPathsByPattern({ pattern: 'calls+' });
    expect(outcome.kind).toBe('data');
    if (outcome.kind !== 'data') return;
    expect(outcome.data.unknownEdgeTypes).toEqual(['calls']);
    expect(outcome.data.paths).toEqual([]);
  });

  it('`nextCursor` 为数字时保留（分页的下一页游标）', async () => {
    mockFetch({ ok: true, json: async () => successBody({ nextCursor: 20, truncated: true }) });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    if (outcome.kind !== 'data') throw new Error('expected data');
    expect(outcome.data.nextCursor).toBe(20);
    expect(outcome.data.truncated).toBe(true);
  });

  it('`workspace === \'.\'` 时不发送该参数（哨兵值，发出去只会让请求键分叉）', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => successBody() });
    mockFetch(spy);
    await fetchPathsByPattern({ pattern: 'call+', workspace: '.' });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).not.toContain('workspace=');
  });

  it('显式 workspace 时带上', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => successBody() });
    mockFetch(spy);
    await fetchPathsByPattern({ pattern: 'call+', workspace: '/repo/a' });
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toContain('workspace=%2Frepo%2Fa');
  });
});

describe('fetchPathsByPattern: 语法错误与零结果必须分开', () => {
  it('400 + diagnostic ⇒ kind: invalid，绝不落入 data/failed', async () => {
    mockFetch({
      ok: false,
      status: 400,
      json: async () => ({
        paths: [], truncated: false, total: 0, nextCursor: null,
        error: 'invalid-pattern', message: 'boom', diagnostic: 'boom\n  call|\n  ^',
      }),
    });
    const outcome = await fetchPathsByPattern({ pattern: 'call|' });
    expect(outcome.kind).toBe('invalid');
    if (outcome.kind !== 'invalid') return;
    expect(outcome.error).toBe('invalid-pattern');
    expect(outcome.diagnostic).toContain('^');
  });

  it('400 但响应体没有 diagnostic ⇒ 退化为 message，仍归 invalid', async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({ error: 'invalid-pattern', message: 'boom' }) });
    const outcome = await fetchPathsByPattern({ pattern: 'call|' });
    expect(outcome.kind).toBe('invalid');
    if (outcome.kind !== 'invalid') return;
    expect(outcome.diagnostic).toBe('boom');
  });

  it('200 + paths:[] 且无 error ⇒ 是 data（合法的零结果），不是 invalid', async () => {
    mockFetch({ ok: true, json: async () => successBody({ paths: [], total: 0 }) });
    const outcome = await fetchPathsByPattern({ pattern: 'extend' });
    expect(outcome.kind).toBe('data');
    if (outcome.kind !== 'data') return;
    expect(outcome.data.paths).toEqual([]);
  });
});

describe('fetchPathsByPattern: no-graph-data 与 empty 分开', () => {
  it('200 + reason no-graph-data ⇒ kind: not-found（不是 data/error）', async () => {
    mockFetch({ ok: true, json: async () => ({ paths: [], truncated: false, total: 0, nextCursor: null, reason: 'no-graph-data' }) });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('not-found');
  });
});

describe('fetchPathsByPattern: 超时与网络失败分开', () => {
  it('fetch 抛 AbortError 且**没有**外部 signal ⇒ timeout', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    mockFetch(vi.fn().mockRejectedValue(abortError));
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('timeout');
  });

  it('fetch 抛 AbortError 且外部 signal **已**中止 ⇒ failed（用户主动取消不算超时）', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    mockFetch(vi.fn().mockRejectedValue(abortError));
    const controller = new AbortController();
    controller.abort();
    const outcome = await fetchPathsByPattern({ pattern: 'call+' }, controller.signal);
    expect(outcome.kind).toBe('failed');
  });

  it('普通网络错误 ⇒ failed', async () => {
    mockFetch(vi.fn().mockRejectedValue(new Error('network down')));
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('failed');
  });
});

describe('fetchPathsByPattern: 非 JSON 响应绝不伪装成数据', () => {
  it('响应体是文本 ⇒ failed（不能变成空结果）', async () => {
    mockFetch({
      ok: true,
      json: async () => { throw new Error('invalid json'); },
    });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('failed');
  });

  it('非 2xx 且非 400（如 500）⇒ failed', async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({}) });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('failed');
  });
});

describe('fetchPathsByPattern: 载荷字段容错（缺字段不炸、不静默造值）', () => {
  it('缺 unknownEdgeTypes / metadata 时退化为空数组/空对象，不抛错', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ pattern: 'call+', paths: [{ ids: ['a'], labels: ['a'] }] }),
    });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    expect(outcome.kind).toBe('data');
    if (outcome.kind !== 'data') return;
    expect(outcome.data.unknownEdgeTypes).toEqual([]);
    expect(outcome.data.metadata.repoId).toBe('');
    expect(outcome.data.metadata.edgeCount).toBe(0);
    expect(outcome.data.patternEdgeTypes).toEqual([]);
    expect(outcome.data.stateCount).toBe(0);
  });

  it('paths 数组里混入非对象项 ⇒ 过滤掉，不炸', async () => {
    mockFetch({
      ok: true,
      json: async () => successBody({ paths: [null, { ids: ['a', 'b'], labels: ['a', 'b'] }, 'junk'] }),
    });
    const outcome = await fetchPathsByPattern({ pattern: 'call+' });
    if (outcome.kind !== 'data') throw new Error('expected data');
    expect(outcome.data.paths).toHaveLength(1);
    expect(outcome.data.paths[0]!.ids).toEqual(['a', 'b']);
  });
});

describe('fetchPathPatternSyntax: 语法预检', () => {
  it('ok:true ⇒ 回显 Σ 全集（客户端不复制类型名列表）', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ ok: true, pattern: 'call+', edgeTypes: ['call', 'import', 'dependency'] }),
    });
    const outcome = await fetchPathPatternSyntax('call+');
    expect(outcome).toEqual({ ok: true, pattern: 'call+', edgeTypes: ['call', 'import', 'dependency'] });
  });

  it('语法错 ⇒ ok:false + diagnostic（宿主用 200 表达，不是 400）', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ ok: false, pattern: 'call|', error: 'boom', diagnostic: 'boom\n  ^', edgeTypes: [] }),
    });
    const outcome = await fetchPathPatternSyntax('call|');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.diagnostic).toContain('^');
    expect(outcome.edgeTypes).toEqual([]);
  });

  it('非 2xx ⇒ failed', async () => {
    mockFetch({ ok: false, status: 503, json: async () => ({}) });
    const outcome = await fetchPathPatternSyntax('call+');
    expect(outcome.kind).toBe('failed');
  });

  it('非 JSON ⇒ failed（不伪装成 ok/invalid）', async () => {
    mockFetch({ ok: true, json: async () => { throw new Error('bad json'); } });
    const outcome = await fetchPathPatternSyntax('call+');
    expect(outcome.kind).toBe('failed');
  });
});
