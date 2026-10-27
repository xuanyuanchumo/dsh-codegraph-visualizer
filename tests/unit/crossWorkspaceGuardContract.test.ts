import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 契约测试：P0-R16-01 的结构性收口必须**长期**成立，而不是"这一轮改对了"。
 *
 * 背景：跨工作区污染在 Round 15 与 Round 16 各出现一次（同一类缺陷两次），根因是"守卫写在调用点，
 * 新增通道时被漏掉"。因此这里用源码级契约把三件事钉死：
 *   1. 判定原语住在 `shared/`（`api/` 与 `runtime/` 都能用，且 `api/` 不反向依赖 `runtime/`）；
 *   2. 增量取数的 `scopeRepoId` 是**必填**参数，杜绝"新增调用点不表态"；
 *   3. 运行时不存在绕过 `applyScopedGraphPayload` 的手写 `setGraphData` 落库路径。
 */
const ROOT = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

describe('cross-workspace guard contract (P0-R16-01)', () => {
  it('keeps the identity primitive in shared/ so api/ need not depend on runtime/', () => {
    const graphScope = read('src/shared/graphScope.ts');
    expect(graphScope).toContain('export function isForeignRepo(');

    // `api/` 只能用 shared 层，不能反向 import runtime/。
    const api = read('src/client/api/index.ts');
    expect(api).toContain("from '../../shared/graphScope.ts'");
    expect(api).not.toMatch(/from '\.\.\/runtime\//);
  });

  it('requires the scope identity on the incremental fetch, so no call site can omit it', () => {
    const api = read('src/client/api/index.ts');
    // 必填（非可选）参数：没有 `?`，也没有默认值。
    expect(api).toMatch(/export async function fetchGraphDataIncremental\(\s*clientEtag: string \| null \| undefined,\s*scopeRepoId: string \| null \| undefined,\s*\)/);
    expect(api).not.toMatch(/scopeRepoId\?:/);
    // 取数层必须在返回前比对响应身份。
    expect(api).toContain('if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {');
  });

  // P0-R16-02：校验器域与展示时钟域必须分开。`store.lastUpdated` 是 `Date.now()`（客户端时钟）
  // 与 `metadata.timestamp`（服务端时钟）混写的展示字段，把它当 `if-none-match` 传会同时造成
  // "304 永不命中"与"假 304 静默吞掉真实更新"两种错。宿主侧的校验值含身份与资源维度，客户端
  // 无从推导，只能原样回传。
  it('never feeds the display clock into the HTTP validator', () => {
    const api = read('src/client/api/index.ts');
    expect(api).not.toMatch(/if-none-match':\s*String\(/);

    for (const rel of ['src/client/runtime/SSEEvents.ts', 'src/client/runtime/WindowEvents.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/fetchGraphDataIncremental\(\s*store\.lastUpdated/);
      expect(src).toMatch(/fetchGraphDataIncremental\(\s*store\.graphEtag/);
    }
  });

  it('scopes the host validator by resource, so one endpoint cannot answer another\'s 304', () => {
    const shared = read('src/host/routes/shared.ts');
    // `resource` 必填：省略它就能拿 `/data` 的校验值让 `/children` 回 304。
    expect(shared).toMatch(/resource: GraphEtagResource/);
    expect(shared).toContain('computeGraphEtag(');

    // 资源维度必须在**每个调用点**被显式声明。校验入口有两个：`returnIfEtagMatch`（布尔便捷形式，
    // `/data` 用它，因为它的校验值另有一处手工构造）与 `etagGuard`（一次给出 304 判定与待回写的
    // etag）。断言不能只认其中一种写法，否则把调用点迁到 `etagGuard` 会让守卫转红——那不是缺陷，
    // 是守卫本身写窄了；但也不能放宽成"只要出现字符串就行"，必须锚定"函数调用 + 资源字面量"。
    const dataRoutes = read('src/host/routes/dataRoutes.ts');
    const RESOURCES = ['graph', 'bootstrap', 'children', 'outline', 'ast', 'edges'] as const;
    for (const resource of RESOURCES) {
      expect(dataRoutes).toMatch(
        new RegExp(`(?:returnIfEtagMatch|etagGuard)\\([^)]*'${resource}'`),
      );
    }

    // 反向自检：正则必须真的能区分资源维度。用 `'outline'` 构造一条只差资源名的负样本，
    // 它必须不匹配——否则上面 6 条断言可能在"任意字符串都算命中"的退化状态下恒真。
    expect(`etagGuard(req, res, corsConfig, deps, 'children')`).not.toMatch(
      new RegExp(`(?:returnIfEtagMatch|etagGuard)\\([^)]*'${'outline'}'`),
    );
    // 自检的另一半：正样本必须命中，证明正则不是恒假。
    expect(`etagGuard(req, res, corsConfig, deps, 'outline', ws, key)`).toMatch(
      new RegExp(`(?:returnIfEtagMatch|etagGuard)\\([^)]*'${'outline'}'`),
    );

    // 跨源客户端必须能读到 `etag`，否则增量取数静默退化成全量重取。
    expect(read('src/host/HttpHelpers.ts')).toContain("'access-control-expose-headers'");
  });

  it('keeps exactly one runtime channel that may write a fetched payload to the canvas', () => {
    const repoScope = read('src/client/runtime/repoScope.ts');
    expect(repoScope).toContain('export function applyScopedGraphPayload(');
    expect(repoScope).toContain('if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {');

    // 两条增量通道都必须经由唯一通道落库。
    for (const rel of ['src/client/runtime/SSEEvents.ts', 'src/client/runtime/WindowEvents.ts']) {
      expect(read(rel)).toContain('applyScopedGraphPayload(');
    }

    // 取数结果不得被直接写进画布：`fetchGraphDataIncremental` 的回调里不允许出现 `setGraphData`。
    // （`graph-data` 事件是例外——它的负载就在事件体里，其 `repoId` 与已校验的字段是同一个，
    // 不存在"校验 A、落库 B"的错位，故不在此约束内。）
    for (const rel of ['src/client/runtime/SSEEvents.ts', 'src/client/runtime/WindowEvents.ts']) {
      const src = read(rel);
      const fetchedApply = /fetchGraphDataIncremental\([^)]*\)[\s\S]{0,400}?\.setGraphData\(/;
      expect(src).not.toMatch(fetchedApply);
    }

    // WindowEvents 的增量分支曾经是唯一内联守卫点；收口后它不应再自行写图。
    expect(read('src/client/runtime/WindowEvents.ts')).not.toMatch(/store\.setGraphData\(/);
  });

  it('does not resurrect the dead full-graph fetch export', () => {
    const api = read('src/client/api/index.ts');
    expect(api).not.toMatch(/export async function fetchGraphData\(/);
  });

  // P0-B（cycle-105 真机发现）：宿主侧的内存回落也必须按请求方工作区限定。
  //
  // 这条是上一节「守卫写在调用点、新增通道时被漏掉」在**宿主侧**的同一个病灶：客户端那半边
  // 早已用 `isForeignRepo` 收口（上面的用例钉住了它），但宿主 `/bootstrap`、`/children`、
  // `/files/:id/outline`、`/symbols/:id/ast`、`/edges` 五条路由的内存回落分支全都无条件读
  // 那个唯一图槽。症状不是报错，而是「索引已就绪但画布全空」——静默的空画布。
  //
  // 只断言「用了 getWorkspaceScopedGraphData」是不够的：新增第六条路由时没人会记得写。
  // 所以这里做**计数 + 反向**双向断言：每个 `getLastGraphData()` 的直读点都必须有正当理由，
  // 而五条回落路由必须各自出现一次作用域化调用。
  it('scopes every in-memory graph fallback to the requesting workspace (P0-B)', () => {
    const dataRoutes = read('src/host/routes/dataRoutes.ts');

    // 五条回落路由必须各自经由作用域化取数。计数而非「出现过」，因为
    // 「写了一次、另外四条漏了」正是这个缺陷最初的样子。
    const scopedCalls = dataRoutes.match(/getWorkspaceScopedGraphData\(deps, workspacePath\)/g) ?? [];
    expect(scopedCalls.length).toBe(5);

    // 反向自检：正则必须能区分「作用域化」与「直读槽」。负样本若命中，说明上面的
    // 计数在退化状态下恒真（例如有人把两者都替换成同一个名字）。
    expect('const lastGraphData = deps.getLastGraphData();').not.toMatch(
      /getWorkspaceScopedGraphData\(deps, workspacePath\)/,
    );

    // `/data` 是唯一允许直读槽的路由：它返回的就是「当前槽的全量快照」，由 `computeGraphEtag`
    // 把 repoId 编进校验值，客户端再自行用 `isForeignRepo` 判定。它不参与回落语义。
    const directReads = dataRoutes.match(/deps\.getLastGraphData\(\)/g) ?? [];
    expect(directReads.length).toBe(1);

    // 作用域化取数的实现只能有一份，且必须复用 `sameRepoId` 判据（与 incrementalUpdate /
    // watcher 共用）。三处各自实现会各自漂移，这是 Round 15/16 反复出现的根因。
    const shared = read('src/host/routes/shared.ts');
    expect(shared).toContain('export function getWorkspaceScopedGraphData(');
    expect(shared).toMatch(/if \(!sameRepoId\(slot\.metadata\.repoId, workspacePath\)\) \{/);
    expect(shared).toMatch(/from '\.\.\/\.\.\/shared\/pathUtils\.ts'/);
  });
});
