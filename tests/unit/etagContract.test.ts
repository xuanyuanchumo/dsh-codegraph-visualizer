// 条件请求（ETag）机制的源码级守卫 —— P3-R18-02。
//
// ## 它守的那个缺陷
//
// cycle-91 之前，五条按需路由（`/children`、`/files/{id}/outline`、`/symbols/{id}/ast`、
// `/edges`、`/bootstrap`）都调用了 `returnIfEtagMatch(...)` 做 304 判定，但 **200 响应从不回写
// `etag` 头**：`checkEtag` 只在 304 分支写它（`src/host/routes/shared.ts`），而 `sendJson` 只写
// `content-type` 与 CORS 头。于是客户端手里**永远没有可回传的值**，`returnIfEtagMatch` 是
// **可达但无用**的死代码——校验器活着，校验值不可达。
//
// 这类缺陷的形状与 cycle-85 的 AST 分页同源：**能力在单层看起来完整，缺的是跨层的那个字段**。
// 任何行为测试都不会红：请求照常发出、响应照常返回、面板照常渲染，只是每次都全量重取。
//
// ## 为什么必须扫源码形状
//
// 「200 是否带 etag」在单条请求上无法与「200 不带 etag」区分出**缺陷**（功能正常，只是慢了），
// 所以它只能靠"每个 200 出口都必须经过同一个回写函数"这条**结构不变量**来守。
// 新增一个 200 分支时漏写 `etagHeader`，TypeScript 不会报错（它是可选参数），
// 运行时也不会报错——只有源码扫描能看见。
//
// ## 反向自检
//
// 纯正则守卫最大的风险是"正则写错了、永远匹配不到、于是永远绿"。
// 因此每类断言都配一个**正样本**（必须命中）与**负样本**（必须不命中）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** 去掉注释（保留换行，行号不错位）。与 `visualBaselineContract.test.ts` 同一意图。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 从 `open`（某个 `(` 的下标）出发找到配对的 `)`，返回括号内文本。
 *
 * 必须做平衡匹配而不是 `[^)]*`：`sendJson(res, 200, { ... }, req, corsConfig, etagHeader)`
 * 的负载里就有 `)`（函数调用、箭头函数），非平衡正则会在第一个 `)` 处截断，
 * 于是把"带了 etagHeader"的调用误判成"没带"。
 * 同时跳过字符串字面量，避免 `'('` / `')'` 干扰深度。
 */
export function balancedArgs(source: string, open: number): string {
  let depth = 0;
  let i = open;
  let quote: string | null = null;
  for (; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/**
 * 找出所有 `sendJson(res, 200, ...)` 调用，返回其参数文本。
 *
 * 只关心 200：其它状态码没有可缓存的载荷（错误体不该被校验器命中），
 * 而且 `sendJson(res, 404, ...)` 也带 etag 反而会让客户端拿错误体的校验值去比对。
 */
export function sendJson200Args(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  const re = /sendJson\(\s*res\s*,\s*200\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    out.push(balancedArgs(code, m.index + 'sendJson'.length));
  }
  return out;
}

/**
 * 该次 200 是否回写了校验值。
 *
 * 两种合法形状：`..., etagHeader)`（`etagGuard` 的返回值转成的头）与 `..., etagHeaders(null)`
 * （槽为空、刻意为"本响应不带校验器"）。注意 `\betagHeader\b` **不够**：`etagHeader` 后面跟
 * `s(` 时 `\b` 不成立（`s` 是词字符），会把合法调用误判成缺失——所以用负向断言 + 显式分支。
 */
export function writesEtag(args: string): boolean {
  return /\betagHeader(?![A-Za-z])|\betagHeaders\(/.test(args);
}

describe('etag contract (P3-R18-02)', () => {
  describe('balancedArgs', () => {
    it('balances nested parentheses instead of stopping at the first one', () => {
      const src = 'sendJson(res, 200, { x: fn(1) }, req, corsConfig, etagHeader)';
      const args = sendJson200Args(src)[0]!;
      expect(args).toContain('fn(1)');
      expect(writesEtag(args)).toBe(true);
    });

    it('ignores parentheses inside string literals', () => {
      const src = 'sendJson(res, 200, { note: "a)b" }, req, corsConfig)';
      const args = sendJson200Args(src)[0]!;
      expect(args).toContain('"a)b"');
      expect(writesEtag(args)).toBe(false);
    });

    it('finds every 200 call, including multi-line payloads', () => {
      const src = [
        'sendJson(res, 200, {',
        '  nodes: page,',
        '}, req, corsConfig, etagHeader);',
        'sendJson(res, 200, { nodes: [] }, req, corsConfig);',
      ].join('\n');
      const all = sendJson200Args(src);
      expect(all).toHaveLength(2);
      expect(writesEtag(all[0]!)).toBe(true);
      expect(writesEtag(all[1]!)).toBe(false);
    });
  });

  describe('host: every 200 on a cacheable data route writes the validator', () => {
    // 这四条路由是"按需加载"的取数面：它们的响应都会被客户端缓存并参与条件请求。
    // `/data` 的校验值由 `computeGraphEtag` 手工构造（见下一条用例），不在本组。
    const ROUTES_WITH_ETAG = [
      '/api/v1/codegraph/bootstrap',
      '/api/v1/codegraph/children',
      '/api/v1/codegraph/files/{id}/outline',
      '/api/v1/codegraph/symbols/{id}/ast',
      '/api/v1/codegraph/edges',
    ];

    it('dataRoutes.ts: no 200 leaves without an etag argument', () => {
      const source = read('src/host/routes/dataRoutes.ts');
      const all = sendJson200Args(source);
      // 先证明扫描器真的扫到了东西：若正则失效、`all` 为空，下面的循环会静默通过。
      expect(all.length).toBeGreaterThanOrEqual(15);
      const missing = all.filter((a) => !writesEtag(a));
      expect(
        missing,
        `每个 200 出口都必须回写校验值（etagHeader / etagHeaders(null)）；缺失 ${missing.length} 处：\n${missing.join('\n---\n')}`,
      ).toEqual([]);
    });

    it('the five on-demand routes all declare a resource dimension', () => {
      const source = read('src/host/routes/dataRoutes.ts');
      // 资源维度是"一个端点不能替另一个端点回 304"的支点；`requestKey` 是
      // "同一端点的不同参数不能共用一个校验值"的支点。
      for (const resource of ['bootstrap', 'children', 'outline', 'ast', 'edges']) {
        expect(source, `missing resource dimension: ${resource}`).toMatch(
          new RegExp(`etagGuard\\([\\s\\S]{0,120}?'${resource}'`),
        );
      }
      // 参数化路由必须传请求键：只有 `/bootstrap` 无请求参数。
      for (const key of ['etagKeyForChildren', 'etagKeyForOutline', 'etagKeyForAst', 'etagKeyForEdges']) {
        expect(source, `missing request key: ${key}`).toContain(key);
      }
      // 反向自检：不存在的资源名必须不命中，证明上面的正则不是"任意字符串都算命中"。
      expect(source).not.toMatch(/etagGuard\([\s\S]{0,120}?'nonexistent'/);
    });

    it('/data keeps its hand-built validator and still writes it on both branches', () => {
      const source = read('src/host/routes/dataRoutes.ts');
      // `/data` 的校验值必须与 `returnIfEtagMatch` 算出的完全一致，所以它不能走 etagGuard。
      expect(source).toMatch(/returnIfEtagMatch\([^)]*'graph'/);
      expect(source).toMatch(/computeGraphEtag\([^)]*'graph'/);
      // 200 分支（含 slim 分支）都要写 etag 头，否则客户端拿到 200 却无从回传。
      const etagWrites = source.match(/dataHeaders\['etag'\]\s*=/g) ?? [];
      expect(etagWrites.length).toBeGreaterThanOrEqual(2);
    });

    it('etagHeaders is the only shape used, so a new branch cannot forget the write', () => {
      const shared = read('src/host/routes/shared.ts');
      expect(shared).toContain('export function etagHeaders(');
      expect(shared).toContain('export function etagGuard(');
      expect(shared).toContain('export function resourceEtag(');
      // 校验值只有一个构造点：304 分支与 200 回写都经它，否则两侧各算一遍会漂移。
      expect(shared).toMatch(/export function resourceEtag\([\s\S]{0,400}?computeGraphEtag\(/);
      expect(shared).toMatch(/export function etagGuard\([\s\S]{0,600}?resourceEtag\(/);
      // `checkEtag` 仍然只负责比较与回包，不负责决定校验值是什么。
      expect(shared).toMatch(/export function checkEtag\([\s\S]{0,900}?res\.writeHead\(304/);
    });
  });

  describe('client: a 304 is not a failure, and a validator only describes applied data', () => {
    it('settleConditional keeps 304 out of the null-on-failure channel', () => {
      const api = read('src/client/api/index.ts');
      // 304 必须走独立旁路：`res.ok` 对 304 是 false，沿用 `if (!res.ok) return null`
      // 会把"服务器说没变"当成"没有数据"，面板静默清空。
      expect(api).toContain('export interface EtagSink');
      expect(api).toMatch(/if \(res\.status === 304\)[\s\S]{0,400}?sink\.notModified = true/);
      // 四个按需 fetcher 都必须在 `!res.ok` 之前调用 settleConditional。
      for (const fn of ['fetchNodeChildren', 'fetchFileOutline', 'fetchSymbolAST', 'fetchEdges']) {
        const body = api.slice(api.indexOf(`export async function ${fn}(`));
        const end = body.indexOf('\n}\n');
        const scope = body.slice(0, end === -1 ? body.length : end);
        expect(scope, `${fn} must settle the conditional response`).toContain('settleConditional(res, requestKey, sink)');
        const settleAt = scope.indexOf('settleConditional(');
        const okAt = scope.indexOf('if (!res.ok)');
        expect(settleAt, `${fn}: settleConditional must come before the !res.ok check`).toBeGreaterThan(-1);
        expect(okAt).toBeGreaterThan(settleAt);
      }
    });

    it('a 200 with a sink does NOT register the validator (only commitEtag does)', () => {
      const api = read('src/client/api/index.ts');
      const settle = api.slice(api.indexOf('function settleConditional('));
      const body = settle.slice(0, settle.indexOf('\n}\n'));
      // `if (sink) { ... } else { rememberEtag(...) }`：sink 分支里不得出现 rememberEtag。
      const sinkBranch = body.slice(body.indexOf('if (sink) {'), body.indexOf('} else {'));
      expect(sinkBranch.length).toBeGreaterThan(0);
      expect(sinkBranch).not.toContain('rememberEtag(');
      expect(body).toMatch(/\} else \{[\s\S]{0,300}?rememberEtag\(/);
      // commitEtag 是唯一的登记入口，且必须挡住 notModified 与空 key。
      expect(api).toMatch(/export function commitEtag\(sink: EtagSink\): void \{[\s\S]{0,200}?if \(sink\.notModified \|\| !sink\.key\) return;/);
    });

    it('every store call site that creates a sink also reads it and commits it', () => {
      for (const rel of ['src/client/store/slices/expandSlice.ts', 'src/client/store/slices/edgeSlice.ts']) {
        const source = stripComments(read(rel));
        const sinks = source.match(/createEtagSink\(\)/g) ?? [];
        expect(sinks.length, `${rel} must create a sink per fetch`).toBeGreaterThan(0);
        expect(source, `${rel} must check notModified`).toContain('sink.notModified');
        const commits = source.match(/commitEtag\(sink\)/g) ?? [];
        expect(commits.length, `${rel} must commit applied payloads`).toBeGreaterThan(0);
      }
    });

    it('clearing the graph invalidates every cached validator', () => {
      // 304 只断言"服务端副本未变"，**不保证客户端还持有那份载荷**：整图替换会把派生容器
      // 清空（`emptyEdgeState()`），此时旧校验值会让重新展开直接 304 而客户端已无数据 ⇒
      // 节点永久空白且无错误可见。所以每个整图替换点都必须清校验值缓存。
      const graphData = stripComments(read('src/client/store/slices/graphDataSlice.ts'));
      const clears = graphData.match(/clearEtagCache\(\)/g) ?? [];
      // setGraphData（两条分支）、setBootstrapData、clearGraph、applyGraphDelta
      expect(clears.length).toBeGreaterThanOrEqual(4);
      expect(graphData).toContain("from '../../api/index.ts'");
      // disposeStore 同样要清：store 释放后载荷没了，校验值留着只会让重新挂载的实例拿到 304。
      const store = stripComments(read('src/client/store/graphStore.ts'));
      expect(store).toContain('clearEtagCache()');
    });

    it('a sink is passed at every fetch call site (otherwise the mechanism is inert)', () => {
      // cycle-91 的第一版落了 sink 类型与取数逻辑，但**没有任何调用方**——机制完全惰性，
      // 与"校验器可达但校验值不可达"是同一种缺陷：写好了、没接线。所以这里断言接线存在。
      const expand = stripComments(read('src/client/store/slices/expandSlice.ts'));
      for (const fn of ['fetchNodeChildren', 'fetchFileOutline', 'fetchSymbolAST']) {
        const call = new RegExp(`${fn}\\([\\s\\S]{0,200}?sink`);
        expect(expand, `${fn} must receive the sink`).toMatch(call);
      }
      const edge = stripComments(read('src/client/store/slices/edgeSlice.ts'));
      expect(edge).toMatch(/fetchEdges\([\s\S]{0,200}?sink/);
    });
  });
});
