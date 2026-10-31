import { createRequire } from 'node:module';
import { scoped } from '../shared/Logger.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import type { IAnalysisAdapter } from './IAdapter.ts';
import type { ASTNode } from '../shared/CFGTypes.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';
import { TREE_SITTER } from '../shared/constants.ts';

const log = scoped('tree-sitter-adapter');

/**
 * 同步探测「本宿主上是否**存在** AST 分析通道」——给能力位 `astSource` 用
 * （`src/host/prerequisites.ts` 登记探针，`src/host/routes.ts` 接线）。
 *
 * ## 为什么不能直接用 `adapter.isAvailable()`
 *
 * `isAvailable()` 的语义是「解析器**已经**初始化」（`parserCtor !== null`），而初始化发生在
 * 第一次 `parseFile()`/`parseToAst()` 里的 `await this.init()`。插件 `apply()` 时还没有任何
 * 文件被解析过，于是它在**启动后的一整段时间里恒为 false** —— 用它当能力位会让 `/status`
 * 在一个完全正常的宿主上报告「AST 通道不可用」，那是与 `builtin: true` 相反方向但同样虚假的
 * 叙事。能力位回答的是「这条通道存在吗」，不是「它此刻已热了吗」。
 *
 * ## 判据是两条真实探针的**析取**，没有第三条字面量
 *
 *   1. `isAvailable()` —— 已初始化（最强证据，进程生命周期后段基本恒真）；
 *   2. 运行时模块**可解析** —— `web-tree-sitter`（解析器）与 `tree-sitter-wasm`（语法 wasm）
 *      都能被 Node 解析到。缺依赖、装坏、profile 里漏装都会让它变 false。
 *
 * ## 诚实边界
 *
 * 本探针**不能**证明语法 wasm 真的能加载（那是异步 `Language.load()` 的事）。它证明的是
 * 「这两个包在这台宿主上存在」。这个窄化的失败面是刻意接受的：它比 `true` 严格更强
 * （字面量 `true` 在任何安装状态下都为真），而要做到「真的能加载」就必须把
 * `checkPrerequisites` 改成 async，代价是 20 余处同步调用点。
 * 非 Node 环境（理论上不该发生：本适配器只在宿主进程运行）直接返回 `false`。
 */
export function isTreeSitterRuntimePresent(): boolean {
  if (typeof process === 'undefined' || !process.versions?.node) return false;
  try {
    // 用 `createRequire(import.meta.url)` 而不是 `import.meta.resolve`：后者在 vitest 的
    // 转换管道里是 `undefined`（实测 `typeof import.meta.resolve === 'undefined'`），
    // 而本函数是能力位的判据 —— 一个在测试环境里恒抛的探针会让 `astSource` 假阴性，
    // 而假阴性比假阳性更难被发现（界面上只是「没有 AST 通道」，没有任何报错）。
    const req = createRequire(import.meta.url);
    req.resolve('web-tree-sitter');
    req.resolve('tree-sitter-wasm');
    return true;
  } catch (e) {
    log.debug('tree-sitter runtime not resolvable', { error: e });
    return false;
  }
}

const SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'python', 'java', 'rust', 'go'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/**
 * Grammar a file is parsed with. `.tsx` needs the JSX-aware `tsx` build: with the plain
 * `typescript` grammar a component containing `<div>…</div>` produces ERROR nodes and the JSX
 * arrow component is swallowed by the error node, so its symbol never reaches the graph
 * (measured: `hasError: true`, 2 ERROR nodes, 0 arrow functions, vs clean parse with `tsx`).
 * `tree-sitter-wasm` ships both grammars.
 */
const GRAMMARS = [...SUPPORTED_LANGUAGES, 'tsx'] as const;
type SupportedGrammar = typeof GRAMMARS[number];

/** Logical language a grammar belongs to — what `detectLanguage` reports (`.tsx` is TypeScript). */
const LANGUAGE_BY_GRAMMAR: Record<SupportedGrammar, SupportedLanguage> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  rust: 'rust',
  go: 'go',
  tsx: 'typescript',
};

/** Grammar per file extension — `.tsx` must not fall back to the plain `typescript` grammar. */
const GRAMMAR_BY_EXTENSION: Record<string, SupportedGrammar> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.rs': 'rust',
  '.go': 'go',
};

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(index: number): TreeSitterNode | null;
  childForFieldName(name: string): TreeSitterNode | null;
  children: TreeSitterNode[];
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
  delete(): void;
}

interface TreeSitterParser {
  parse(input: string): TreeSitterTree;
  setLanguage(language: TreeSitterLanguage): void;
  delete(): void;
}

interface TreeSitterLanguage {
  load(path: string): Promise<TreeSitterLanguage>;
}

type SymbolKind = 'function' | 'class' | 'variable' | 'module';

/**
 * Node type → graph symbol kind, **per grammar**. Previously this was one flat set shared by all
 * grammars, which was guesswork: it listed types no supported grammar emits (`struct_declaration`,
 * `const_declaration`) while missing real ones, so Rust functions never reached the graph
 * (`function_item` was absent) and TypeScript variables were labelled `<variable_declaration>`
 * (the *wrapper* was listed instead of `variable_declarator`, the node that actually carries the
 * name).
 *
 * Every entry below was measured against the shipped grammars by
 * `.cycles/probe-grammar-node-types.mjs` (all samples parse with `hasError: false`). A type is
 * listed only when the grammar emits it **and** `extractName` yields a real label for it — a
 * `name` field, a `type` field (`impl_item`), or an identifier child (`assignment`,
 * `let_declaration`). Declaration wrappers are deliberately absent because they carry no name of
 * their own and would enter the graph as `<lexical_declaration>`-style noise:
 * `lexical_declaration`, `variable_declaration`, `var_declaration`, `short_var_declaration`,
 * `type_declaration`, `field_declaration`, plus the `*_body` / `*_type` container nodes.
 */
const SYMBOL_NODE_TYPES: Record<SupportedGrammar, Record<string, SymbolKind>> = (() => {
  const js: Record<string, SymbolKind> = {
    function_declaration: 'function',
    method_definition: 'function',
    arrow_function: 'function',
    class_declaration: 'class',
    variable_declarator: 'variable',
    import_statement: 'module',
  };
  return {
    // The TS grammar is a superset of the JS one; keep them separate so a JS-only change cannot
    // silently leak JSX/TS-only node types into plain JavaScript files.
    typescript: {
      ...js,
      interface_declaration: 'class',
      enum_declaration: 'class',
      type_alias_declaration: 'class',
    },
    tsx: {
      ...js,
      interface_declaration: 'class',
      enum_declaration: 'class',
      type_alias_declaration: 'class',
    },
    javascript: js,
    python: {
      function_definition: 'function',
      class_definition: 'class',
      assignment: 'variable',
      import_statement: 'module',
    },
    java: {
      method_declaration: 'function',
      constructor_declaration: 'function',
      class_declaration: 'class',
      interface_declaration: 'class',
      enum_declaration: 'class',
      variable_declarator: 'variable',
      import_declaration: 'module',
    },
    rust: {
      function_item: 'function',
      function_signature_item: 'function',
      closure_expression: 'function',
      struct_item: 'class',
      enum_item: 'class',
      trait_item: 'class',
      impl_item: 'class',
      let_declaration: 'variable',
      const_item: 'variable',
      static_item: 'variable',
      use_declaration: 'module',
    },
    go: {
      function_declaration: 'function',
      method_declaration: 'function',
      method_elem: 'function',
      type_spec: 'class',
      type_alias: 'class',
      var_spec: 'variable',
      const_spec: 'variable',
      import_declaration: 'module',
    },
  };
})();

function symbolKindFor(grammar: SupportedGrammar, nodeType: string): SymbolKind | null {
  return SYMBOL_NODE_TYPES[grammar][nodeType] ?? null;
}
const COMMENT_NODE_TYPES = new Set(['comment', 'line_comment', 'block_comment']);
const TODO_PATTERNS = /\b(TODO|FIXME|HACK|XXX|BUG)\b/g;

export class TreeSitterAdapter implements IAnalysisAdapter {
  readonly source: DataSourceType = 'tree-sitter';
  private parserCtor: (new () => TreeSitterParser) | null = null;
  /**
   * One parser per grammar. A single shared parser with `setLanguage` swapped per file is not safe:
   * `ensureLanguageLoaded` awaits, so a mixed-language batch (`Promise.all` in `batchScan`) could
   * apply another file's grammar between the await and the parse. Separate instances make the
   * language a property of the parser instead of mutable shared state.
   */
  private parsers = new Map<SupportedGrammar, TreeSitterParser>();
  private languages = new Map<SupportedGrammar, TreeSitterLanguage>();
  private pendingGrammarLoads = new Map<SupportedGrammar, Promise<TreeSitterParser | null>>();
  private initAttempts = 0;
  private static readonly MAX_INIT_ATTEMPTS = 3;

  async init(): Promise<void> {
    if (this.parserCtor) return;
    if (this.initAttempts >= TreeSitterAdapter.MAX_INIT_ATTEMPTS) {
      log.warn(`TreeSitter init skipped after ${this.initAttempts} failed attempts`);
      return;
    }
    this.initAttempts++;
    try {
      const { Parser } = await import('web-tree-sitter');
      await Parser.init();
      this.parserCtor = Parser as unknown as new () => TreeSitterParser;
      this.initAttempts = 0;
      log.info('TreeSitter parser initialized');
    } catch (e) {
      log.warn(`Failed to init TreeSitter (attempt ${this.initAttempts}/${TreeSitterAdapter.MAX_INIT_ATTEMPTS})`, e);
    }
  }

  isAvailable(): boolean {
    return this.parserCtor !== null;
  }

  getSupportedLanguages(): readonly SupportedLanguage[] {
    return SUPPORTED_LANGUAGES;
  }

  /** Logical language for a file, or null when the extension is not supported. */
  detectLanguage(filePath: string): SupportedLanguage | null {
    const grammar = this.detectGrammar(filePath);
    return grammar ? LANGUAGE_BY_GRAMMAR[grammar] : null;
  }

  /**
   * Grammar to parse a file with. Longest matching extension wins, so the lookup cannot depend on
   * the declaration order of `GRAMMAR_BY_EXTENSION`.
   */
  detectGrammar(filePath: string): SupportedGrammar | null {
    let best: SupportedGrammar | null = null;
    let bestLength = 0;
    for (const [ext, grammar] of Object.entries(GRAMMAR_BY_EXTENSION)) {
      if (ext.length > bestLength && filePath.endsWith(ext)) {
        best = grammar;
        bestLength = ext.length;
      }
    }
    return best;
  }

  /**
   * Parser for a grammar, loading its wasm once. Concurrent requests for the same grammar share one
   * in-flight load, so a batch never downloads/compiles the same grammar twice.
   */
  private async ensureParser(grammar: SupportedGrammar): Promise<TreeSitterParser | null> {
    const ready = this.parsers.get(grammar);
    if (ready) return ready;
    const inFlight = this.pendingGrammarLoads.get(grammar);
    if (inFlight) return inFlight;

    const pending = (async (): Promise<TreeSitterParser | null> => {
      const ctor = this.parserCtor;
      if (!ctor) return null;
      try {
        const language = await this.loadLanguageWasm(grammar);
        const parser = new ctor();
        parser.setLanguage(language);
        this.languages.set(grammar, language);
        this.parsers.set(grammar, parser);
        return parser;
      } catch (e) {
        log.warn(`Failed to load grammar: ${grammar}`, e);
        return null;
      } finally {
        this.pendingGrammarLoads.delete(grammar);
      }
    })();
    this.pendingGrammarLoads.set(grammar, pending);
    return pending;
  }

  async parseFile(filePath: string, content: string): Promise<AdapterResult> {
    if (!this.parserCtor) {
      await this.init();
      if (!this.parserCtor) {
        return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: 'Parser not initialized' };
      }
    }

    const grammar = this.detectGrammar(filePath);
    if (!grammar) {
      return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: `Unsupported file: ${filePath}` };
    }

    const parser = await this.ensureParser(grammar);
    if (!parser) {
      return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: `Failed to load ${grammar}` };
    }

    try {
      const tree = parser.parse(content);
      const { nodes, edges } = this.extractSymbols(tree.rootNode, filePath, grammar);
      tree.delete();
      return { nodes, edges, source: 'tree-sitter', timestamp: Date.now() };
    } catch (e) {
      log.warn('parseFile failed', { filePath, error: e });
      return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: String(e) };
    }
  }

  async batchScan(files: Array<{ filePath: string; content: string }>): Promise<AdapterResult> {
    if (!this.parserCtor) {
      await this.init();
      if (!this.parserCtor) {
        return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: 'Parser not initialized' };
      }
    }

    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const errors: string[] = [];

    for (let i = 0; i < files.length; i += TREE_SITTER.BATCH_SIZE) {
      const batch = files.slice(i, i + TREE_SITTER.BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (file) => {
          const grammar = this.detectGrammar(file.filePath);
          if (!grammar) return null;
          const parser = await this.ensureParser(grammar);
          if (!parser) return null;
          try {
            const tree = parser.parse(file.content);
            const { nodes, edges } = this.extractSymbols(tree.rootNode, file.filePath, grammar);
            tree.delete();
            return { nodes, edges };
          } catch (e) {
            errors.push(`${file.filePath}: ${String(e)}`);
            return null;
          }
        })
      );

      for (const result of results) {
        if (result) {
          allNodes.push(...result.nodes);
          allEdges.push(...result.edges);
        }
      }
    }

    log.info(`batchScan: ${files.length} files, ${allNodes.length} nodes, ${allEdges.length} edges, ${errors.length} errors`);

    return {
      nodes: allNodes,
      edges: allEdges,
      source: 'tree-sitter',
      timestamp: Date.now(),
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
  }

  private async loadLanguageWasm(grammar: SupportedGrammar): Promise<TreeSitterLanguage> {
    const wasmFile = `tree-sitter-${grammar}.wasm`;
    const { Language } = await import('web-tree-sitter');

    const candidates: string[] = [];

    // The adapter runs in the host process only (routes.ts / analysisRoutes.ts); `tree-sitter-wasm`
    // ships `out/<lang>/tree-sitter-<lang>.wasm` and resolves it next to its own module, which is
    // correct both in this repo and in an installed profile. DSH serves no asset route for plugin
    // files, so browser-style candidates (`plugins/…`, `node_modules/…`, `document.baseURI`) could
    // never resolve and were removed rather than left as a second copy of a refuted assumption.
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const { getWasmPath } = await import('tree-sitter-wasm');
        candidates.push(getWasmPath(grammar));
      } catch (e) { log.debug('tree-sitter-wasm not available', { error: e }); }
    }

    // Last resort: let web-tree-sitter resolve the bare file name itself.
    candidates.push(wasmFile);

    for (const path of candidates) {
      try {
        return await (Language as unknown as TreeSitterLanguage).load(path);
      } catch (e) { log.debug('candidate path failed', { path, error: e }); }
    }
    throw new Error(`Cannot load ${wasmFile} from any candidate path`);
  }

  private extractSymbols(rootNode: TreeSitterNode, filePath: string, grammar: SupportedGrammar): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();
    const nodeMap = new Map<string, GraphNode>();

    /**
     * `name` first, then the `type` field (Rust `impl_item` has no `name`; its `type` field is the
     * implemented type, e.g. `Bar`), then the first name-bearing child. Measured across all six
     * grammars: the label child of a symbol node is always an `identifier`, `property_identifier`
     * or `type_identifier`. Nodes with none of these keep the explicit `<node.type>` marker —
     * `arrow_function` / `closure_expression` have no name and are expected to render as such.
     */
    const extractName = (node: TreeSitterNode): string => {
      const nameNode = node.childForFieldName?.('name') ||
        node.childForFieldName?.('type') ||
        node.children?.find((c: TreeSitterNode) =>
          c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'type_identifier');
      return nameNode ? nameNode.text : `<${node.type}>`;
    };

    const makeId = (node: TreeSitterNode, label: string): string =>
      `${filePath}:${label}:${node.startPosition.row}`;

    /**
     * 提取一个 class/interface 声明节点的全部继承目标（cycle-123）。
     *
     * 两种语法形态（tree-sitter-typescript 实测，见测试 fixture）：
     * - `extends_type_clause`：interface 的 extends（直接子节点，`type_identifier` 列表），
     *   子节点序列为 [extends, ident, ',', ident, ...]；
     * - `class_heritage`：class 的 extends/implements 容器，内含 `extends_clause`
     *   （`extends` + type 列表）与 `implements_clause`（`implements` + type 列表）。
     * - Rust 的 `impl_item` 无继承语义（trait impl 不是继承），不提取。
     * - Python 的 `class_definition` 用 `argument_list` 表达基类（tree-sitter-python
     *   的 `superclasses` 字段），一并覆盖（kind 判定走 clause 名单）。
     *
     * 返回 `clauseKind`（extends/implements）用于边类型映射：`extends → 'extend'`、
     * `implements → 'implement'`（与上游 codegraph 的 kind 语义一致）。
     * 目标统一返回占位 id 策略（消费方造 `${filePath}:<type>:<name>`），由
     * merger 按 label 归并——避免遍历时序依赖（子符号可能尚未入 nodeMap）。
     */
    const collectHeritageTargets = (
      declaration: TreeSitterNode,
    ): Array<{ clauseKind: 'extends' | 'implements'; targetName: string }> => {
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

    const walk = (rootNode: TreeSitterNode): void => {
      const stack: Array<{ node: TreeSitterNode; parentId: string | undefined }> = [{ node: rootNode, parentId: undefined }];
      while (stack.length > 0) {
        const { node, parentId } = stack.pop()!;
        if (!node) continue;
        const nodeType = node.type;

        let graphType: GraphNode['type'] | null = null;
        const symbolKind = symbolKindFor(grammar, nodeType);
        if (symbolKind) graphType = symbolKind;

        let currentParentId: string | undefined = parentId;

        if (graphType) {
          const label = extractName(node);
          const id = makeId(node, label);

          if (!visited.has(id)) {
            visited.add(id);
            const graphNode: GraphNode = {
              id: NodeId(id),
              label,
              type: graphType,
              filePath,
              lineNumber: node.startPosition.row + 1,
              properties: { source: 'tree-sitter', nodeType },
              ...(parentId ? { parentId: NodeId(parentId) } : {}),
              layer: inferLayerFromPath(filePath),
            };
            nodes.push(graphNode);
            nodeMap.set(id, graphNode);

            // 继承边提取（cycle-123，研究报告 Phase 1 P0 数据质量缺口）：
            // 上游 codegraph 索引对 `interface extends` 的检出为 0（本仓量化：
            // 源码 17 处 extends，索引只出 9 条 class→class，interface→interface
            // 全部漏检——tree-sitter-wasm 的 TypeScript grammar 对空体
            // `interface X extends Y, Z {}` 的处理覆盖不足）。这里的 AST 提取
            // 是**数据增补**：与上游边同型（`extend` / `implement`），经
            // GraphDataMerger 归因裁决时 `edgeOrigin: 'ast'` 为最高档，但
            // 不覆盖上游 db 行（见 EDGE_ORIGIN_RANK 的排序语义：同 origin
            // 时上游保留）。合并去重在 merger 侧按 (source,target,type) 完成。
            //
            // 两语法形态（tree-sitter-typescript 实测）：
            // - interface: `extends_type_clause`（直接子节点，内含 type_identifier 列表）
            // - class:     `class_heritage` → `implements_clause` / `extends_clause`
            // 端点解析：本文件内的目标用 nodeMap 命中精确 id；跨文件目标用
            // `type:<name>` 占位 id（与上游 imports 的宽松端点同策略——
            // merger 的身份裁决会把同 label 节点归并）。
            const heritageTargets = collectHeritageTargets(node);
            if (heritageTargets.length > 0) {
              for (const { clauseKind, targetName } of heritageTargets) {
                const edgeType = clauseKind === 'extends' ? 'extend' : 'implement';
                // 跨文件目标用占位 id（与上游 imports 的宽松端点同策略——
                // merger 的身份裁决按 label 归并同名列，多文件重复继承同一
                // 基类时边端点会归并到同一条）。同文件目标也是占位 id：
                // walker 的 nodeMap 查询发生在遍历中、子符号可能尚未入表，
                // 用 label 归并比「遍历时序依赖」更稳健。
                const targetId = NodeId(`${filePath}:<type>:${targetName}`);
                const selfId = NodeId(id);
                // 自继承（X extends X，极端但合法）跳过：占位 id 的 targetName
                // 段与声明 label 相同即自指（id 形态不同不能直接比）。
                if (targetName === label) continue;
                edges.push({
                  id: EdgeId(`tsedge:${id}->${targetId}`),
                  source: selfId,
                  target: targetId,
                  type: edgeType,
                  properties: { edgeOrigin: 'ast', edgeLocatable: false, targetName, line: node.startPosition.row + 1 },
                });
              }
            }

            if (parentId) {
              // 边来源归因（P1-N4）：这是 `edgeOrigin: 'ast'` 在全仓的**第一个生产者**。
              //
              // 修前 `properties` 是空对象，而 `src/merger/GraphDataMerger.ts` 的
              // `EDGE_ORIGIN_RANK.ast = 3`（最高档）因此**从未在真实数据上生效过** ——
              // 那一层裁决只是"为将来留位"，没有任何一条边能走到它。本仓反复记录过这类
              // 缺陷（"特性实现了但永远不会运行"），所以这里不是"顺便补个字段"，
              // 而是让一条已声明的裁决规则第一次真的具备输入。
              //
              // 为什么可以断言是 `ast`：这条边不是从任何索引表读出来的，也不是启发式拼的，
              // 它是**语法树父子关系**的直接投影 —— 子符号节点就在父符号节点的子树里，
              // 归属无歧义。`db` 档位（SQLite edges 行）与 `heuristic` 档位都不是这种证据。
              //
              // `edgeLocatable`：两端都是本文件里的符号节点，且都带 `lineNumber`
              // （`node.startPosition.row + 1`），因此这一行走源码可回溯。
              //
              // **已知代价（有意接受）**：`properties` 参与 `computeGraphFingerprint`
              // （`src/shared/graphFingerprint.ts:108` 的 `stableStringify(edge.properties)`），
              // 加键会让已存快照**一次性**失配 ⇒ 每次升级后的第一次扫描会多写一行快照
              // （`saveSnapshot` 按指纹去重，不 bump `FINGERPRINT.VERSION`）。选择不 bump：
              // bump 会让所有历史快照永久不可比，而这一次失配是自愈的。
              const line = node.startPosition.row + 1;
              edges.push({
                id: EdgeId(`tsedge:${parentId}->${id}`),
                source: NodeId(parentId),
                target: NodeId(id),
                type: 'contains',
                properties: { edgeOrigin: 'ast', edgeLocatable: true, line },
              });
            }
          }
          currentParentId = id;
        }

        if (COMMENT_NODE_TYPES.has(nodeType)) {
          const text = node.text;
          const matches = text.match(TODO_PATTERNS);
          if (matches && parentId) {
            const parentNode = nodeMap.get(parentId);
            if (parentNode) {
              const hasTodo = matches.some((m) => m === 'TODO');
              const hasFixme = matches.some((m) => m === 'FIXME');
              const existingTags = parentNode.tags ?? [];
              const newTags: string[] = [];
              if (hasTodo && !existingTags.includes('todo')) newTags.push('todo');
              if (hasFixme && !existingTags.includes('fixme')) newTags.push('fixme');
              if (newTags.length > 0) {
                parentNode.tags = [...existingTags, ...newTags];
              }
              const existingTodoCount = (parentNode.properties.todoCount as number) ?? 0;
              const existingFixmeCount = (parentNode.properties.fixmeCount as number) ?? 0;
              if (hasTodo) parentNode.properties.todoCount = existingTodoCount + 1;
              if (hasFixme) parentNode.properties.fixmeCount = existingFixmeCount + 1;
              parentNode.properties.hasTodoFixme = true;
            }
          }
        }

        for (let i = (node.childCount || 0) - 1; i >= 0; i--) {
          const child = node.child(i);
          if (child) stack.push({ node: child, parentId: currentParentId });
        }
      }
    };

    walk(rootNode);
    return { nodes, edges };
  }

  async parseToAst(filePath: string, content: string): Promise<ASTNode | null> {
    if (!this.parserCtor) {
      await this.init();
      if (!this.parserCtor) {
        log.warn('parseToAst: parser not initialized after init()');
        return null;
      }
    }
    const grammar = this.detectGrammar(filePath);
    if (!grammar) {
      log.warn(`parseToAst: unsupported file extension: ${filePath}`);
      return null;
    }
    const parser = await this.ensureParser(grammar);
    if (!parser) {
      log.warn(`parseToAst: failed to load grammar ${grammar}`);
      return null;
    }
    try {
      const tree = parser.parse(content);
      const astRoot = this.convertToAstNode(tree.rootNode);
      tree.delete();
      return astRoot;
    } catch (e) {
      log.warn(`parseToAst: parse failed for ${filePath}:`, e);
      return null;
    }
  }

  private convertToAstNode(rootNode: TreeSitterNode): ASTNode {
    const result: ASTNode = {
      type: rootNode.type,
      text: rootNode.text,
      startPosition: { row: rootNode.startPosition.row, column: rootNode.startPosition.column },
      endPosition: { row: rootNode.endPosition.row, column: rootNode.endPosition.column },
      children: [],
    };
    const stack: Array<{ tsNode: TreeSitterNode; astParent: ASTNode }> = [];
    for (let i = (rootNode.childCount || 0) - 1; i >= 0; i--) {
      const child = rootNode.child(i);
      if (child) stack.push({ tsNode: child, astParent: result });
    }
    while (stack.length > 0) {
      const { tsNode, astParent } = stack.pop()!;
      const astNode: ASTNode = {
        type: tsNode.type,
        text: tsNode.text,
        startPosition: { row: tsNode.startPosition.row, column: tsNode.startPosition.column },
        endPosition: { row: tsNode.endPosition.row, column: tsNode.endPosition.column },
        children: [],
      };
      astParent.children.push(astNode);
      for (let i = (tsNode.childCount || 0) - 1; i >= 0; i--) {
        const child = tsNode.child(i);
        if (child) stack.push({ tsNode: child, astParent: astNode });
      }
    }
    return result;
  }

  destroy(): void {
    for (const parser of this.parsers.values()) {
      try { parser.delete(); } catch (e) { log.debug('parser cleanup failed', { error: e }); }
    }
    for (const language of this.languages.values()) {
      try { (language as unknown as { delete?: () => void }).delete?.(); } catch (e) { log.debug('language cleanup failed', { error: e }); }
    }
    this.parsers.clear();
    this.languages.clear();
    this.pendingGrammarLoads.clear();
    this.parserCtor = null;
    this.initAttempts = 0;
  }
}
