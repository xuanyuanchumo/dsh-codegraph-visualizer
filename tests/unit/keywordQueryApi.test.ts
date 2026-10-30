/**
 * `normalizeKeywordResult` 的字段容错契约（cycle-112 / 继承项 C）。
 *
 * ## 为什么需要这一层（cycle-111 T3 报告 §8-1 登记的缺口）
 *
 * `normalizeKeywordResult`（`src/client/api/keywordQuery.ts:184`）是宿主响应进入
 * 客户端的**唯一入口**：`nodes` / `edges` 之后会进 `setGraphData` 的同一套装配管线，
 * `truncated` / `reason` 直接决定「截断提示」渲染不渲染。此前它的容错分支
 * （`truncated` 缺失、非 JSON、非对象 payload）**只被组件测试与 E2E 间接覆盖**——
 * 也就是说：归一函数自身的 20+ 个分支没有任何一条被直接钉住，改坏任何一个
 * 都只能等 E2E 冷启动失败才知道。
 *
 * 测试策略：**不 mock fetch**，直接调纯函数。它就是纯函数（输入 unknown → 输出
 * `KeywordQueryResult`），mock fetch 反而会把「网络层的事」混进「归一层的事」。
 */
import { describe, it, expect } from 'vitest';
import { normalizeKeywordResult } from '../../src/client/api/keywordQuery.ts';

/** 合法载荷的最小完整形状（归一函数的「正常路径」基线）。 */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    query: 'graph',
    terms: ['graph'],
    seeds: [{ id: 'n1', label: 'graphData', score: 0.9, matchedTerms: ['graph'] }],
    nodes: [{ id: 'n1', label: 'graphData', type: 'function', filePath: 'src/tools.ts', lineNumber: 61, properties: {} }],
    edges: [],
    text: 'NODE n1 graphData',
    tokens: 10,
    truncated: false,
    reason: 'fits',
    meta: { depth: 2, depthEffective: 2, tokenBudget: 800, source: 'slot', revision: 42, reason: 'fits' },
    ...overrides,
  };
}

describe('normalizeKeywordResult: 正常路径（契约基线）', () => {
  it('合法载荷逐字段透传', () => {
    const r = normalizeKeywordResult(validPayload());
    expect(r.query).toBe('graph');
    expect(r.seeds).toHaveLength(1);
    expect(r.seeds[0]).toEqual({ id: 'n1', label: 'graphData', score: 0.9, matchedTerms: ['graph'] });
    expect(r.nodes).toHaveLength(1);
    expect(r.text).toBe('NODE n1 graphData');
    expect(r.tokens).toBe(10);
    expect(r.truncated).toBe(false);
    expect(r.reason).toBe('fits');
    expect(r.meta).toEqual({ depth: 2, depthEffective: 2, tokenBudget: 800, source: 'slot', revision: 42, reason: 'fits' });
  });
});

describe('normalizeKeywordResult: 非对象 / 非 JSON 形态（cycle-111 登记的缺口）', () => {
  it('payload 为 null ⇒ 返回全空结果，不抛错', () => {
    const r = normalizeKeywordResult(null);
    expect(r.query).toBe('');
    expect(r.seeds).toEqual([]);
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('payload 为 undefined ⇒ 同 null', () => {
    const r = normalizeKeywordResult(undefined);
    expect(r.seeds).toEqual([]);
    expect(r.nodes).toEqual([]);
  });

  it('payload 为字符串（非 JSON 对象）⇒ 按 {} 处理，不抛错', () => {
    // 宿主 500 时 res.json() 可能返回错误页文本；把它当对象展开会炸。
    const r = normalizeKeywordResult('Internal Server Error');
    expect(r.query).toBe('');
    expect(r.seeds).toEqual([]);
  });

  it('payload 为数字 ⇒ 同字符串', () => {
    const r = normalizeKeywordResult(500);
    expect(r.seeds).toEqual([]);
    expect(r.meta.source).toBe('slot');
  });
});

describe('normalizeKeywordResult: truncated / reason 的判定矩阵（cycle-111 登记的缺口）', () => {
  it('truncated 缺失 + reason=fits ⇒ false（旧宿主降级：不制造假警告）', () => {
    const p = validPayload();
    delete p.truncated;
    expect(normalizeKeywordResult(p).truncated).toBe(false);
  });

  it('truncated 缺失 + reason=nodes-only ⇒ true（两判据取「或」：偏向报告截断）', () => {
    const p = validPayload();
    delete p.truncated;
    p.reason = 'nodes-only';
    expect(normalizeKeywordResult(p).truncated).toBe(true);
  });

  it('truncated=false + reason=truncated ⇒ true（reason 独立生效）', () => {
    const r = normalizeKeywordResult(validPayload({ truncated: false, reason: 'truncated' }));
    expect(r.truncated).toBe(true);
  });

  it('truncated=true + reason=fits ⇒ true（truncated 独立生效）', () => {
    const r = normalizeKeywordResult(validPayload({ truncated: true, reason: 'fits' }));
    expect(r.truncated).toBe(true);
  });

  it('truncated=true + reason=nodes-only ⇒ true（两判据都真）', () => {
    const r = normalizeKeywordResult(validPayload({ truncated: true, reason: 'nodes-only' }));
    expect(r.truncated).toBe(true);
  });

  it('reason 为非字符串（数字）⇒ 回落 fits', () => {
    const r = normalizeKeywordResult(validPayload({ reason: 3 }));
    expect(r.reason).toBe('fits');
    expect(r.truncated).toBe(false);
  });
});

describe('normalizeKeywordResult: seeds 的逐字段容错', () => {
  it('seeds 非数组 ⇒ []', () => {
    const r = normalizeKeywordResult(validPayload({ seeds: 'n1' }));
    expect(r.seeds).toEqual([]);
  });

  it('seed 内非对象元素被过滤（不抛错）', () => {
    const r = normalizeKeywordResult(validPayload({ seeds: ['n1', null, { id: 'n2', label: 'x', score: 1, matchedTerms: [] }] }));
    expect(r.seeds).toHaveLength(1);
    expect(r.seeds[0]!.id).toBe('n2');
  });

  it('seed.id 非字符串 ⇒ 该条被丢弃（空 id 进不了选中链路）', () => {
    const r = normalizeKeywordResult(validPayload({
      seeds: [
        { id: 42, label: 'bad', score: 1, matchedTerms: [] },
        { id: '', label: 'empty', score: 1, matchedTerms: [] },
        { id: 'ok', label: 'good', score: 1, matchedTerms: [] },
      ],
    }));
    expect(r.seeds.map((s) => s.id)).toEqual(['ok']);
  });

  it('score 非有限数 ⇒ 0；matchedTerms 非数组 ⇒ []（逐字段独立，不整条丢弃）', () => {
    const r = normalizeKeywordResult(validPayload({
      seeds: [{ id: 'n1', label: 'x', score: 'high', matchedTerms: 'graph' }],
    }));
    expect(r.seeds[0]!.score).toBe(0);
    expect(r.seeds[0]!.matchedTerms).toEqual([]);
    // label 同理回落空串而不是把整条扔掉
    expect(r.seeds[0]!.label).toBe('x');
  });
});

describe('normalizeKeywordResult: nodes / edges 走 coerce 通道', () => {
  it('nodes 非数组 ⇒ []（不让脏数据进装配管线）', () => {
    const r = normalizeKeywordResult(validPayload({ nodes: { id: 'n1' } }));
    expect(r.nodes).toEqual([]);
  });

  it('nodes 含坏元素 ⇒ 只丢坏元素（coerceNode 返回 null 被 filter）', () => {
    const r = normalizeKeywordResult(validPayload({
      nodes: [
        null,
        { id: 'good', label: 'g', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} },
      ],
    }));
    expect(r.nodes.map((n) => n.id)).toEqual(['good']);
  });

  it('edges 非数组 ⇒ []', () => {
    const r = normalizeKeywordResult(validPayload({ edges: 7 }));
    expect(r.edges).toEqual([]);
  });
});

describe('normalizeKeywordResult: meta 的容错与缺省方向', () => {
  it('meta 缺失 ⇒ 全 0 + source=slot（「来自缓存图」是安全缺省，不谎报现场取图）', () => {
    const p = validPayload();
    delete p.meta;
    const r = normalizeKeywordResult(p);
    expect(r.meta).toEqual({ depth: 0, depthEffective: 0, tokenBudget: 0, source: 'slot', revision: 0, reason: 'fits' });
  });

  it('meta.source 为未知字符串 ⇒ 回落 slot（白名单二选一，未知=不是 fetched）', () => {
    const r = normalizeKeywordResult(validPayload({ meta: { source: 'somewhere-else' } }));
    expect(r.meta.source).toBe('slot');
  });

  it('meta.depthEffective 非数 ⇒ 0（面板显示 0 比撒一个旧值诚实）', () => {
    const r = normalizeKeywordResult(validPayload({ meta: { depthEffective: 'deep' } }));
    expect(r.meta.depthEffective).toBe(0);
  });
});
