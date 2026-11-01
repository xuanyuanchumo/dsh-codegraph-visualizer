import type { TreeSitterNode } from './TreeSitterAdapter.ts';
import type { CallSite, EvidenceGrade } from '../types/index.ts';

/**
 * 语法事实提取器集合（模块级纯函数，复杂度独立记账）。
 *
 * 归属理由：`TreeSitterAdapter.walk` 与 `FileSystemAdapter.fetchDataWithSymbols`
 * 的复杂度都已逼近预算上限（band-detector 口径），因此凡是「读一棵语法树 / 读一张
 * 表给出决策」的逻辑都放在本文件——它们不碰 fs、不碰 logger、可被单独测试。
 *
 * 本文件当前承载四组能力：
 * 1. import 模块名提取（cycle-129 · T1）——{@link IMPORT_STATEMENT_TYPES} /
 *    {@link extractImportSources}；
 * 2. 继承目标提取（cycle-123）——{@link collectHeritageTargets}；
 * 3. tsconfig paths 别名解析（cycle-130 · T1）——{@link parseTsconfigPaths} /
 *    {@link resolveAliasModule}；
 * 4. **调用点提取与 call 边解析（T2）**——{@link CALL_EXPRESSION_TYPES} /
 *    {@link extractCalleeName} / {@link maybeCollectCallSite} /
 *    {@link resolveCallEdges}。修前 `src/adapters` 全目录 `call_expression` 命中数为 0，
 *    原生通道产出的 `call` 边恒为 0；而 `DEFAULT_PATH_EDGE_TYPES`
 *    （`src/shared/analysis/XuanjiAdapter.ts`）含 `'call'`——于是上游 dsh-codegraph
 *    缺席时，影响面 / 调用链 / 环检测全部读到空图。
 */

/**
 * import 语句节点类型（cycle-129 · T1）：四类覆盖 TS/JS/Python/Rust/Java 的
 * import 语法形态。walk 拦截这些节点后调 {@link extractImportSources}。
 */
export const IMPORT_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  'import_statement', 'import_declaration', 'import_from_statement', 'use_declaration',
]);

/**
 * 从一个 import 语法节点提取模块名（模块级纯函数，复杂度独立记账）。
 * 语法形态与降级规则见 walk 内注释（TreeSitterAdapter.ts cycle-129 T1 段）。
 */
export function extractImportSources(node: TreeSitterNode): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined): void => {
    if (!raw) return;
    // TS/JS string 节点带引号；统一剥引号后按长度过滤（空/过短跳过）。
    const cleaned = raw.replace(/^['"`]|['"`]$/g, '').trim();
    if (cleaned.length > 1) out.push(cleaned);
  };
  const sourceNode = node.childForFieldName?.('source');
  if (sourceNode) {
    push(sourceNode.text);
    return out;
  }
  const moduleName = node.childForFieldName?.('module_name')
    ?? node.childForFieldName?.('name')
    ?? node.childForFieldName?.('argument');
  if (moduleName) {
    // Python relative_import 的 module_name 有点前缀（`.stlib`）——剥点后
    // 为空则跳过（纯相对导入 `from . import x` 无名字可记）。
    const text = moduleName.text.replace(/^\.+/, '').trim();
    if (text.length > 1) out.push(text);
  }
  return out;
}

export function collectHeritageTargets(
  declaration: TreeSitterNode,
): Array<{ clauseKind: 'extends' | 'implements'; targetName: string }> {
  const out: Array<{ clauseKind: 'extends' | 'implements'; targetName: string }> = [];
  const childByType = (t: string) => declaration.children?.find((c: TreeSitterNode) => c.type === t);

  // 形态一：interface 的 extends_type_clause
  const extendsClause = childByType('extends_type_clause');
  if (extendsClause) {
    for (const c of extendsClause.children ?? []) {
      if (c.type === 'type_identifier' && c.text) {
        out.push({ clauseKind: 'extends', targetName: c.text });
      }
    }
  }

  // 形态二：class 的 class_heritage（extends_clause + implements_clause）
  const heritage = childByType('class_heritage');
  if (heritage) {
    for (const clause of heritage.children ?? []) {
      const kind = clause.type === 'extends_clause' ? 'extends'
        : clause.type === 'implements_clause' ? 'implements' : null;
      if (!kind) continue;
      for (const c of clause.children ?? []) {
        if ((c.type === 'type_identifier' || c.type === 'identifier') && c.text) {
          out.push({ clauseKind: kind, targetName: c.text });
        }
      }
    }
  }

  // 形态三：Python 的 class_definition（superclasses 字段）
  const superclasses = declaration.childForFieldName?.('superclasses');
  if (superclasses) {
    for (const c of superclasses.children ?? []) {
      if ((c.type === 'identifier' || c.type === 'attribute') && c.text) {
        out.push({ clauseKind: 'extends', targetName: c.text });
      }
    }
  }
  return out;
};

// ── 调用点提取（T2）────────────────────────────────────────────────────────
//
// 六种 grammar 的调用语法节点（**全部实测**：探针脚本对每种 grammar 打印了
// 节点类型与相应字段，不是按文档猜的）。三组形态：
//
// 1) typescript / tsx / javascript / rust / go → 节点 `call_expression`，
//    被调方在 `function` 字段（裸标识符、成员/字段/选择/scoped 表达式、带泛型的包装节点）；
// 2) python → 节点 `call`，被调方在 `function` 字段（identifier / attribute）；
// 3) java → 节点 `method_invocation`，被调方在 `name` 字段（可选 `object` 字段）。
//
// ⚠️ 任务书写的「四类同族节点」并不准确：python 的节点类型是 `call`，
// java 的是 `method_invocation`。以实测为准（本文件即证据）。

/**
 * 调用表达式节点类型集合（跨 grammar 的并集）。
 * walk 拦截这些节点后交给 {@link maybeCollectCallSite} / {@link extractCalleeName}。
 */
export const CALL_EXPRESSION_TYPES: ReadonlySet<string> = new Set([
  'call_expression',   // typescript / tsx / javascript / rust / go
  'call',              // python
  'method_invocation', // java
]);

/**
 * 名字节点的类型集合：这些节点的 `text` 就是末段标识符本身。
 * go / rust 的 `field_identifier`、TS 的 `private_property_identifier`
 * （`this.#p()` 实测）都在此列。
 */
const NAME_NODE_TYPES: ReadonlySet<string> = new Set([
  'identifier', 'property_identifier', 'field_identifier', 'private_property_identifier',
]);

/**
 * 末段字段表：节点类型 → 直接保存末段名字的字段名。
 *
 * 用查表替代 switch 是有意的（复杂度预算）：12 个 case 的分支数等于 12 个 if，
 * 而这里的三张表各占一行。六种 grammar 实测的字段归属如下——
 * member_expression 的末段在 `property`，python attribute 在 `attribute`，
 * rust scoped_identifier 在 `name`，rust field_expression 与 go selector_expression
 * 都在 `field`。
 */
const TAIL_FIELD_BY_TYPE: Readonly<Record<string, string>> = Object.freeze({
  member_expression: 'property',
  attribute: 'attribute',
  scoped_identifier: 'name',
  field_expression: 'field',
  selector_expression: 'field',
});

/**
 * 包装节点表：节点类型 → 内层表达式所在的字段名。
 * rust 的实例化调用 `o.m::<i32>()` 外面套 `generic_function`（内层在 `function`），
 * go 的 `foo[int]()` / `obj.M[int]()` 套 `index_expression`（内层在 `operand`，
 * `index` 是类型实参而非函数表达式）。
 */
const INNER_FIELD_BY_TYPE: Readonly<Record<string, string>> = Object.freeze({
  generic_function: 'function',
  index_expression: 'operand',
});

/** 取节点末段的**名字子节点**（不是文本切分——文本切分会被泛型/可选链带偏）。 */
function lastNamedChild(node: TreeSitterNode): TreeSitterNode | null {
  return [...(node.children ?? [])].reverse().find((c) => NAME_NODE_TYPES.has(c.type)) ?? null;
}

/**
 * 从「被调方表达式」节点取简单名。六种 grammar 实测形态：
 *
 * - 裸标识符（TS/Py/Rust/Go 的直接调用）→ 自身 text；
 * - 末段字段表命中的包装节点 → 该字段；字段缺席时退回最后一个名字子节点
 *   （可选链 `a?.b` 的子节点是 `identifier / optional_chain / property_identifier`，
 *   字段仍然可读，但退回路径覆盖语法恢复产出的异常形态）；
 * - 包装节点表命中的 → 递归内层表达式；
 * - 括号表达式 `(f)()` → 递归唯一非括号子节点；
 * - TS `arr[0]()` 的 `subscript_expression` **刻意不取名**：下标不是符号引用，
 *   硬取会把 `number` 的文本当符号名（宁缺勿造）。
 *
 * java 的 `method_invocation` 没有被调方字段，直接读 `name`
 * （`obj.<T>g()` 实测 `name=g`，泛型参数不影响）。
 */
function calleeFromExpression(node: TreeSitterNode, depth: number): string | null {
  // 深度上限防御病态 AST（语法错误恢复时可能出现自嵌套）；正常代码远达不到。
  if (depth > 6) return null;
  if (NAME_NODE_TYPES.has(node.type)) return node.text || null;

  const tailField = TAIL_FIELD_BY_TYPE[node.type];
  if (tailField) {
    return node.childForFieldName?.(tailField)?.text || lastNamedChild(node)?.text || null;
  }

  const innerField = INNER_FIELD_BY_TYPE[node.type];
  const inner = innerField
    ? node.childForFieldName?.(innerField)
    : node.type === 'parenthesized_expression'
      ? (node.children ?? []).find((c) => c.type !== '(' && c.type !== ')')
      : null;
  return inner ? calleeFromExpression(inner, depth + 1) : null;
}

/**
 * 从调用语法节点提取被调方的**简单名**（末段标识符）；无名字返回 null。
 *
 * 「简单名」是刻意的上限：本通道没有类型信息，`a.b()` 只能知道「有个叫 b 的调用」，
 * 不能知道 `a` 到底是什么类型。因此下游解析必须按「同名符号是否唯一」裁决，
 * 多义时**跳过而不是猜**（见 {@link resolveCallEdges}）。
 */
export function extractCalleeName(node: TreeSitterNode): string | null {
  // java：`name` 字段直接是末段（`function` 字段不存在）。
  const nameField = node.childForFieldName?.('name');
  if (node.type === 'method_invocation') {
    return nameField?.text || null;
  }
  const callee = node.childForFieldName?.('function');
  if (!callee) return null;
  return calleeFromExpression(callee, 0);
}

/**
 * 收集一个调用点（若它的宿主符号合法）。
 *
 * ## 为什么必须要求宿主是可调用符号
 *
 * `walk` 用栈遍历，压栈时携带的 `parentId` 是**最近的一个符号节点**——它可能是
 * class、variable，也可能是 module（`import_statement` 本身就是一个 module 符号）。
 * 模块顶层的 `foo()` 若记成 `file → foo` 的 call 边，等于宣称「这个文件调用了 foo」；
 * `const x = foo()` 若记成 `x → foo`，等于宣称「变量 x 调用了 foo」。这两类边都会
 * 让调用链读法出现不存在的路径，所以：**宿主不是 function 类型就直接跳过**（宁缺勿造）。
 * 代价是模块级初始化调用（`const db = openDb()`）不产生 call 边——这是刻意接受的缺口。
 *
 * 本函数同时承担「调用节点 → 调用点」的判定，walk 里只用一行调用 + 一行 push，
 * 不再新增条件语句（复杂度预算：`walk` 所在文件已贴近 100）。
 *
 * @returns 新的调用点，或 null（不是调用节点 / 宿主非法 / 无名调用）。
 */
export function maybeCollectCallSite(
  node: TreeSitterNode,
  nodeType: string,
  hostId: string | undefined,
  hostType: string | undefined,
): CallSite | null {
  if (!CALL_EXPRESSION_TYPES.has(nodeType)) return null;
  if (!hostId || hostType !== 'function') return null;
  const calleeName = extractCalleeName(node);
  if (!calleeName) return null;
  return {
    callerId: hostId as CallSite['callerId'],
    calleeName,
    line: node.startPosition.row + 1,
  };
}

/** TODO/FIXME 两种标记的字面量与写入字段（一张表替代四段重复分支）。 */
const TODO_MARKERS: ReadonlyArray<readonly [marker: 'TODO' | 'FIXME', tag: string, countKey: string]> = [
  ['TODO', 'todo', 'todoCount'],
  ['FIXME', 'fixme', 'fixmeCount'],
];

/**
 * 注释里的 TODO/FIXME 标记 → 打到宿主符号节点上（cycle-122 的 todoMarkerMode 数据面）。
 *
 * 从 `TreeSitterAdapter.walk` 里搬出来的原因纯粹是**复杂度预算**：那一块原有 5 个条件
 * 语句，而 walk 本身已到 101。搬动时**必须逐行等价**，否则「重构」会悄悄改掉行为——
 * 这里特意保留原实现的两处容易改错的语义：
 *
 * 1. **计数是累加**（同一宿主下多条注释各 +1），标签只加一次（已有就不重复加）；
 * 2. `hasTodoFixme` 的判据是「命中了**任意**标记」，包括没有专属标签的 HACK / XXX / BUG
 *    ——所以它写在循环**外面**。挪进循环体会让「只有 HACK 的注释」不再置位，
 *    而 `TODO_PATTERNS` 里 HACK/XXX/BUG 确实是合法命中项。
 *
 * 无标记命中时不碰 `tags`（保持 undefined，而不是写一个空数组）：原实现只在需要
 * 追加时才赋值，`tags: []` 与 `tags: undefined` 在节点上是两种可观测状态。
 */
export function applyTodoMarkers(
  parentNode: { tags?: string[]; properties: Record<string, unknown> },
  matches: readonly string[],
): void {
  const tags = parentNode.tags ?? [];
  for (const [marker, tag, countKey] of TODO_MARKERS) {
    if (!matches.includes(marker)) continue;
    if (!tags.includes(tag)) tags.push(tag);
    parentNode.properties[countKey] = ((parentNode.properties[countKey] as number) ?? 0) + 1;
  }
  if (tags.length > 0) parentNode.tags = tags;
  // 「命中任意标记」而不是「命中 TODO 或 FIXME」——见上面第 2 条。
  parentNode.properties.hasTodoFixme = true;
}

/**
 * 符号节点的名字（label）提取：`name` 字段 → `type` 字段（Rust `impl_item` 没有
 * `name`，它的 `type` 字段是被实现的类型，如 `Bar`）→ 第一个带名字的子节点。
 *
 * 六种 grammar 实测：符号节点的标签子节点总是 `identifier` / `property_identifier` /
 * `type_identifier` 之一。三者都没有的节点保留显式 `<node.type>` 标记——
 * `arrow_function` / `closure_expression` 没有名字，本来就该这样呈现。
 */
export function extractSymbolName(node: TreeSitterNode): string {
  const nameNode = node.childForFieldName?.('name') ||
    node.childForFieldName?.('type') ||
    node.children?.find((c: TreeSitterNode) =>
      c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'type_identifier');
  return nameNode ? nameNode.text : `<${node.type}>`;
}

// ── call 边两跳解析（T2）──────────────────────────────────────────────────
//
// 证据分级（诚实是这里的核心要求，不是装饰）：
//
//   hop 1（exact）：被调名在同一文件的符号集里**唯一**命中 ⇒ 名字→符号无歧义。
//   hop 2（inferred）：同文件未命中，但在本文件已解析出的 import 目标文件里
//                     **唯一**同名符号 ⇒ 边成立，但引入了 import 图这一额外前提。
//   同文件多义 ⇒ 跳过（计入 ambiguous）；都没有 ⇒ 跳过。
//
// 为什么多义必须跳过：同名符号 >1 时没有任何信息能选中其中一个，任意选一条都会
// 制造一条看似确定、实为编造的边——那正是「影响面视图给出错误答案」的来源，
// 比缺一条边严重得多。

/** `resolveCallEdges` 的单文件输入（全部由调用方在 workspace 上下文中准备好）。 */
export interface CallResolutionInput {
  /** 本文件的调用点。 */
  readonly callSites: readonly CallSite[];
  /** 本文件名 → 文件内符号（label + id）。`filePath` 为本文件绝对路径。 */
  readonly localSymbols: readonly { readonly label: string; readonly id: string }[];
  /**
   * import 目标文件（绝对路径）→ 该文件的符号列表。只应包含**本文件确实 import 到**
   * 的文件；跨文件唯一命中才允许产出 inferred 边。
   */
  readonly importedFileSymbols: ReadonlyMap<string, readonly { readonly label: string; readonly id: string }[]>;
}

/**
 * 一条已解析的 call 边（原始 id 字符串，由调用方套 branded type）。
 *
 * `edgeOrigin` 与 `evidence` 是**两个不同的问题**，所以两个字段都在：
 * - `edgeOrigin` 回答「这条边的两端是怎么来的」，取值域沿用既有
 *   `EDGE_ORIGIN_RANK`（`src/merger/GraphDataMerger.ts`）：exact 边是语法树里
 *   同一个文件的父子级事实 ⇒ `'ast'`；inferred 边靠 import 图 + 名字唯一性
 *   推断出目标符号，**不是**语法树直接给出的 ⇒ `'heuristic'`（若也写 `'ast'`，
 *   就等于宣称「编辑器级精确」而实际只是名字匹配，比缺边更糟）。
 * - `evidence` 回答「名字→符号的映射有多确定」，是本轮新增的两级语义
 *   （{@link EvidenceGrade}）。
 */
export interface ResolvedCallEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly properties: {
    readonly edgeOrigin: 'ast' | 'heuristic';
    readonly evidence: EvidenceGrade;
    readonly calleeName: string;
    readonly line: number;
  };
}

/** `resolveCallEdges` 的输出：边 + 本文件解析统计（统计是给日志与测试断言用的）。 */
export interface CallResolutionResult {
  readonly edges: ResolvedCallEdge[];
  /** 同文件多义而跳过的调用点数（**防空转的核心计数**）。 */
  readonly ambiguous: number;
  /** 两跳都没命中而跳过的调用点数。 */
  readonly unresolved: number;
  /** 实际落成的边按证据分级的计数（exact / inferred）。 */
  readonly byEvidence: { readonly exact: number; readonly inferred: number };
}

/** 按 label 建索引（同名多值保留全部，供唯一性判定）。 */
function indexByLabel(
  symbols: readonly { readonly label: string; readonly id: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const symbol of symbols) {
    map.set(symbol.label, [...(map.get(symbol.label) ?? []), symbol.id]);
  }
  return map;
}

/**
 * 把一批调用点解析成 `call` 边（含证据分级）。
 *
 * 边 id 形如 `tscall:${callerId}:${calleeId}`——与既有 `tsimport:` / `tsedge:`
 * 前缀风格一致。同一对 (caller, callee) 出现多次调用只产出一条边
 * （调用次数不是图结构；重复边会被 merger 按 id 去重，但这里先去重可以省掉
 * 一次属性并集，也避免 ambiguous/unresolved 统计被重复调用放大）。
 */
export function resolveCallEdges(input: CallResolutionInput): CallResolutionResult {
  const edges: ResolvedCallEdge[] = [];
  const seenEdgeIds = new Set<string>();
  let ambiguous = 0;
  let unresolved = 0;
  let exactCount = 0;
  let inferredCount = 0;

  const localIndex = indexByLabel(input.localSymbols);
  const importedIndexes: Array<Map<string, string[]>> = [];
  for (const symbols of input.importedFileSymbols.values()) {
    importedIndexes.push(indexByLabel(symbols));
  }

  for (const site of input.callSites) {
    const localHits = localIndex.get(site.calleeName) ?? [];

    let calleeId: string | null = null;
    let evidence: EvidenceGrade | null = null;

    if (localHits.length > 1) {
      // 同文件多义：不猜。
      ambiguous++;
      continue;
    }
    if (localHits.length === 1) {
      calleeId = localHits[0] ?? null;
      evidence = 'exact';
    } else {
      // hop 2：跨文件唯一命中。任何一处多义都放弃（跨文件歧义比同文件更不可判）。
      let crossHit: string | null = null;
      let crossAmbiguous = false;
      for (const index of importedIndexes) {
        const hits = index.get(site.calleeName) ?? [];
        if (hits.length > 1) { crossAmbiguous = true; break; }
        if (hits.length === 1) {
          if (crossHit !== null) { crossAmbiguous = true; break; }
          crossHit = hits[0] ?? null;
        }
      }
      if (crossAmbiguous) { ambiguous++; continue; }
      if (crossHit === null) { unresolved++; continue; }
      calleeId = crossHit;
      evidence = 'inferred';
    }

    if (!calleeId) { unresolved++; continue; }
    if (calleeId === String(site.callerId)) continue; // 自引用（递归）跳过

    const edgeId = `tscall:${String(site.callerId)}:${calleeId}`;
    if (seenEdgeIds.has(edgeId)) continue;
    seenEdgeIds.add(edgeId);
    const grade: EvidenceGrade = evidence ?? 'inferred';
    if (grade === 'exact') exactCount++;
    else inferredCount++;
    edges.push({
      id: edgeId,
      source: String(site.callerId),
      target: calleeId,
      properties: {
        // exact = 语法树同一文件内的直接事实（ast 档）；inferred = 名字 + import 图推断（heuristic 档）。
        edgeOrigin: grade === 'exact' ? 'ast' : 'heuristic',
        evidence: grade,
        calleeName: site.calleeName,
        line: site.line,
      },
    });
  }

  return { edges, ambiguous, unresolved, byEvidence: { exact: exactCount, inferred: inferredCount } };
}

/**
 * tsconfig paths 别名解析（cycle-130 · T1：现代 TS 项目的 import 图缺口）。
 *
 * `@/utils/helper` 形态的 import 依赖 tsconfig 的 `compilerOptions.paths`
 * 才能解析到真实文件——否则原生依赖图在这些项目上是半空的（cycle-129 登记缺口）。
 *
 * 解析器是**纯函数**（别名表进、映射决策出），tsconfig 的读取与缓存由
 * FileSystemAdapter 负责——本文件不碰 fs，复杂度独立记账。
 *
 * paths 形态（tsconfig 实测）：`"@/*": ["./src/*"]`——key 是模式（单 `*`），
 * value 是候选列表（首个命中胜出）。value 相对 baseUrl（缺省 = tsconfig 所在
 * 目录）。本实现覆盖单星模式；多星/多候选按序试（宁缺勿造）。
 */
export interface TsconfigPathsMapping {
  /** 别名模式 → 候选目标模式列表（均含至多一个 `*`）。 */
  readonly entries: ReadonlyArray<readonly [string, readonly string[]]>;
  /** baseUrl（相对 tsconfig 所在目录，posix；无尾斜杠；'.' = 同目录）。 */
  readonly baseUrl: string;
}

/** 从 tsconfig JSON 文本提取 paths 映射（宽松解析：JSONC 注释/尾逗号容错）。 */
export function parseTsconfigPaths(jsonText: string): TsconfigPathsMapping | null {
  // JSONC 容错：剥块注释与行注释、尾逗号（tsconfig 常带注释与尾逗号）。
  const cleaned = jsonText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  const compilerOptions = parsed.compilerOptions as Record<string, unknown> | undefined;
  if (!compilerOptions || typeof compilerOptions !== 'object') return null;
  const paths = compilerOptions.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== 'object') return null;
  const baseUrlRaw = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
  const baseUrl = baseUrlRaw.replace(/\\/g, '/').replace(/\/+$/, '') || '.';
  const entries: Array<readonly [string, readonly string[]]> = [];
  for (const [key, value] of Object.entries(paths)) {
    if (typeof key !== 'string' || !key.includes('*')) continue; // 单星模式才有通配语义
    const targets = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    if (targets.length === 0) continue;
    entries.push([key, targets]);
  }
  if (entries.length === 0) return null;
  return { entries, baseUrl };
}

/**
 * 用别名表解析一个模块名 → workspace 内相对路径（不含扩展名，`*` 已替换）。
 * 返回 null = 该模块名不匹配任何别名模式（调用方继续走相对/bare 逻辑）。
 */
export function resolveAliasModule(mapping: TsconfigPathsMapping, moduleName: string): string | null {
  for (const [pattern, targets] of mapping.entries) {
    const starIdx = pattern.indexOf('*');
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (!moduleName.startsWith(prefix) || !moduleName.endsWith(suffix)) continue;
    const wildcard = moduleName.slice(prefix.length, moduleName.length - suffix.length);
    if (wildcard.includes('*')) continue;
    for (const target of targets) {
      // 目标相对 baseUrl（tsconfig 惯例）；`./` 前缀归一。
      const t = target.replace(/^\.\//, '');
      const base = mapping.baseUrl === '.' ? '' : `${mapping.baseUrl}/`;
      const resolved = `${base}${t.replace(/\*/g, wildcard)}`;
      return resolved.replace(/\/+/g, '/');
    }
  }
  return null;
}
