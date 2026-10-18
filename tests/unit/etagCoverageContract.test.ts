// ETag 覆盖决策矩阵（P3-R27-04 / CO-2 的结构性收口，cycle-100）。
//
// ## 它守的缺陷
//
// cycle-92 的流转项把「analysisRoutes / statusRoutes / controlRoutes / workerRoutes 的 200
// 不带 etag」登记为缺口。但**逐路由撒 etag 是错误的目标**：
//
//   - `/diff`、`/ast`(POST)、`/tree-sitter`、`/scan`、`/init`、`/watch` 是 **POST**——
//     条件请求（If-None-Match/304）是 GET 语义，POST 的载荷由请求体决定，没有"同一资源的
//     两次获取"可比较；
//   - `/events` 是 **SSE 流**——响应永不结束，304 判定无从发生；
//   - `/status`、`/health`、`/workspace` 是**诊断端点**——每次探测都该拿实时状态，
//     缓存它们是主动有害的（负载均衡器会因 stale 304 误判存活）；
//   - worker JS 是**构建产物**——由 cache-control 策略管理，不是数据资源。
//
// 正确的目标是：**每条路由必须表态自己属于哪一类，且不表态的类别不能拿到 etag 机制**。
// 这与 cycle-83 的 `GraphEtagResource`（资源维度编译期必填）同一设计哲学：新增路由时
// "忘了考虑缓存语义"必须在门禁处变红，而不是静默通过。
//
// ## 为什么必须扫源码形状
//
// 「一条新路由加了但没有分类」不改变任何现有行为——没有测试会红，直到某天有人发现
// 新路由的数据被客户端反复全量拉取，或者更糟：诊断端点被 304 缓存。这是"决策缺位"型
// 缺陷，只有把决策表本身变成断言才能守住。
//
// ## 反向自检
//
// 提取器（路径+方法识别）与分类断言都配正/负样本：喂一条合成的"POST 路由却调 checkEtag"
// 违规样本，分类断言必须报红——否则扫描器写坏了守卫永远绿（cycle-93 教训）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** 去掉注释（保留换行与列宽，行号不错位）。与 etagContract.test.ts 同一实现意图。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** worker 路由的路径不是字面量而是 LAYOUT_WORKER.ROUTE_PATH，从常量定义解析。 */
const WORKER_ROUTE_PATH = (() => {
  const constants = read('src/shared/constants.ts');
  const m = constants.match(/ROUTE_PATH:\s*'([^']+)'/);
  if (!m) throw new Error('constants.ts 里找不到 LAYOUT_WORKER.ROUTE_PATH');
  return m[1]!;
})();

type RouteClass =
  | 'etag-guarded' // GET 数据路由：走 etagGuard/returnIfEtagMatch（校验值来自缓存图槽）
  | 'content-etag' // GET 数据路由：校验值来自磁盘内容（不经过缓存图槽）
  | 'post' // POST：无条件请求语义，304 不适用
  | 'sse' // GET 但为事件流：响应不结束
  | 'diagnostic' // GET 诊断端点：动态探测，缓存有害
  | 'static-worker'; // GET 构建产物：cache-control 策略管理

interface MatrixEntry {
  method: 'GET' | 'POST';
  path: string;
  routeClass: RouteClass;
  /** 该类别的存在理由（决策矩阵的"表态"本体）。 */
  rationale: string;
}

/**
 * 决策矩阵：插件全部已注册路由的唯一登记表。
 *
 * 硬约束（双向）：
 *   1. 源码里每条 `ctx.webServer.register` 路由都必须在此表中 ⇒ 新路由不表态即红；
 *   2. 表里每条都必须能在源码中找到 ⇒ 删路由不清理此表即红（防止矩阵成为陈旧叙事）。
 */
const DECISION_MATRIX: MatrixEntry[] = [
  // ---- etag-guarded（6 条，dataRoutes；校验值经缓存图槽 resourceEtag） ----
  { method: 'GET', path: '/api/v1/codegraph/data', routeClass: 'etag-guarded', rationale: '缓存图本体，returnIfEtagMatch + 手工 computeGraphEtag' },
  { method: 'GET', path: '/api/v1/codegraph/bootstrap', routeClass: 'etag-guarded', rationale: '缓存图引导视图' },
  { method: 'GET', path: '/api/v1/codegraph/children', routeClass: 'etag-guarded', rationale: '参数化按需路由，请求键 etagKeyForChildren' },
  { method: 'GET', path: '/api/v1/codegraph/files', routeClass: 'etag-guarded', rationale: 'prefix 路由（files/{id}/outline），请求键 etagKeyForOutline' },
  { method: 'GET', path: '/api/v1/codegraph/symbols', routeClass: 'etag-guarded', rationale: 'prefix 路由（symbols/{id}/ast），请求键 etagKeyForAst' },
  { method: 'GET', path: '/api/v1/codegraph/edges', routeClass: 'etag-guarded', rationale: '参数化按需路由，请求键 etagKeyForEdges' },
  // ---- content-etag（1 条，analysisRoutes；校验值来自磁盘 manifest，不取图槽） ----
  { method: 'GET', path: '/api/v1/codegraph/dependencies', routeClass: 'content-etag', rationale: '载荷来自 package.json/Cargo.toml/go.mod 磁盘内容，与图槽不同域' },
  // ---- post（6 条：条件请求是 GET 语义，POST 载荷由请求体决定） ----
  { method: 'POST', path: '/api/v1/codegraph/diff', routeClass: 'post', rationale: 'from/to 请求体决定载荷，无"同一资源的两次获取"' },
  { method: 'POST', path: '/api/v1/codegraph/ast', routeClass: 'post', rationale: '任意文件内容解析，非缓存资源' },
  { method: 'POST', path: '/api/v1/codegraph/tree-sitter', routeClass: 'post', rationale: '请求体携带 content，响应已带 contentHash 可供调用方自判' },
  { method: 'POST', path: '/api/v1/codegraph/scan', routeClass: 'post', rationale: '触发动作非资源获取' },
  { method: 'POST', path: '/api/v1/codegraph/init', routeClass: 'post', rationale: '触发动作非资源获取' },
  { method: 'POST', path: '/api/v1/codegraph/watch', routeClass: 'post', rationale: '触发动作非资源获取' },
  // ---- sse（1 条：流式响应不结束，304 判定无从发生） ----
  { method: 'GET', path: '/api/v1/codegraph/events', routeClass: 'sse', rationale: 'text/event-stream 长连接' },
  // ---- diagnostic（3 条：实时探测端点，缓存主动有害） ----
  { method: 'GET', path: '/api/v1/codegraph/status', routeClass: 'diagnostic', rationale: '能力探测，每次都该拿实时状态' },
  { method: 'GET', path: '/api/v1/codegraph/health', routeClass: 'diagnostic', rationale: '存活探测，stale 304 会让 LB 误判存活' },
  { method: 'GET', path: '/api/v1/codegraph/workspace', routeClass: 'diagnostic', rationale: '工作区列表观测端点' },
  // ---- static-worker（1 条：构建产物，cache-control 管理） ----
  { method: 'GET', path: WORKER_ROUTE_PATH, routeClass: 'static-worker', rationale: 'layoutWorker.js 构建产物，cache-control: no-cache' },
];

interface ExtractedRoute {
  file: string;
  method: string;
  path: string;
  /** 该 register 函数的源码切片（不含注释）。 */
  slice: string;
}

const ROUTE_FILES = [
  'src/host/routes/dataRoutes.ts',
  'src/host/routes/analysisRoutes.ts',
  'src/host/routes/controlRoutes.ts',
  'src/host/routes/statusRoutes.ts',
  'src/host/routes/workerRoutes.ts',
] as const;

/**
 * 从路由文件里提取每条 `export function register*` 的路径、方法与源码切片。
 *
 * 切片边界：`export function register` 到下一个 `export function register`（或文件尾）。
 * 方法识别两种形状：`withRouteMiddleware('GET'|'POST', ...)` 与 `/events` 的
 * `requireMethod(req, res, 'GET', ...)`。
 */
function extractRoutes(file: string): ExtractedRoute[] {
  const code = stripComments(read(file));
  const markers = [...code.matchAll(/^export function register\w*\(/gm)].map((m) => m.index!);
  const out: ExtractedRoute[] = [];
  for (let i = 0; i < markers.length; i++) {
    const slice = code.slice(markers[i]!, markers[i + 1] ?? code.length);
    const pathMatch = slice.match(/const routePath = (?:'([^']+)'|LAYOUT_WORKER\.ROUTE_PATH)/);
    if (!pathMatch) continue;
    const path = pathMatch[1] ?? WORKER_ROUTE_PATH;
    const methodMatch = slice.match(/withRouteMiddleware\('(GET|POST)'/) ?? slice.match(/requireMethod\(req,\s*res,\s*'(GET|POST)'/);
    if (!methodMatch) continue;
    out.push({ file, method: methodMatch[1]!, path, slice });
  }
  return out;
}

/** 校验器机制的调用痕迹（304 判定家族）。 */
function usesValidatorMechanism(slice: string): boolean {
  return /checkEtag\(|etagGuard\(|returnIfEtagMatch\(/.test(slice);
}

describe('etag coverage decision matrix (P3-R27-04 / cycle-100)', () => {
  const extracted = ROUTE_FILES.flatMap(extractRoutes);

  it('提取器真的扫到了路由（防空转：正则失效会让矩阵断言静默通过）', () => {
    // 已知路由必须被抽到：数量下界 + 抽样成员。
    expect(extracted.length, '提取到的路由数异常').toBeGreaterThanOrEqual(18);
    const paths = extracted.map((r) => r.path);
    for (const mustHave of [
      '/api/v1/codegraph/data',
      '/api/v1/codegraph/dependencies',
      '/api/v1/codegraph/events',
      '/api/v1/codegraph/health',
      WORKER_ROUTE_PATH,
    ]) {
      expect(paths, `提取器漏掉了已知路由 ${mustHave}`).toContain(mustHave);
    }
    // 方法也要抽到：POST 家族与 GET 家族都非空。
    expect(extracted.some((r) => r.method === 'POST')).toBe(true);
    expect(extracted.some((r) => r.method === 'GET')).toBe(true);
  });

  it('源码里每条已注册路由都在决策矩阵中表态（新路由不表态即红）', () => {
    const matrixKeys = new Set(DECISION_MATRIX.map((e) => `${e.method} ${e.path}`));
    const unclassified = extracted.filter((r) => !matrixKeys.has(`${r.method} ${r.path}`));
    expect(
      unclassified.map((r) => `${r.method} ${r.path} (${r.file})`),
      `以下路由未在 DECISION_MATRIX 中表态类别——每条路由必须显式回答"我为什么有/没有缓存语义"：\n` +
        unclassified.map((r) => `  ${r.method} ${r.path}`).join('\n'),
    ).toEqual([]);
  });

  it('决策矩阵里每条都能在源码中找到（删路由不清理矩阵即红）', () => {
    const sourceKeys = new Set(extracted.map((r) => `${r.method} ${r.path}`));
    const stale = DECISION_MATRIX.filter((e) => !sourceKeys.has(`${e.method} ${e.path}`));
    expect(
      stale.map((e) => `${e.method} ${e.path}`),
      '矩阵中的陈旧条目（源码里已不存在，决策表成了叙事而非契约）：',
    ).toEqual([]);
  });

  it('etag-guarded 与 content-etag 类必须真的调用校验器机制', () => {
    for (const entry of DECISION_MATRIX.filter((e) => e.routeClass === 'etag-guarded' || e.routeClass === 'content-etag')) {
      const route = extracted.find((r) => r.method === entry.method && r.path === entry.path);
      expect(route, `${entry.path} 未被提取到`).toBeTruthy();
      expect(
        usesValidatorMechanism(route!.slice),
        `${entry.path} 声明为 ${entry.routeClass} 但源码切片里没有 checkEtag/etagGuard/returnIfEtagMatch`,
      ).toBe(true);
    }
  });

  it('post / sse / diagnostic / static-worker 类不得调用校验器机制（304 语义不适用）', () => {
    for (const entry of DECISION_MATRIX.filter((e) => e.routeClass !== 'etag-guarded' && e.routeClass !== 'content-etag')) {
      const route = extracted.find((r) => r.method === entry.method && r.path === entry.path);
      expect(route, `${entry.path} 未被提取到`).toBeTruthy();
      expect(
        usesValidatorMechanism(route!.slice),
        `${entry.path} 分类为 ${entry.routeClass}（${entry.rationale}），却调用了校验器机制——` +
          '要么分类错了，要么这是把 304 语义错误地套在不适用的路由上',
      ).toBe(false);
    }
  });

  it('content-etag 的校验值必须来自磁盘内容而非缓存图槽（P0-R16-02 家族）', () => {
    const deps = extracted.find((r) => r.path === '/api/v1/codegraph/dependencies');
    expect(deps, '/dependencies 未被提取到').toBeTruthy();
    // 构造点必须是 computeDependenciesEtag（身份=工作区+manifest 内容），且 200 回写走 etagHeaders。
    expect(deps!.slice).toContain('computeDependenciesEtag(');
    expect(deps!.slice).toMatch(/etagHeaders\(depEtag\)/);
    // 反向：不得用 resourceEtag/etagGuard 取缓存图槽的 revision——那会让"图变了"错误地
    // 失效 /dependencies 的校验值，而"manifest 变了"却因图槽未变而假 304。
    expect(deps!.slice).not.toMatch(/etagGuard\(|resourceEtag\(|returnIfEtagMatch\(/);
  });

  it('纯函数：computeDependenciesEtag 的身份维度（同输入同值 / 内容变则变 / 工作区变则变）', async () => {
    const { computeDependenciesEtag } = await import('../../src/host/routes/analysisRoutes.ts');
    const manifestsA = ['package.json {"name":"cg"}'];
    const manifestsB = ['package.json {"name":"cg","version":"2"}'];
    const a = computeDependenciesEtag('/ws', manifestsA);
    expect(a).toMatch(/^W\/"/);
    // 同输入 ⇒ 确定性。
    expect(computeDependenciesEtag('/ws', manifestsA)).toBe(a);
    // 内容变 ⇒ 校验值变。
    expect(computeDependenciesEtag('/ws', manifestsB)).not.toBe(a);
    // 工作区变 ⇒ 校验值变（跨工作区不得共用校验器）。
    expect(computeDependenciesEtag('/other', manifestsA)).not.toBe(a);
    // manifest 集合变（文件消失）⇒ 校验值变。
    expect(computeDependenciesEtag('/ws', [])).not.toBe(a);
  });

  it('反向自检：合成的"POST 路由却调校验器"违规样本必须被分类断言抓到', () => {
    // 样本用拼接构造，避免正则匹配到本文件自己的字面量（cycle-92/93 教训）。
    const ce = 'check' + 'Etag(';
    const syntheticPost = `export function registerFake(rc) {
      const routePath = '/api/v1/codegraph/fake';
      ctx.webServer.register({ kind: 'exact', path: routePath, handler: withRouteMiddleware('POST', routePath, c, r, async (req, res) => {
        if (${ce}req, res, corsConfig, etag)) return;
      }) });
    }`;
    const extracted = extractRoutes('src/host/routes/analysisRoutes.ts');
    // 用同一提取器跑合成样本：把它当作独立文件的内容重放提取逻辑。
    const code = stripComments(syntheticPost);
    const slice = code;
    const pathMatch = slice.match(/const routePath = (?:'([^']+)'|LAYOUT_WORKER\.ROUTE_PATH)/);
    const methodMatch = slice.match(/withRouteMiddleware\('(GET|POST)'/);
    expect(pathMatch?.[1]).toBe('/api/v1/codegraph/fake');
    expect(methodMatch?.[1]).toBe('POST');
    // POST 却用校验器 ⇒ 第五条断言的判据必须判红。
    expect(usesValidatorMechanism(slice)).toBe(true);
    // 而 decisions 里没有它 ⇒ 第三条断言会判红。两个判据都真实承重。
    const matrixKeys = new Set(DECISION_MATRIX.map((e) => `${e.method} ${e.path}`));
    expect(matrixKeys.has('POST /api/v1/codegraph/fake')).toBe(false);
    // 真实 analysisRoutes 的 /diff（POST）必须不含校验器——证明真实断言目标非空。
    const diff = extracted.find((r) => r.path === '/api/v1/codegraph/diff');
    expect(diff?.method).toBe('POST');
    expect(usesValidatorMechanism(diff!.slice)).toBe(false);
  });
});
