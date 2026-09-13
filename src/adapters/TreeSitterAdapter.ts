import { scoped } from '../shared/Logger.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { GraphNode, GraphEdge, AdapterResult } from '../types/index.ts';
import type { ASTNode } from '../shared/CFGTypes.ts';

const log = scoped('tree-sitter-adapter');

const SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'python', 'java', 'rust', 'go'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const FILE_EXTENSIONS: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
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

export class TreeSitterAdapter {
  private parser: TreeSitterParser | null = null;
  private loadedLanguages = new Set<SupportedLanguage>();

  async init(): Promise<void> {
    if (this.parser) return;
    try {
      const { Parser } = await import('web-tree-sitter');
      await Parser.init();
      this.parser = new Parser() as unknown as TreeSitterParser;
      log.info('TreeSitter parser initialized');
    } catch (e) {
      log.warn('Failed to init TreeSitter', e);
    }
  }

  isAvailable(): boolean {
    return this.parser !== null;
  }

  getSupportedLanguages(): readonly SupportedLanguage[] {
    return SUPPORTED_LANGUAGES;
  }

  detectLanguage(filePath: string): SupportedLanguage | null {
    for (const [ext, lang] of Object.entries(FILE_EXTENSIONS)) {
      if (filePath.endsWith(ext)) return lang;
    }
    return null;
  }

  async parseFile(filePath: string, content: string): Promise<AdapterResult> {
    if (!this.parser) {
      await this.init();
      if (!this.parser) {
        return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: 'Parser not initialized' };
      }
    }

    const language = this.detectLanguage(filePath);
    if (!language) {
      return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: `Unsupported file: ${filePath}` };
    }

    if (!this.loadedLanguages.has(language)) {
      try {
        const langModule = await this.loadLanguageWasm(language);
        this.parser.setLanguage(langModule);
        this.loadedLanguages.add(language);
      } catch (e) {
        log.warn(`Failed to load language: ${language}`, e);
        return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: `Failed to load ${language}` };
      }
    }

    try {
      const tree = this.parser.parse(content);
      const { nodes, edges } = this.extractSymbols(tree.rootNode, filePath);
      tree.delete();
      return { nodes, edges, source: 'tree-sitter', timestamp: Date.now() };
    } catch (e) {
      log.warn('parseFile failed', { filePath, error: e });
      return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: String(e) };
    }
  }

  private async loadLanguageWasm(language: SupportedLanguage): Promise<TreeSitterLanguage> {
    const wasmFile = `tree-sitter-${language}.wasm`;
    const { Language } = await import('web-tree-sitter');

    const candidates: string[] = [];

    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const { getWasmPath } = await import('tree-sitter-wasm');
        const absPath = getWasmPath(language);
        candidates.push(absPath);
      } catch { /* tree-sitter-wasm not available */ }
    }

    const doc = (globalThis as Record<string, unknown>).document as { baseURI?: string } | undefined;
    if (doc && doc.baseURI) {
      try { candidates.push(new URL(`plugins/dsh-codegraph-visualizer/${wasmFile}`, doc.baseURI).href); } catch { /* URL resolution fallback */ }
      try { candidates.push(new URL(`node_modules/web-tree-sitter/dist/${wasmFile}`, doc.baseURI).href); } catch { /* URL resolution fallback */ }
    }

    candidates.push(wasmFile);

    for (const path of candidates) {
      try {
        return await (Language as unknown as TreeSitterLanguage).load(path);
      } catch { /* try next candidate path */ }
    }
    throw new Error(`Cannot load ${wasmFile} from any candidate path`);
  }

  private extractSymbols(rootNode: TreeSitterNode, filePath: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();

    const extractName = (node: TreeSitterNode): string => {
      const nameNode = node.childForFieldName?.('name') ||
        node.children?.find((c: TreeSitterNode) => c.type === 'identifier' || c.type === 'property_identifier');
      return nameNode ? nameNode.text : `<${node.type}>`;
    };

    const makeId = (node: TreeSitterNode, label: string): string =>
      `${filePath}:${label}:${node.startPosition.row}`;

    const walk = (node: TreeSitterNode, parentId?: string): void => {
      if (!node) return;
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
          nodes.push({
            id: NodeId(id),
            label,
            type: graphType,
            filePath,
            lineNumber: node.startPosition.row + 1,
            properties: { source: 'tree-sitter', nodeType },
            ...(parentId ? { parentId: NodeId(parentId) } : {}),
          });

          if (parentId) {
            edges.push({
              id: EdgeId(`tsedge:${parentId}->${id}`),
              source: NodeId(parentId),
              target: NodeId(id),
              type: 'dependency',
              properties: {},
            });
          }
        }
        currentParentId = id;
      }

      for (let i = 0; i < (node.childCount || 0); i++) {
        const child = node.child(i);
        if (child) walk(child, currentParentId);
      }
    };

    walk(rootNode);
    return { nodes, edges };
  }

  async parseToAst(filePath: string, content: string): Promise<ASTNode | null> {
    if (!this.parser) {
      await this.init();
      if (!this.parser) {
        log.warn('parseToAst: parser not initialized after init()');
        return null;
      }
    }
    const language = this.detectLanguage(filePath);
    if (!language) {
      log.warn(`parseToAst: unsupported file extension: ${filePath}`);
      return null;
    }
    if (!this.loadedLanguages.has(language)) {
      try {
        const langModule = await this.loadLanguageWasm(language);
        this.parser.setLanguage(langModule);
        this.loadedLanguages.add(language);
      } catch (e) {
        log.warn(`parseToAst: failed to load language ${language}:`, e);
        return null;
      }
    }
    try {
      const tree = this.parser.parse(content);
      const astRoot = this.convertToAstNode(tree.rootNode);
      tree.delete();
      return astRoot;
    } catch (e) {
      log.warn(`parseToAst: parse failed for ${filePath}:`, e);
      return null;
    }
  }

  private convertToAstNode(node: TreeSitterNode): ASTNode {
    const children: ASTNode[] = [];
    for (let i = 0; i < (node.childCount || 0); i++) {
      const child = node.child(i);
      if (child) children.push(this.convertToAstNode(child));
    }
    return {
      type: node.type,
      text: node.text,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
      children,
    };
  }

  destroy(): void {
    this.parser?.delete();
    this.parser = null;
    this.loadedLanguages.clear();
  }
}
