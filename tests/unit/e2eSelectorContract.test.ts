import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { detectCyclesDFS } from '../../src/shared/analysis/CycleDFS.ts';

/**
 * 契约测试：E2E 选择器不得再与源码静默脱节（cycle-81 的结构性收口，cycle-93 收紧）。
 *
 * 背景：TODO-02 在 `docs/需求分析.md` 里被登记 12 次、跨 8 轮，描述一直是「Playwright 超时」。
 * 实测证伪——页面完全正常，真正原因是**工具栏模块化后类名变了，21 个 spec 里的字符串字面量没人跟着改**
 * （`.cg-search-btn`、`.cg-layout-btn`、`.cg-view-mode-btn`、`.cg-theme-btn`、`.cg-minimap` 等 15 个）。
 *
 * ## cycle-93 修的是「守卫空转」（与 cycle-92 视觉守卫同族）
 *
 * cycle-81 写了这个文件，但它有两处结构性漏洞，使 **52 处裸选择器长期免检**：
 *
 *   1. 断言只拦「既不在 selectors.ts 也不 dynamic」的 token（旧版 :88-104），
 *      **已登记 token 的裸用完全放行**——于是 `.cg-graph-container` 在 10 个 spec 里
 *      重复了 48 次，没有任何一条断言看得见；
 *   2. 动态面板豁免写成「任何 `/^cg-[a-z-]+-panel$/` 形状都放行」，
 *      而 `HAS_DYNAMIC_PANEL` 取的是 `SRC_TEXT.includes('cg-${variant}-panel')`（恒真），
 *      于是**独立组件** `RuleConfigPanel.tsx:32` 的静态 `cg-rule-panel` 也被当成模板产物放行。
 *
 * 收紧后的四条契约：
 *
 *   1. `selectors.ts` 里每个 `cg-*` 字面量都必须能在 `src/` 静态找到
 *      （动态族按**真实调用点抽出的 variant 集合**放行，不再按形状放行）；
 *   2. spec / helpers 里**不得出现 selectors.ts 已登记 token 的裸字面量**——
 *      必须引用单一事实源常量，报错时直接给出应替换的常量名；
 *   3. 两个"数据属性伪装成类名"的坑不得复现：节点类型是 `[type="..."]`、聚类是 `[?isCluster]`
 *      （`isCluster` 是布尔数据属性，`[isCluster="true"]` 只匹配字符串，见 cycle-89 与
 *      `tests/unit/styleSelectorContract.test.ts`），不是 cytoscape 类名，
 *      所以 `getCyNodeIdsByClass(page, 'function' | 'cluster')` 必须已绝迹；
 *   4. 每条断言都带**反向自检**与**防空转断言**（扫描到的文件数/字面量数必须非零），
 *      否则正则写坏了守卫会永远绿——这正是 cycle-93 的教训。
 */
const ROOT = resolve(__dirname, '../..');
const E2E_DIR = resolve(ROOT, 'tests/e2e');
const SRC_DIR = resolve(ROOT, 'src');

/**
 * 去掉注释，但**逐字符保留换行**。
 *
 * 旧版是把块注释整体删掉（正则里直接替换成空串），行号会整体上移，报错指到错误的位置；
 * 而且它会把反引号模板串里的行注释与块注释标记也吃掉（helpers.ts 的三处误报就是这么来的）。
 * 改成「把注释内容替换成等长空格」，既保行号也保列宽。
 *
 * 注意：本注释里刻意不写出块注释的起止符号本身——那会提前关闭这个文档注释，
 * 让后面的正文变成代码（cycle-93 实际踩过一次，esbuild 报的行号指到 30 行之后）。
 */
function stripComments(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
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

/**
 * `cg-<variant>-panel` 族的**真实 variant 集合**，从 `AnalysisPanelShell` 的调用点抽出。
 *
 * 为什么不能按形状放行：`RuleConfigPanel.tsx:32` 的 `cg-rule-panel` 是独立组件写的静态
 * 字面量，形状上和模板产物无法区分，旧版守卫因此把它一起放行了。
 * 从调用点抽取后，集合里只有真的传给模板的 variant，`rule` 不在其中 ⇒ 它必须显式登记。
 */
const DYNAMIC_PANEL_VARIANTS: string[] = (() => {
  const found = new Set<string>();
  const re = /AnalysisPanelShell[\s\S]{0,200}?variant="([a-z-]+)"/g;
  for (const m of SRC_TEXT.matchAll(re)) {
    if (m[1]) found.add(m[1]);
  }
  return [...found].sort();
})();

/** 静态选择器字面量 → 应使用的常量名（从 selectors.ts 的 `export const X = {...} as const` 反查）。 */
const STATIC_TOKEN_HINT = new Map<string, string>();
for (const m of SELECTORS_CODE.matchAll(/export const (\w+)\s*=\s*\{([\s\S]*?)\}\s*as const/g)) {
  const [, group, body] = m;
  for (const e of (body ?? '').matchAll(/(\w+)\s*:\s*'([^']+)'/g)) {
    const token = (e[2] ?? '').replace(/^[.#]/, '');
    if (token.startsWith('cg-') && !STATIC_TOKEN_HINT.has(token)) {
      STATIC_TOKEN_HINT.set(token, `${group}.${e[1]}`);
    }
  }
}

/** `OPTION` 族（函数式）的前缀 → 应使用的函数名。 */
const OPTION_PREFIX_HINT = new Map<string, string>();
for (const m of SELECTORS_CODE.matchAll(/(\w+)\s*:\s*\([^)]*\)\s*=>\s*`\.([^`$]+)\$\{/g)) {
  if (m[2]) OPTION_PREFIX_HINT.set(m[2], m[1] as string);
}

/** 去掉 `DYNAMIC_PREFIXES` 声明本身后再取 token，避免前缀被当成选择器。 */
const SELECTOR_TOKENS = tokensOf(
  SELECTORS_CODE.replace(/DYNAMIC_PREFIXES\s*=\s*\[[\s\S]*?\]/, '')
);

function isDynamicPanel(token: string): boolean {
  const m = /^cg-(.+)-panel$/.exec(token);
  return m !== null && DYNAMIC_PANEL_VARIANTS.includes(m[1] as string);
}

function isDynamic(token: string): boolean {
  return DYNAMIC_PREFIXES.some((p) => token.startsWith(p)) || isDynamicPanel(token);
}

/**
 * 一个字面量里的某个 token 是不是「选择器/类名」用法。
 *
 * 判据只看 token **在字面量内部的紧邻前缀**，而不是整个字面量的形状——
 * 模板串 `\`${PANELS.pathBar} .cg-close-btn\`` 以 `$` 开头，按整串形状判断会被整条漏掉
 * （cycle-93 实测：这个洞让 search-and-analysis.spec.ts:215 逃过一次）。
 *
 * 两种情况算选择器：
 *   - token 前一个字符是 `.` 或 `#`（CSS 选择器写法）；
 *   - 整个字面量就是这个 token（裸类名，用于 `toHaveClass` / `classList.contains`）。
 *
 * 测试标题里的散文（例如 `'active view mode option carries cg-active'`）不算。
 */
function isSelectorUsage(literal: string, tokenIndex: number, token: string): boolean {
  if (literal.trim() === token) return true;
  const prev = literal[tokenIndex - 1];
  return prev === '.' || prev === '#';
}

/** 每个被扫描文件里的裸字面量。 */
interface Offender {
  file: string;
  line: number;
  token: string;
  suggestion: string;
}

const QUOTED_RE = /(['"`])((?:[^'"`\\]|\\.)*?)\1/g;

function scanBareLiterals(file: string, code: string): { offenders: Offender[]; literals: number } {
  const offenders: Offender[] = [];
  let literals = 0;
  code.split('\n').forEach((line, idx) => {
    QUOTED_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUOTED_RE.exec(line))) {
      const inner = m[2] ?? '';
      TOKEN_RE.lastIndex = 0;
      let t: RegExpExecArray | null;
      while ((t = TOKEN_RE.exec(inner))) {
        const token = t[0];
        if (!isSelectorUsage(inner, t.index, token)) continue;
        // `[class*="cg-level-option-"]`：属性子串匹配，token 是模式而不是选择器。
        // 前缀要在**整行**上找：属性名在引号之外，字面量内部只有 token 本身。
        if (line.slice(Math.max(0, m.index - 12), m.index).includes('class*=')) continue;
        literals += 1;
        if (isDynamicPanel(token)) continue;
        const staticHint = STATIC_TOKEN_HINT.get(token);
        if (staticHint) {
          offenders.push({ file, line: idx + 1, token, suggestion: staticHint });
          continue;
        }
        const optionFn = [...OPTION_PREFIX_HINT.keys()].find((p) => token.startsWith(p));
        if (optionFn) {
          offenders.push({
            file,
            line: idx + 1,
            token,
            suggestion: `OPTION.${OPTION_PREFIX_HINT.get(optionFn)}('…')`,
          });
          continue;
        }
        // 运行时常量前缀（`DYNAMIC_PREFIXES`）不是固定字面量，按前缀放行。
        if (DYNAMIC_PREFIXES.some((p) => token.startsWith(p))) continue;
        // 既不是已知常量、也不是动态族：这是**未登记**的选择器。
        // 旧守卫在这里报「必须先进 selectors.ts」，cycle-93 保留该行为——
        // 否则「新写一个拼错的选择器」会从两个方向都溜过去。
        offenders.push({ file, line: idx + 1, token, suggestion: '先登记到 selectors.ts 再引用' });
      }
    }
  });
  return { offenders, literals };
}

const SCANNED_FILES = collectFiles(E2E_DIR, ['.ts']).filter((f) => f !== SELECTORS_PATH);

describe('E2E selector contract (cycle-81 / cycle-93)', () => {
  it('动态面板 variant 集合必须从真实调用点抽出（防空转 + 反向自检）', () => {
    // 防空转：正则写坏 / SRC_TEXT 为空都会让集合变空，那样所有 `*-panel` 都会变成"非动态"
    // 而被断言①判为 missing——但那时的失败原因是"守卫坏了"，不是"源码漂移了"。
    expect(
      DYNAMIC_PANEL_VARIANTS.length,
      `没有从 src/ 抽到任何 AnalysisPanelShell variant（找到：${DYNAMIC_PANEL_VARIANTS.join(',')}）`
    ).toBeGreaterThanOrEqual(7);
    // 反向自检：真的调用点必须在集合里……
    expect(DYNAMIC_PANEL_VARIANTS).toContain('runtime');
    // ……而独立组件（非模板族）必须**不在**，否则 `cg-rule-panel` 会再次免检。
    expect(
      DYNAMIC_PANEL_VARIANTS,
      'rule 是独立组件（RuleConfigPanel.tsx:32），不是 AnalysisPanelShell 族'
    ).not.toContain('rule');
  });

  it('selectors.ts 里每个 cg-* 字面量都能在 src/ 中找到', () => {
    const missing = SELECTOR_TOKENS.filter((t) => !isDynamic(t) && !SRC_TEXT.includes(t));
    expect(missing, `以下选择器在 src/ 中不存在，说明源码又漂移了：${missing.join(', ')}`).toEqual([]);
  });

  it('spec / helpers 里不得裸用 selectors.ts 已登记的选择器字面量', () => {
    // 防空转：文件收集失败会让下面循环零次执行，断言恒绿。
    expect(SCANNED_FILES.length, '没有扫到任何 tests/e2e/*.ts，扫描器可能坏了').toBeGreaterThanOrEqual(20);

    const all: Offender[] = [];
    for (const f of SCANNED_FILES) {
      all.push(...scanBareLiterals(f, stripComments(readFileSync(f, 'utf8'))).offenders);
    }

    // 注意：这里**不能**用「扫到多少字面量」当防空转判据。收口完成后正确的数量就是 0
    // （所有选择器都来自常量），拿数量当判据会把「修好了」误判成「扫描器坏了」。
    // 扫描器的有效性由下面那条反向自检用例单独证明（喂合成的违规样本，必须被认出）。

    const report = all.map(
      (o) =>
        `  ${o.file.replace(ROOT + '\\', '')}:${o.line}  '${o.token}'  → 用 ${o.suggestion}`
    );
    expect(
      all,
      `以下位置裸用了选择器字面量，必须改为 selectors.ts 的常量（单一事实源）：\n${report.join('\n')}`
    ).toEqual([]);
  });

  it('反向自检：裸字面量扫描器必须能认出已知的违规样本', () => {
    // 把违规样本按字符串拼接构造，避免扫描器扫到自己的字面量（cycle-92 的教训）。
    const dot = '.' + 'cg-graph-container';
    const bare = 'cg-' + 'active';
    const sample = `const a = '${dot}'; const b = '${bare}';`;
    const { offenders } = scanBareLiterals('sample.ts', sample);
    const tokens = offenders.map((o) => o.token).sort();
    expect(tokens).toEqual(['cg-active', 'cg-graph-container']);
    // 未登记的选择器同样要被拦下（否则拼错的新类名会静默通过）。
    expect(scanBareLiterals('s.ts', "const x = '.cg-not-registered';").offenders).toHaveLength(1);
    // 动态面板族与 OPTION 族不得被误判：前者按 variant 集合放行，后者给出函数式提示。
    expect(scanBareLiterals('s.ts', "const c = '.cg-hotspot-panel';").offenders).toEqual([]);
    expect(scanBareLiterals('s.ts', "const d = '.cg-layout-option-dagre';").offenders).toHaveLength(1);
    // 属性子串匹配（`[class*="cg-level-option-"]`）是模式而非选择器，必须放行。
    expect(scanBareLiterals('s.ts', 'const e = \`[class*="cg-level-option-"]\`;').offenders).toEqual([]);
    // 散文标题里的 token 不算选择器用法。
    expect(scanBareLiterals('s.ts', "it('active view mode option carries cg-active', () => {});").offenders).toEqual([]);
  });

  it('不得用 cytoscape 类名断言节点类型 / 聚类（数据属性不是类名）', () => {
    const e2eText = SCANNED_FILES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    const badClassCalls = [
      ...e2eText.matchAll(/getCyNodeIdsByClass\([^)]*['"](function|class|variable|module|interface)['"]/g),
      ...e2eText.matchAll(/getCyNodeIdsByClass\([^)]*['"]cluster['"]/g),
    ].map((m) => m[0]);
    expect(
      badClassCalls,
      '节点类型是 cytoscape 数据属性（DataController.ts:262），聚类是布尔属性 isCluster；' +
        '用 getCyNodeIdsByClass 查询它们永远返回空集，必须用 getCyNodeIdsByType / node.data(\'isCluster\')'
    ).toEqual([]);
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
