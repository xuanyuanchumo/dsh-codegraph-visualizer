import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { detectCyclesDFS } from '../../src/shared/analysis/CycleDFS.ts';

/**
 * 契约测试：E2E 选择器不得再与源码静默脱节（cycle-81 的结构性收口）。
 *
 * 背景：TODO-02 在 `docs/需求分析.md` 里被登记 12 次、跨 8 轮，描述一直是「Playwright 超时」。
 * 实测证伪——页面完全正常，真正原因是**工具栏模块化后类名变了，21 个 spec 里的字符串字面量没人跟着改**
 * （`.cg-search-btn`、`.cg-layout-btn`、`.cg-view-mode-btn`、`.cg-theme-btn`、`.cg-minimap` 等 15 个）。
 * 散落的字面量意味着"漂移"没有守卫，所以这里钉三件事：
 *
 *   1. `tests/e2e/selectors.ts` 里每个 `cg-*` 字面量都必须能在 `src/` 静态找到（动态拼接族按前缀放行）；
 *   2. spec 文件里不得出现 `selectors.ts` 未定义的 `cg-*` 类选择器（想加新选择器必须先进单一事实源）；
 *   3. 两个"数据属性伪装成类名"的坑不得复现：节点类型是 `[type="..."]`、聚类是 `[isCluster="true"]`，
 *      不是 cytoscape 类名，所以 `getCyNodeIdsByClass(page, 'function' | 'cluster')` 必须已绝迹。
 */
const ROOT = resolve(__dirname, '../..');
const E2E_DIR = resolve(ROOT, 'tests/e2e');
const SRC_DIR = resolve(ROOT, 'src');

/** 去掉注释，避免"注释里记录了旧类名"被当成真实使用。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collectFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const SRC_TEXT = collectFiles(SRC_DIR, ['.ts', '.tsx', '.css'])
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const SELECTORS_PATH = resolve(E2E_DIR, 'selectors.ts');
const SELECTORS_RAW = readFileSync(SELECTORS_PATH, 'utf8');
const SELECTORS_CODE = stripComments(SELECTORS_RAW);

/** `cg-` 开头的 token；排除 `data-cg-*` 这类数据属性（`cg-` 前是 `-`）。 */
const TOKEN_RE = /(?<![\w-])cg-[A-Za-z0-9_-]+/g;

function tokensOf(text: string): string[] {
  return [...new Set(text.match(TOKEN_RE) ?? [])];
}

/** `DYNAMIC_PREFIXES` 数组里的运行时拼接族。 */
const DYNAMIC_PREFIXES: string[] = (() => {
  const m = SELECTORS_CODE.match(/DYNAMIC_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error('selectors.ts 里找不到 DYNAMIC_PREFIXES');
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
})();

/** 动态拼接的 `cg-<variant>-panel` 族（`AnalysisPanelShell.tsx:23`）。 */
const DYNAMIC_PANEL_SUFFIX = '-panel';
const HAS_DYNAMIC_PANEL = SRC_TEXT.includes('cg-${variant}-panel');

/** 去掉 `DYNAMIC_PREFIXES` 声明本身后再取 token，避免前缀被当成选择器。 */
const SELECTOR_TOKENS = tokensOf(
  SELECTORS_CODE.replace(/DYNAMIC_PREFIXES\s*=\s*\[[\s\S]*?\]/, '')
);

function isDynamic(token: string): boolean {
  if (DYNAMIC_PREFIXES.some((p) => token.startsWith(p))) return true;
  if (HAS_DYNAMIC_PANEL && token.endsWith(DYNAMIC_PANEL_SUFFIX) && /^cg-[a-z-]+-panel$/.test(token)) {
    return true;
  }
  return false;
}

describe('E2E selector contract (cycle-81 / TODO-02)', () => {
  it('selectors.ts 里每个 cg-* 字面量都能在 src/ 中找到', () => {
    const missing = SELECTOR_TOKENS.filter((t) => !isDynamic(t) && !SRC_TEXT.includes(t));
    expect(missing, `以下选择器在 src/ 中不存在，说明源码又漂移了：${missing.join(', ')}`).toEqual([]);
  });

  it('spec 文件里不得出现 selectors.ts 未定义的 cg-* 类选择器', () => {
    const known = new Set(SELECTOR_TOKENS);
    const offenders: string[] = [];

    for (const file of collectFiles(E2E_DIR, ['.ts']).filter((f) => f.endsWith('.spec.ts'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const token of tokensOf(code)) {
        if (known.has(token) || isDynamic(token)) continue;
        offenders.push(`${file.replace(ROOT + '\\', '')}: ${token}`);
      }
    }

    expect(
      offenders,
      `裸选择器必须先进 tests/e2e/selectors.ts（单一事实源）：\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('不得再用类名选择器取"数据属性"节点（type / isCluster）', () => {
    const specText = collectFiles(E2E_DIR, ['.ts'])
      .map((f) => stripComments(readFileSync(f, 'utf8')))
      .join('\n');

    // 节点类型与聚类标记都写在 cytoscape `data` 里，`.function` / `.cluster` 永远选不到节点。
    expect(specText).not.toMatch(/getCyNodeIdsByClass\([^)]*['"](function|class|variable|module|interface)['"]/);
    expect(specText).not.toMatch(/getCyNodeIdsByClass\([^)]*['"]cluster['"]/);
    // 正解是数据属性选择器辅助函数。
    expect(readFileSync(resolve(E2E_DIR, 'helpers.ts'), 'utf8')).toContain('export async function getCyNodeIdsByType(');
  });

  it('helpers.ts 的 fetchGraphApi 必须检查 res.ok（dev-server 404 曾伪装成 JSON 解析错误）', () => {
    const helpers = readFileSync(resolve(E2E_DIR, 'helpers.ts'), 'utf8');
    expect(helpers).toContain('if (!res.ok)');
    expect(helpers).toContain('returned non-JSON body');
  });

  it('筛选 checkbox 必须按 id 寻址（源码只写了 id/name，没有 className）', () => {
    // `FilterPanel.tsx:143-172` 把 `cg-filter-node-*` / `cg-filter-edge-*` 只写在
    // `id` 与 `name` 上，用 `.cg-filter-node-function` 永远选不到——cycle-81 的第二根因。
    const filterPanel = readFileSync(resolve(SRC_DIR, 'client/components/FilterPanel.tsx'), 'utf8');
    expect(filterPanel).toContain('id={`cg-filter-node-${type}`}');
    expect(filterPanel).not.toMatch(/className="cg-filter-node-/);

    expect(SELECTORS_CODE).toContain('nodeType: (type: string) => `#cg-filter-node-${type}`');
    expect(SELECTORS_CODE).toContain('edgeType: (type: string) => `#cg-filter-edge-${type}`');
    expect(SELECTORS_CODE).not.toMatch(/nodeType: \(type: string\) => `\.cg-filter-node-/);
  });

  it('dev-server 必须提供插件 CSS 并打开 __cg_debug（否则样式全丢、store 断言拿到 null）', () => {
    const devServer = readFileSync(resolve(ROOT, 'scripts/dev-server.mjs'), 'utf8');

    // 插件 CSS 只能由页面以 <link> 引入（ESM 产物不内联样式），且必须指向构建产物：
    // 旧值 `/src/client/styles.css` 在 CSS 模块化拆分后已不存在，导致每次加载都 404。
    expect(devServer).toContain('href="/dist/client/index.css"');
    expect(devServer).not.toContain('href="/src/client/styles.css"');

    // `window.__graphStore` 只在 localStorage.__cg_debug === '1' 时挂载
    // （`src/client/store/graphStore.ts:174-176`）。
    expect(devServer).toContain("localStorage.setItem('__cg_debug', '1')");
  });

  it('工具栏「工具」下拉的分析面板必须先切行为层视图（否则条目根本不渲染）', () => {
    // `getAvailablePanels(getViewLayer(viewMode))` 按视图层过滤工具下拉；
    // 默认 code 视图是 structural 层，不含调用链/循环/影响/继承/热点/上帝模块/核心函数。
    const viewModeUtils = readFileSync(resolve(SRC_DIR, 'shared/viewModeUtils.ts'), 'utf8');
    const structural = viewModeUtils.match(/STRUCTURAL_PANELS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(structural, '找不到 STRUCTURAL_PANELS').toBeTruthy();
    for (const behavioralOnly of ['showCallChain', 'showCycles', 'showImpact', 'showInheritance', 'showHotspot', 'showGodModule', 'showCoreFunction']) {
      expect(structural![1]).not.toContain(behavioralOnly);
    }
    // helpers.ts 必须提供进入行为层的入口。
    expect(readFileSync(resolve(E2E_DIR, 'helpers.ts'), 'utf8')).toContain(
      'export async function setupPluginPageInBehavioralLayer('
    );
  });

  it('dev-server 桩图必须满足调用视图装配器（否则 J5/J31 在 E2E 里永远不可验证）', () => {
    // cycle-81 的最后一个根因，也是最隐蔽的一个：桩数据里「环」与被选中的节点都是
    // `class`，而 `src/client/diagram/CallGraphAssembler.ts:5` 的
    // `CALL_NODE_TYPES = new Set(['function'])` 会在装配前把它们全部过滤掉。
    // 症状是面板不出现（`RightPanelStack.tsx:86/90` 的 visible 条件为 false），
    // 报错却落在几秒后的 toBeVisible 上，根因完全不可见。
    const devServer = readFileSync(resolve(ROOT, 'scripts/dev-server.mjs'), 'utf8');

    // 真源唯一：页面内联脚本与服务端 API 不得各写一份（历史上是 21 节点 vs 6 节点）。
    expect(devServer.match(/^const MOCK_GRAPH = \{/gm) ?? []).toHaveLength(1);
    expect(devServer).toContain('const API_GRAPH = MOCK_GRAPH;');
    expect(devServer).toContain('${JSON.stringify(MOCK_GRAPH)}');

    // 取出 MOCK_GRAPH 字面量并复算装配结果（只做「类型过滤 + 环存在」这两条硬约束，
    // 不复制装配器实现——装配器自身的正确性由它自己的单测负责）。
    const start = devServer.indexOf('const MOCK_GRAPH = {');
    const end = devServer.indexOf('\n};', start);
    expect(start, '找不到 MOCK_GRAPH 定义').toBeGreaterThan(-1);
    const graph = JSON.parse(
      JSON.stringify(eval(`(${devServer.slice(start + 'const MOCK_GRAPH = '.length, end + 2)})`))
    ) as { nodes: Array<{ id: string; type: string }>; edges: Array<{ source: string; target: string; type: string }> };

    // 1) 调用视图里必须真的存在 function 节点（J31 要 selectNode 命中）。
    const fnIds = new Set(graph.nodes.filter((n) => n.type === 'function').map((n) => n.id));
    expect(fnIds.size, '调用视图装配后没有任何 function 节点，分析面板无法验证').toBeGreaterThan(0);

    // 2) 必须存在**函数级**环：两端都是 function 的 call 边构成的环。
    //    只用 call 边与 function 节点复算，等价于装配器的类型过滤。
    const forward = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (e.type !== 'call' || !fnIds.has(e.source) || !fnIds.has(e.target)) continue;
      forward.set(e.source, [...(forward.get(e.source) ?? []), e.target]);
    }
    const cycles = detectCyclesDFS(forward);
    expect(
      cycles.length,
      `调用视图里不存在函数级环（可用 function 节点：${[...fnIds].join(',')}）——` +
        'J5「should display cycle panel」将永远拿不到 cycleDetails。' +
        '修法：让成环的两端都是 function，例如 n9 → n11 → n9。'
    ).toBeGreaterThan(0);

    // 3) E2E 里「先选中再断言面板」必须用严格选中，避免静默 no-op 再次隐藏根因。
    expect(readFileSync(resolve(E2E_DIR, 'helpers.ts'), 'utf8')).toContain(
      'export async function selectNodeStrict('
    );
  });
});
