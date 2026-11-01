/**
 * 可达性守卫（XJ-12）：`src/xuanji` 的每个公共 API 必须有**生产调用点**，否则红灯。
 *
 * ## 为什么需要这一层（这是本项目唯一会为「导出但 0 调用点」变红的测试）
 *
 * 本仓库对 `src/xuanji` 已经有三层测试，各答一个问题，**没有一层回答「有没有人调用」**：
 * - `tests/unit/xuanji/libraryBoundary.test.ts`：库是否自包含（可以独立发布）；
 * - `tests/unit/xuanji/publicApi.test.ts`：符号是否被导出（存在性）；
 * - `tests/unit/xuanjiAdapter.test.ts` + `tests/unit/xuanji/*.test.ts`：行为是否正确。
 *
 * 三者叠加仍然允许「库里有、生产死链」：增量引擎的 `applyDelta` 曾有 0 个生产调用点，
 * 230 个用例全绿。本轮（cycle-109 / XJ-02）把 `XuanjiAdapterPool` 接到 `src/tools.ts`，
 * 本文件就是让这一步**无法被回滚**的那道门。
 *
 * ## 度量口径（必须精确，否则守卫会「看起来绿其实空」）
 *
 * 「生产调用点」的定义是：**某个生产文件从 `src/xuanji/**`（或 barrel `src/xuanji/index.ts`）
 * 显式导入/转出该符号，并在该文件的非声明代码里用到了它**。
 *
 * 不能只数「名字在 src/ 里出现的次数」，因为宿主有同名不同型的符号：
 * `src/types/index.ts` 自己有 branded `NodeId` / `EdgeId`，只按名字数会把库里那两个
 * 别名判成「已被引用」（实测 228 次 / 45 次），而它们其实 0 个宿主引用点。
 * 所以必须先解析导入绑定（含 `as` 别名与 `import * as ns`），再在**剥掉注释与声明行**的
 * 代码体里按绑定名计数。
 *
 * 另外两条刻意选择：
 * - 转出（`export { X as Y } from '../../xuanji/...'`）算一次调用点，因为宿主把它接进了自己的
 *   公共表面（`CycleDFS.ts` 的 `hasCycle` 就是这样被 `RuleEngine` 使用的）；
 * - 注释里的名字**不算**——`src/shared/analysis/XuanjiAdapter.ts` 的注释就写着
 *   `new XuanjiAdapter()`，若不过滤注释，下面那条负向断言会永久为假。
 *
 * ## 三条抗腐化断言（缺一不可）
 *
 * 1. **双向等价**：死符号集合 === 显式豁免表。伤亡方向有两个：新增的未登记死符号（漏报）
 *    与「已经接线却还留着豁免」（豁免表腐化）。两个方向都单独断言。
 * 2. **反向自检**：喂合成样本，只 import 不使用的符号必须判死；import 后真的使用的必须判活。
 *    只做前者的话，「扫描器恒返回空集」也会绿。
 * 3. **非空扫描**：生产文件数 > 100、符号数 >= 60、绑定数 >= 10，防 walk / 解析失败。
 *
 * ## 本文件刻意**不**覆盖的范围（写下来，免得被当成全覆盖）
 *
 * - `XuanjiAdapter` 的**方法**（`registerRule` / `getRule` / `getIndex` / `reachableFrom` /
 *   `stats` / `graph`，见 §四 D-16）：它们不是 barrel 导出，且方法名（`get` / `stats` / `graph`）
 *   与宿主其它对象的方法名撞车，按名字计数无法分辨接收者。该方法面的可达性属于 XJ-13
 *   （`xuanjiIntegrationContract.test.ts`）的写域。
 * - 阈值是否「永不触发」这类语义缺陷：本文件只看调用点存在性，不看参数取值范围。
 * - 测试代码：`tests/**` 一律不计入生产调用点（这里的 oracle 调用不能替生产签名背书）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SRC_ROOT = join(ROOT, 'src');
const LIB_ROOT = join(SRC_ROOT, 'xuanji');
const BARREL = join(LIB_ROOT, 'index.ts');
const TOOLS_FILE = join(SRC_ROOT, 'tools.ts');

// ── 源码预处理 ────────────────────────────────────────────────────────────

/** 正则字面量可能的起始位置：前一个非空白字符落在这些符号之后（`=`、`(`、`,` …）。 */
const REGEX_PRECEDERS = '([{=,:;!&|?+-*%~^<>';

/**
 * 剥掉 `//` 与块注释，**字符级替换为空格并保留换行**。
 *
 * 保留换行是硬要求：删掉注释会让行号整体上移，报错指向错误的位置（仓库里已踩过三次）。
 * 字符串与正则字面量的内容原样保留——正则里的引号（如 `/['"]/`）若被当成字符串开头，
 * 会吞掉后半个文件，调用点计数随之静默失真。
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote: string | null = null;
  let prevSignificant = '';

  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += '\n';
      } else {
        out += ' ';
      }
      i += 1;
      continue;
    }

    if (inBlock) {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 2;
        inBlock = false;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }

    if (quote !== null) {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      out += ch;
      if (ch === quote) {
        quote = null;
        prevSignificant = 'x';
      }
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLine = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && (prevSignificant === '' || REGEX_PRECEDERS.includes(prevSignificant))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        out += source.slice(i, j);
        i = j;
        prevSignificant = 'x';
        continue;
      }
    }

    out += ch;
    if (!/\s/.test(ch)) prevSignificant = ch;
    i += 1;
  }

  return out;
}

/**
 * 把 `import` / `export … from` 声明整段替换为空格（保留换行）。
 *
 * 调用点要在**非声明代码**里数：`import { foo } from …` 那一行本身不是一次使用，
 * 否则「导入了但从未调用」会永远看起来可达。
 */
function blankDeclarations(code: string): string {
  const blank = (chunk: string): string => chunk.replace(/[^\n]/g, ' ');
  let out = code;
  const patterns = [
    // 副作用导入：`import './x.ts';`
    /(?:^|\n)[ \t]*import\s+['"][^'"]+['"]\s*;?/g,
    // 具名/默认/命名空间导入（可跨行）。
    /(?:^|\n)[ \t]*import\s+[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g,
    // `export { a as b } from '…'`
    /(?:^|\n)[ \t]*export\s+(?:type\s+)?\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?/g,
    // `export * from '…'`
    /(?:^|\n)[ \t]*export\s+\*\s+from\s*['"][^'"]+['"]\s*;?/g,
  ];
  for (const pattern of patterns) out = out.replace(pattern, blank);
  return out;
}

function countWord(text: string, word: string): number {
  if (word.length === 0) return 0;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(`\\b${escaped}\\b`, 'g'));
  return matches ? matches.length : 0;
}

/**
 * 数「`receiver.method(` 形态的调用点」，允许可选链（`receiver?.method(`）。
 *
 * 源码里 `xuanjiPool?.invalidate(...)` 与 `xuanjiPool.get(...)` 两种写法都真实存在，
 * 只认点号的写法会把前者漏掉（第一次跑本文件时就漏了）。
 */
function countCalls(text: string, receiver: string, method: string): number {
  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(`\\b${escaped}\\s*\\??\\.\\s*${method}\\s*\\(`, 'g'));
  return matches ? matches.length : 0;
}

// ── 生产文件 / 库内符号 ──────────────────────────────────────────────────

interface ProductionFile {
  readonly rel: string;
  readonly source: string;
}

/** `src/**` 下的非测试 `.ts`——但**排除整棵 `src/xuanji/**`**（库内互相调用不算生产调用点）。 */
function collectProductionFiles(): ProductionFile[] {
  const files: ProductionFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (resolve(full) === resolve(LIB_ROOT)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
      files.push({ rel: relative(ROOT, full).replace(/\\/g, '/'), source: readFileSync(full, 'utf8') });
    }
  };
  walk(SRC_ROOT);
  return files;
}

type SymbolKind = 'value' | 'type';

interface StarWalkState {
  readonly visited: Set<string>;
  readonly exports: Array<{ name: string; kind: SymbolKind | 'unknown' }>;
}

/** 抽取一个模块自身的导出名（含 `export { a as b }` 与 `export *` 的递归）。 */
function extractModuleExports(source: string): Array<{ name: string; kind: SymbolKind | 'unknown' }> {
  const out: Array<{ name: string; kind: SymbolKind | 'unknown' }> = [];
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const name = match[1];
    if (name) out.push({ name, kind: 'value' });
  }
  for (const match of source.matchAll(/export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    if (name) out.push({ name, kind: 'type' });
  }
  for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    const typeOnly = Boolean(match[1]);
    const body = match[2] ?? '';
    for (const piece of body.split(',')) {
      const trimmed = piece.trim();
      if (trimmed.length === 0) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0] ?? '').trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(exported)) continue;
      out.push({ name: exported, kind: typeOnly ? 'type' : 'unknown' });
    }
  }
  return out;
}

/**
 * 以 barrel（`src/xuanji/index.ts`）的 `export *` 为唯一入口，收集公共 API 符号集。
 *
 * 注意 `hasDirectedCycle` / `hasCycleInAdjacency` 只在 `query-engine.ts` 处 re-export 一次，
 * 所以必须跟随模块内的 `export *`，否则会漏掉整个 `ops/cycle-existence.ts`。
 */
function collectBarrelSymbols(): Map<string, SymbolKind> {
  const state: StarWalkState = { visited: new Set(), exports: [] };
  const follow = (file: string): void => {
    if (state.visited.has(file)) return;
    state.visited.add(file);
    let source: string;
    try {
      source = stripComments(readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    state.exports.push(...extractModuleExports(source));
    for (const match of source.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier) follow(resolve(dirname(file), specifier));
    }
  };

  // 从 barrel 本身开始走：`index.ts` 里**直接**写的导出（例如有人 `export const x = 1`）
  // 也是公共 API 的一部分。只遍历 `export *` 的目标会漏掉它们——这条是变异探针抓出来的：
  // 探针 2 往 index.ts 里加 `export const deadProbe = 1;` 时，旧实现报 20 passed。
  follow(BARREL);

  // 库内全量文本用于判定 `unknown`（brace re-export）到底是值还是类型。
  const libraryText = (function readLibrary(): string {
    const parts: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) parts.push(stripComments(readFileSync(full, 'utf8')));
      }
    };
    walk(LIB_ROOT);
    return parts.join('\n');
  })();

  // 判 kind 的事实来源是**库内声明**而不是导出写法：`export { hasDirectedCycle }` 这种
  // brace re-export 不带类型信息，但库内一定有 `export function hasDirectedCycle(…`。
  const symbols = new Map<string, SymbolKind>();
  for (const entry of state.exports) {
    if (symbols.has(entry.name)) continue;
    const declaredAsValue = new RegExp(
      `(?:function|class|const|let|var|enum)\\s+${entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    ).test(libraryText);
    symbols.set(entry.name, declaredAsValue ? 'value' : 'type');
  }
  return symbols;
}

// ── 绑定解析与调用点计数 ─────────────────────────────────────────────────

interface XuanjiBinding {
  readonly file: string;
  readonly specifier: string;
  readonly origin: string;
  readonly alias: string;
  readonly form: 'import' | 'export';
}

interface NamespaceBinding {
  readonly file: string;
  readonly specifier: string;
  readonly alias: string;
}

interface BindingScan {
  readonly bindings: XuanjiBinding[];
  readonly namespaces: NamespaceBinding[];
}

const DECLARATION = /(?:^|\n)[ \t]*(import|export)\s+(type\s+)?(\*|\{[^}]*\}|[A-Za-z_$][\w$]*)\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*['"]([^'"]+)['"]/g;

/**
 * 解析生产文件里所有「指向 `src/xuanji`」的导入/转出绑定。
 *
 * 只认 specifier 里出现 `xuanji` 的声明：宿主对库的引用必然走 `../../xuanji/...` 或 barrel，
 * 这条约束把「同名但属于宿主自己的 `NodeId` / `EdgeId`」彻底排除。
 */
function scanXuanjiBindings(files: readonly ProductionFile[]): BindingScan {
  const bindings: XuanjiBinding[] = [];
  const namespaces: NamespaceBinding[] = [];
  for (const file of files) {
    const code = stripComments(file.source);
    for (const match of code.matchAll(DECLARATION)) {
      const form = match[1] === 'export' ? 'export' : 'import';
      const clause = match[3] ?? '';
      const specifier = match[5] ?? '';
      if (!specifier.includes('xuanji')) continue;

      if (clause === '*') {
        const alias = match[4];
        if (alias) namespaces.push({ file: file.rel, specifier, alias });
        continue;
      }

      if (clause.startsWith('{')) {
        const inner = clause.slice(1, -1);
        for (const piece of inner.split(',')) {
          const trimmed = piece.trim().replace(/^type\s+/, '');
          if (trimmed.length === 0) continue;
          const parts = trimmed.split(/\s+as\s+/);
          const origin = (parts[0] ?? '').trim();
          const alias = (parts[1] ?? parts[0] ?? '').trim();
          if (!/^[A-Za-z_$][\w$]*$/.test(origin) || !/^[A-Za-z_$][\w$]*$/.test(alias)) continue;
          bindings.push({ file: file.rel, specifier, origin, alias, form });
        }
        continue;
      }

      // 默认导入：`import Adapter from '…xuanji…'`（当前仓库没有，保留以便识别）。
      if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
        bindings.push({ file: file.rel, specifier, origin: 'default', alias: clause, form });
      }
    }
  }
  return { bindings, namespaces };
}

interface SymbolReach {
  readonly symbol: string;
  readonly kind: SymbolKind;
  readonly count: number;
  readonly aliases: readonly string[];
}

interface ReachabilityReport {
  readonly dead: SymbolReach[];
  readonly alive: SymbolReach[];
  readonly bindings: XuanjiBinding[];
  readonly namespaces: NamespaceBinding[];
  readonly productionFiles: number;
}

/**
 * 纯函数：给定符号集与文件集，算出每个符号的生产调用点计数。
 *
 * 反向自检直接把合成文件喂进来——扫描器本身因此与「磁盘上的真实仓库」解耦，
 * 可以证明它在合成样本上确实会判死/判活，而不是靠真实数据碰巧为绿。
 */
function analyzeReachability(
  symbols: ReadonlyMap<string, SymbolKind>,
  files: readonly ProductionFile[],
): ReachabilityReport {
  const { bindings, namespaces } = scanXuanjiBindings(files);
  const body = files.map((file) => blankDeclarations(stripComments(file.source))).join('\n');

  const dead: SymbolReach[] = [];
  const alive: SymbolReach[] = [];

  for (const [symbol, kind] of [...symbols].sort((a, b) => a[0].localeCompare(b[0]))) {
    const aliases = [
      ...new Set(bindings.filter((binding) => binding.origin === symbol).map((binding) => binding.alias)),
    ];
    let count = 0;
    for (const alias of aliases) count += countWord(body, alias);
    for (const namespace of namespaces) {
      count += countWord(body, `${namespace.alias}.${symbol}`);
    }
    const reach: SymbolReach = { symbol, kind, count, aliases };
    if (count === 0) dead.push(reach);
    else alive.push(reach);
  }

  return {
    dead,
    alive,
    bindings,
    namespaces,
    productionFiles: files.length,
  };
}

// ── 豁免表（新增一条豁免 = 一次显式评审） ────────────────────────────────

interface ReachabilityExemption {
  readonly symbol: string;
  /** 为什么这个符号**真的**没有生产调用点，以及为什么保留。必须写事实，不许写「暂时」。 */
  readonly reason: string;
  /** 谁会消掉这条豁免（XJ 编号 / D 编号 / `library-internal` / `host-types`）。 */
  readonly owner: string;
}

/**
 * 当前死符号的**完整**清单。
 *
 * 每一条都必须写清「它是什么 + 为什么 0 调用点 + 保留还是待删」。这份表是本轮实测结果
 * （cycle-109），不是从 §四 抄来的：例如 `NodeId` / `EdgeId` 之所以在表里，是因为宿主
 * 有自己的 branded 同名类型，库别名 0 引用——§四 从未列过它们。
 *
 * 生命周期：XJ-03（Ω）、XJ-04（不变量）、XJ-07（topK）、XJ-08（NFA）、XJ-11（预算）落地时
 * 对应条目必须**删掉**；本文件的双向断言会因此变红，逼着改表——这正是它存在的意义。
 */
const DEAD_SYMBOL_EXEMPTIONS: readonly ReachabilityExemption[] = Object.freeze(
  (
    [
      {
        symbol: 'canonicalNodes',
        reason: '库内自用：path-entry 的 makeEntry 用它做旋转规范化；宿主经 XuanjiAdapter 不直接构造条目',
        owner: 'library-internal',
      },
      {
        symbol: 'ChangeEvent',
        reason:
          'D-06 同族：变更日志事件类型；生产侧只经 drainChangeLog 的返回值消费（适配层不 import 类型名），日志本身已有上界 MAX_CHANGE_LOG',
        owner: 'D-06',
      },
      {
        symbol: 'compareNodeSequences',
        reason: '库内自用：路径字典序比较器；宿主不排序路径条目，返回的是映射后的 plain 对象',
        owner: 'library-internal',
      },
      {
        symbol: 'concatHash',
        reason: 'D-15 半死：可拼接幺半群无调用方；宿主只用 PathEntry 内部的整段序列哈希',
        owner: 'D-15',
      },
      {
        symbol: 'edgeTypesBetween',
        reason:
          'cycle-134 库内自用：compilePathRule 的 pathConstraint 内部用它把节点对解析成并列标签；宿主不解析边类型，只传 ρ 文本（与 edgeKey/edgePairKey 同族）',
        owner: 'library-internal',
      },
      {
        symbol: 'PathPatternRuleOptions',
        reason:
          'cycle-134 ρ 编译器的选项类型：适配层 pathsByPattern 直接以内联对象字面量调用 compilePathRule，未显式 import 类型名（与 EdgeRemovalOptions 同族）',
        owner: 'library-internal',
      },
      {
        symbol: 'PatternNode',
        reason:
          'cycle-134 ρ 语法树类型：只在 path-pattern.ts 内部由 parser 产出、由 compiler 消费；宿主只用文本形式（graph_path_pattern 的 pattern 参数），不构造语法树',
        owner: 'library-internal',
      },
      {
        symbol: 'concatRules',
        reason: 'D-07 组合代数：宿主无规则组合需求（规范 §六 已判定「不引入」）；cycle-108 只修了正确性',
        owner: 'D-07',
      },
      {
        symbol: 'differenceRules',
        reason: 'D-07 组合代数：同上，宿主只注册两条内联规则，从不做集合运算',
        owner: 'D-07',
      },
      {
        symbol: 'EdgeId',
        reason: '宿主有自己的 branded EdgeId（src/types/index.ts）；库的 string 别名同名不同型，不构成宿主引用',
        owner: 'host-types',
      },
      {
        symbol: 'edgeKey',
        reason: '库内自用 8 处（GraphSpace 的边键）；宿主只用 GraphSpace.addEdge/getEdge/getEdgeAttrs 封装',
        owner: 'library-internal',
      },
      {
        symbol: 'edgePairKey',
        reason: '库内自用（incremental / rebalance / path-index 的失效键）；宿主不直接操作路径索引',
        owner: 'library-internal',
      },
      {
        symbol: 'effectiveMaxEdges',
        reason:
          'XJ-10 的单一实现：库内 3 处调用（enumerate / onEdgeAdded / rebalance 的长度上界）；宿主不自己算路径长度上界，非法规则由库抛错',
        owner: 'library-internal',
      },
      {
        symbol: 'EdgeRemovalOptions',
        reason: '库内类型：适配层调用 onEdgeRemovedDetailed 时不传 options，走缺省阈值',
        owner: 'library-internal',
      },
      {
        symbol: 'EdgeRemovalResult',
        reason: '库内类型：适配层直接读返回值字段（newlyStale / staleRatio），未显式 import 类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'EdgeType',
        reason: '宿主用 GraphEdge["type"]（AdapterEdgeType）表达边类型，不引用库的 string 别名',
        owner: 'host-types',
      },
      {
        symbol: 'EMPTY_HASH',
        reason: 'D-15 半死：序列哈希的中性元；宿主不直接算哈希，只持有 PathEntry.hash',
        owner: 'D-15',
      },
      {
        symbol: 'EndPredicate',
        reason: 'PathRule.end 的字段类型；宿主只填回调字面量，不引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'entryLabels',
        reason: 'D-01 死符号：Ω 惰性输出从未被求值；XJ-03 计划经 queryLabels 接到 findPathsBetween',
        owner: 'XJ-03',
      },
      {
        symbol: 'EnumerateOptions',
        reason: '库内类型：适配层以 { maxPaths } 字面量调用 enumerate，未显式引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'existsWalk',
        reason: 'D-04：存在性判定无宿主调用方（graph_path_find 走 findPathsBetween 枚举）；XJ-08 方案 B 才需要它',
        owner: 'D-04',
      },
      {
        symbol: 'hasDirectedCycle',
        reason:
          '早终止变体 hasCycleInAdjacency 已由 CycleDFS re-export 且被 RuleEngine 使用；本符号是「不早终止」的变体，宿主不需要',
        owner: 'library-internal',
      },
      {
        symbol: 'hasDuplicateNodes',
        reason: '库内自用（isLegalPath / validateRule 的 simple 判定）；宿主不校验单条路径的重复节点',
        owner: 'library-internal',
      },
      {
        symbol: 'hashNode',
        reason: 'D-15 半死：单节点哈希；宿主只用整段序列哈希，不拼哈希',
        owner: 'D-15',
      },
      {
        symbol: 'HashPart',
        reason: 'D-15 半死：哈希分段结构；宿主不接触哈希内部结构',
        owner: 'D-15',
      },
      {
        symbol: 'hashToHex',
        reason: 'D-15 半死：哈希转十六进制仅调试/日志用；宿主从不读哈希值',
        owner: 'D-15',
      },
      {
        symbol: 'INCREMENTAL_WORK_BUDGET',
        reason: 'XJ-11：工作预算常量由 incremental 内部使用；宿主不读数，标定完成后仍是库内常量',
        owner: 'XJ-11',
      },
      {
        symbol: 'IncrementalOptions',
        reason: '库内类型：适配层调用 onEdgeAdded 走缺省参数',
        owner: 'library-internal',
      },
      {
        symbol: 'IndexCounters',
        reason: '库内类型（索引计数器快照）；宿主不读索引计数，只在 applyDelta 里读聚合结果',
        owner: 'library-internal',
      },
      {
        symbol: 'intersectRules',
        reason: 'D-07 组合代数：同上，宿主无规则交集需求',
        owner: 'D-07',
      },
      {
        symbol: 'isLegalPath',
        reason: '库内自用 19 处（剪枝后的精确终判）；宿主不直接判定路径合法性，只消费枚举结果',
        owner: 'library-internal',
      },
      {
        symbol: 'isLiveEntry',
        reason: '库内自用（query-engine / invariants 的 stale 过滤）；宿主不接触 PathEntry',
        owner: 'library-internal',
      },
      {
        symbol: 'isMinimalRotation',
        reason: '仅由 CycleDFS 对称 re-export，仓库内无消费者；行为已由 CycleDFS.test.ts 的引用相等断言覆盖',
        owner: 'library-internal',
      },
      {
        symbol: 'estimateTokens',
        reason:
          'GF-P0-2 预算估算：库内 renderSubgraphText 每个分支都用它；宿主 graph_query 只透传 tokens 字段，不自己算 token',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'KeywordEdge',
        reason:
          'GF-P0-2：宿主把 GraphEdge 结构化地传给 renderSubgraphText（{source,target,type}），不 import 类型名',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'KeywordNode',
        reason:
          'GF-P0-2：宿主把 GraphNode 结构化地传给 selectSeeds（{id,label,filePath}），不 import 类型名',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'RenderOptions',
        reason: 'GF-P0-2：graph_query 以对象字面量传 {depth, tokenBudget}，不引用选项类型名',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'RenderReason',
        reason: 'GF-P0-2：渲染三分支的取值类型；宿主只把 reason 字符串透传进 JSON，不引用联合类型名',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'RenderedSubgraph',
        reason: 'GF-P0-2：渲染结果结构；graph_query 把字段展开进 JSON 返回值，不 import 类型名',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'SeedMatch',
        reason: 'GF-P0-2：种子结构；graph_query 读取 id/label/score/matchedTerms 并映射成 JSON',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'SelectSeedOptions',
        reason: 'GF-P0-2：graph_query 以对象字面量传 {maxK}（术语/断层比例走库缺省），不引用选项类型名',
        owner: 'GF-P0-2',
      },
      {
        symbol: 'makeEntry',
        reason: '库内自用（incremental / rebalance / query 物化路径）；宿主不直接造条目',
        owner: 'library-internal',
      },
      {
        symbol: 'MAX_CHANGE_LOG',
        reason:
          'N-1 的日志上界常量：由 GraphSpace.record 内部使用，宿主不读数也不配置（上界刻意不做成选项，否则就等于允许传 Infinity）',
        owner: 'library-internal',
      },
      {
        symbol: 'minimalRotationIndex',
        reason: '同 isMinimalRotation：仅由 CycleDFS 对称 re-export，无消费者',
        owner: 'library-internal',
      },
      {
        symbol: 'NodeId',
        reason: '宿主有自己的 branded NodeId（src/types/index.ts）；库的 string 别名同名不同型，不构成宿主引用',
        owner: 'host-types',
      },
      {
        symbol: 'NodePredicate',
        reason: 'PathRule.nodeConstraint 的字段类型；宿主只填回调字面量，不引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'NormalizeStrategy',
        reason: 'PathRule.normalize 的取值域；适配层写字符串字面量（"none" / "canonical"），不引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'onEdgeRemoved',
        reason: 'XJ-04 的兼容入口（返回 number）；适配层已迁移到 onEdgeRemovedDetailed，本函数为旧调用方保留语义',
        owner: 'library-internal',
      },
      {
        symbol: 'OutputMapper',
        reason: 'PathRule.output 的映射器类型；适配层传函数字面量，不引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'PathEntry',
        reason: '库内结构：适配层把条目映射成 plain 对象返回（paths: string[][]），不显式引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'PathPredicate',
        reason: 'PathRule.pathConstraint 的字段类型；宿主只填回调字面量，不引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'query',
        reason: 'D-08：§5.4 回退契约的实现；适配层在 findPathsBetween 内自行处理 stale 回退，未调用 query()',
        owner: 'D-08',
      },
      {
        symbol: 'rebalance',
        reason: 'D-05：索引重建策略无宿主调用方；适配层重建走 index.clear() + 全量 enumerate',
        owner: 'D-05',
      },
      {
        symbol: 'repeatRule',
        reason: 'D-07 组合代数：同上，宿主无重复规则需求',
        owner: 'D-07',
      },
      {
        symbol: 'reviveEntry',
        reason: '库内自用（rebalance / incremental 复活条目）；宿主不操作路径索引',
        owner: 'library-internal',
      },
      {
        symbol: 'RollingHash',
        reason: '库内自用（path-entry 的 hashSequence）；宿主只持有 PathEntry.hash',
        owner: 'library-internal',
      },
      {
        symbol: 'RuleRegistry',
        reason: 'D-09：184 行注册表（热插拔 / deprecated / GC）无宿主调用方；XJ-05 只给 registerRule 加校验，未启用注册表',
        owner: 'D-09',
      },
      {
        symbol: 'sequenceHashParts',
        reason: 'D-15 半死：序列哈希的分段形式；宿主只用整段哈希',
        owner: 'D-15',
      },
      {
        symbol: 'StartPredicate',
        reason: 'PathRule.start 的字段类型；宿主只填回调字面量，不引用类型名',
        owner: 'library-internal',
      },
      {
        symbol: 'topK',
        reason: 'D-03：XJ-07 方案 A 决定「不接线」，改为显式契约（truncation: "top-k-weight" 抛 not implemented）',
        owner: 'XJ-07',
      },
      {
        symbol: 'unionRules',
        reason: 'D-07 组合代数：同上，宿主无规则并集需求',
        owner: 'D-07',
      },
    ] satisfies ReachabilityExemption[]
  ).map((entry) => Object.freeze(entry)),
);

// ── 真实扫描（模块级只算一次） ────────────────────────────────────────────

const PRODUCTION_FILES = collectProductionFiles();
const BARREL_SYMBOLS = collectBarrelSymbols();
const REPORT = analyzeReachability(BARREL_SYMBOLS, PRODUCTION_FILES);

const DEAD_SYMBOLS = REPORT.dead.map((entry) => entry.symbol).sort();
const EXEMPTED_SYMBOLS = DEAD_SYMBOL_EXEMPTIONS.map((entry) => entry.symbol).sort();
const EXEMPTED_SET = new Set(EXEMPTED_SYMBOLS);
const DEAD_SET = new Set(DEAD_SYMBOLS);

const readProductionCode = (file: string): string => stripComments(readFileSync(file, 'utf8'));

describe('XJ-12 可达性守卫：src/xuanji 的公共 API 必须有生产调用点', () => {
  it('扫描到足够的生产文件（防止 walk 失败导致空扫描）', () => {
    expect(REPORT.productionFiles).toBeGreaterThan(100);
  });

  it('从 barrel 提取到足够的公共符号（防止 index.ts 解析失败导致空集）', () => {
    expect(BARREL_SYMBOLS.size).toBeGreaterThanOrEqual(60);
  });

  it('barrel 的每条 export * 都被走到（每个子模块至少贡献一个符号）', () => {
    // 递归走 `export *` 是必需的：`hasDirectedCycle` / `hasCycleInAdjacency` 只在
    // query-engine 处 re-export 一次，漏跟一步就会把整个 ops/cycle-existence 当成不存在。
    for (const symbol of [
      'GraphSpace', // core/graph-space
      'minimalRotationIndex', // ops/booth
      'PathIndex', // index/path-index
      'EnumerateOptions', // query/query-engine
      'RuleRegistry', // registry/rule-registry
      'hasDirectedCycle', // 只经 query-engine re-export
    ]) {
      expect(BARREL_SYMBOLS.has(symbol)).toBe(true);
    }
  });

  it('barrel 必须是纯 re-export：直接写在 index.ts 的导出不得绕过扫描', () => {
    // 变异探针 2 抓到的洞：第一版只遍历 `export *` 的目标，于是往 index.ts 里加
    // `export const deadProbe = 1;` 时 20 个用例全绿。现在既从 barrel 本身开始走，
    // 也用这条断言把「barrel 只许 re-export」钉成契约。
    const barrelBody = stripComments(readFileSync(BARREL, 'utf8'));
    const directExports = [
      ...barrelBody.matchAll(/^[ \t]*export\s+(?:async\s+)?(?:const|let|var|function|class|enum|interface|type)\b/gm),
    ].map((match) => match[0].trim());
    expect(directExports).toEqual([]);
  });

  it('生产文件集合排除 tests/ 与 src/xuanji/**，且确实包含 src/tools.ts', () => {
    const rels = PRODUCTION_FILES.map((file) => file.rel);

    // 三个方向都要钉住：测试目录不算生产、库内互相调用不算生产、宿主入口必须在扫描范围内。
    expect(rels.filter((rel) => rel.startsWith('tests/'))).toEqual([]);
    expect(rels.filter((rel) => rel.startsWith('src/xuanji/'))).toEqual([]);
    expect(rels).toContain('src/tools.ts');
    expect(REPORT.bindings.length).toBeGreaterThanOrEqual(10);
  });

  it('至少有一批符号被真实调用（防止词边界/别名解析写坏后全部判死）', () => {
    expect(REPORT.alive.length).toBeGreaterThanOrEqual(10);
    // 接线后必须可达的几个符号：抽掉其中任一条都会让库重新变成「只有测试在用」。
    for (const symbol of ['GraphSpace', 'PathIndex', 'enumerate', 'onEdgeAdded', 'hasCycleInAdjacency']) {
      expect(REPORT.alive.map((entry) => entry.symbol)).toContain(symbol);
    }
  });

  it('死符号集合 === 显式豁免表（未登记的死符号 / 已可达却仍豁免，两个方向都红）', () => {
    expect(DEAD_SYMBOLS).toEqual(EXEMPTED_SYMBOLS);
  });

  it('未登记的死符号会被抓出（正向：不得漏报）', () => {
    const unregistered = DEAD_SYMBOLS.filter((symbol) => !EXEMPTED_SET.has(symbol));
    expect(unregistered).toEqual([]);
  });

  it('豁免表不得保留已经可达或不存在的符号（反向：豁免表不得腐化）', () => {
    const stale = EXEMPTED_SYMBOLS.filter(
      (symbol) => !DEAD_SET.has(symbol) || !BARREL_SYMBOLS.has(symbol),
    );
    expect(stale).toEqual([]);
  });

  it('豁免表每一条都必须有真实 reason 与 owner（不许「暂时」）', () => {
    for (const entry of DEAD_SYMBOL_EXEMPTIONS) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.owner.length).toBeGreaterThan(0);
      expect(entry.reason).not.toMatch(/暂时|temporarily|later|TODO/i);
    }
    // 同一符号不能登记两次——重复会让「集合相等」在掩盖缺失时仍然通过。
    expect(new Set(EXEMPTED_SYMBOLS).size).toBe(EXEMPTED_SYMBOLS.length);
  });

  it('豁免表不是逐符号瞎填：每条 symbol 都必须真的在 barrel 导出面上', () => {
    const unknown = EXEMPTED_SYMBOLS.filter((symbol) => !BARREL_SYMBOLS.has(symbol));
    expect(unknown).toEqual([]);
  });
});

// 样本一律用字符串拼接构造：源码里不出现连续的真实符号形状，避免守卫匹配到自己的字面量
// （`requireEscapeContract.test.ts` 与 `styleSelectorContract.test.ts` 都因此误报过自己）。
const FAKE_DEAD = 'dead' + 'Symbol';
const FAKE_ALIVE = 'alive' + 'Symbol';
const XJ_SPECIFIER = '../../xuanji/' + 'core/fake-probe.ts';

const SAMPLE_DEAD_ONLY: ProductionFile = {
  rel: 'src/synthetic/deadOnly.ts',
  source: `import { ${FAKE_DEAD} } from '${XJ_SPECIFIER}';\n\nexport const untouched = 1;\n`,
};

const SAMPLE_USED: ProductionFile = {
  rel: 'src/synthetic/used.ts',
  source: `import { ${FAKE_ALIVE} } from '${XJ_SPECIFIER}';\n\nexport const result = ${FAKE_ALIVE}(1);\n`,
};

const SAMPLE_COMMENTED: ProductionFile = {
  rel: 'src/synthetic/commented.ts',
  source: [
    `// import { ${FAKE_DEAD} } from '${XJ_SPECIFIER}';`,
    `/** 注释里的 ${FAKE_DEAD} 不是调用点 */`,
    'export const nothing = 0;',
    '',
  ].join('\n'),
};

describe('XJ-12 反向自检：扫描器在合成样本上必须真的会判死/判活', () => {
  const syntheticSymbols = new Map<string, SymbolKind>([
    [FAKE_DEAD, 'value'],
    [FAKE_ALIVE, 'value'],
  ]);

  it('只 import 不使用 ⇒ 判死', () => {
    const report = analyzeReachability(syntheticSymbols, [SAMPLE_DEAD_ONLY]);
    const deadNames = report.dead.map((entry) => entry.symbol);
    expect(deadNames).toContain(FAKE_DEAD);
  });

  it('import 后真的调用 ⇒ 判活（防止扫描器恒返回空集的假绿）', () => {
    const report = analyzeReachability(syntheticSymbols, [SAMPLE_USED]);
    const aliveNames = report.alive.map((entry) => entry.symbol);
    expect(aliveNames).toContain(FAKE_ALIVE);
  });

  it('注释/块注释里的 import 与使用不算调用点（stripComments 必须生效）', () => {
    const report = analyzeReachability(syntheticSymbols, [SAMPLE_COMMENTED]);
    const deadNames = report.dead.map((entry) => entry.symbol);
    expect(deadNames).toContain(FAKE_DEAD);
    expect(report.bindings).toEqual([]);
  });

  it('同一批文件里，一个判死一个判活（证明计数不是一刀切）', () => {
    const report = analyzeReachability(syntheticSymbols, [SAMPLE_DEAD_ONLY, SAMPLE_USED]);
    expect(report.dead.map((entry) => entry.symbol)).toEqual([FAKE_DEAD]);
    expect(report.alive.map((entry) => entry.symbol)).toEqual([FAKE_ALIVE]);
  });

  it('别名导入按绑定名计数（`as` 之后的名字才是代码里出现的那个）', () => {
    const origin = 'alias' + 'Source';
    const alias = 'renamed' + 'Binding';
    const file: ProductionFile = {
      rel: 'src/synthetic/alias.ts',
      source: `import { ${origin} as ${alias} } from '${XJ_SPECIFIER}';\n\nexport const v = ${alias}();\n`,
    };
    const report = analyzeReachability(new Map<string, SymbolKind>([[origin, 'value']]), [file]);
    expect(report.alive.map((entry) => entry.symbol)).toEqual([origin]);
    expect(report.alive[0]?.aliases).toEqual([alias]);
  });
});

// ── XJ-02 负向验收：生产必须走池，不得每次 new ────────────────────────────

describe('XJ-02 负向验收：src/tools.ts 必须走 XuanjiAdapterPool，不得直接 new XuanjiAdapter()', () => {
  const toolsCode = readProductionCode(TOOLS_FILE);

  it('src/tools.ts 中 `new XuanjiAdapter()` 出现次数 === 0', () => {
    // 注意 `new XuanjiAdapterPool(` 不会命中这条正则：`XuanjiAdapter` 后面紧跟的是 `Pool`。
    expect(toolsCode.length).toBeGreaterThan(1000);
    const matches = toolsCode.match(/\bnew\s+XuanjiAdapter\s*\(/g);
    expect(matches ?? []).toEqual([]);
  });

  it('全 src/ 内唯一直接构造 XuanjiAdapter 的文件就是池自身', () => {
    // 池内部的 `new XuanjiAdapter()` 是合法且必须存在的（就是它替代了每次工具调用都 new）。
    const constructors = PRODUCTION_FILES.filter((file) =>
      /\bnew\s+XuanjiAdapter\s*\(/.test(stripComments(file.source)),
    ).map((file) => file.rel);
    expect(constructors).toEqual(['src/shared/analysis/XuanjiAdapter.ts']);
  });

  it('tools.ts 真的从适配层导入池，并且只构造一次', () => {
    expect(toolsCode).toMatch(/import\s*\{[^}]*\bXuanjiAdapterPool\b[^}]*\}\s*from\s*['"][^'"]*XuanjiAdapter\.ts['"]/);
    const constructed = toolsCode.match(/\bnew\s+XuanjiAdapterPool\s*\(/g);
    expect(constructed ?? []).toHaveLength(1);
  });

  it('tools.ts 里有真实的 pool 调用点：get / applyDelta / invalidate / dispose', () => {
    expect(countCalls(toolsCode, 'xuanjiPool', 'get')).toBeGreaterThanOrEqual(2);
    expect(countCalls(toolsCode, 'xuanjiPool', 'applyDelta')).toBeGreaterThanOrEqual(1);
    expect(countCalls(toolsCode, 'xuanjiPool', 'invalidate')).toBeGreaterThanOrEqual(1);
    expect(countCalls(toolsCode, 'xuanjiPool', 'dispose')).toBeGreaterThanOrEqual(1);
  });

  it('pool.get 的返回值被真正使用（拿到 adapter 却不调用 = 另一种死链）', () => {
    // 两个读法都必须「取 adapter → 同步图 → 调库方法」，缺一步就只是把对象取出来丢掉。
    expect(countCalls(toolsCode, 'adapter', 'syncGraph')).toBeGreaterThanOrEqual(2);
    expect(countCalls(toolsCode, 'adapter', 'findPathsBetween')).toBeGreaterThanOrEqual(1);
    expect(countCalls(toolsCode, 'adapter', 'cycles')).toBeGreaterThanOrEqual(1);
  });

  it('tools.ts 仍然导入了增量入口 applyDelta 所依赖的 computeGraphDiff（delta 不是手搓的）', () => {
    expect(toolsCode).toMatch(/\bcomputeGraphDiff\b/);
  });
});
