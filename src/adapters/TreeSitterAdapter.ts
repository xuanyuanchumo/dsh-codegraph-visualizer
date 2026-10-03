import { scoped } from '../shared/Logger.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import type { IAnalysisAdapter } from './IAdapter.ts';
import type { ASTNode } from '../shared/CFGTypes.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';
import { TREE_SITTER } from '../shared/constants.ts';

const log = scoped('tree-sitter-adapter');

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

const FUNCTION_NODE_TYPES = new Set([
  'function_declaration', 'function_definition', 'method_declaration', 'method_definition', 'arrow_function',
]);
const CLASS_NODE_TYPES = new Set([
  'class_declaration', 'class_definition', 'struct_declaration', 'interface_declaration',
]);
const VARIABLE_NODE_TYPES = new Set([
  'variable_declaration', 'const_declaration', 'let_declaration', 'assignment',
]);
const IMPORT_NODE_TYPES = new Set([
  'import_statement', 'import_declaration', 'use_declaration',
]);
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
      const { nodes, edges } = this.extractSymbols(tree.rootNode, filePath);
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
            const { nodes, edges } = this.extractSymbols(tree.rootNode, file.filePath);
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

  private extractSymbols(rootNode: TreeSitterNode, filePath: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();
    const nodeMap = new Map<string, GraphNode>();

    const extractName = (node: TreeSitterNode): string => {
      const nameNode = node.childForFieldName?.('name') ||
        node.children?.find((c: TreeSitterNode) => c.type === 'identifier' || c.type === 'property_identifier');
      return nameNode ? nameNode.text : `<${node.type}>`;
    };

    const makeId = (node: TreeSitterNode, label: string): string =>
      `${filePath}:${label}:${node.startPosition.row}`;

    const walk = (rootNode: TreeSitterNode): void => {
      const stack: Array<{ node: TreeSitterNode; parentId: string | undefined }> = [{ node: rootNode, parentId: undefined }];
      while (stack.length > 0) {
        const { node, parentId } = stack.pop()!;
        if (!node) continue;
        const nodeType = node.type;

        let graphType: GraphNode['type'] | null = null;
        if (FUNCTION_NODE_TYPES.has(nodeType)) {
          graphType = 'function';
        } else if (CLASS_NODE_TYPES.has(nodeType)) {
          graphType = 'class';
        } else if (VARIABLE_NODE_TYPES.has(nodeType)) {
          graphType = 'variable';
        } else if (IMPORT_NODE_TYPES.has(nodeType)) {
          graphType = 'module';
        }

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

            if (parentId) {
              edges.push({
                id: EdgeId(`tsedge:${parentId}->${id}`),
                source: NodeId(parentId),
                target: NodeId(id),
                type: 'contains',
                properties: {},
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
