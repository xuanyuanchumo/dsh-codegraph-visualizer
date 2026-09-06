import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, NodeId, EdgeId, AdapterResult } from '../types/index.ts';

const log = scoped('tree-sitter-adapter');

const SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'python', 'java', 'rust', 'go'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const FILE_EXTENSIONS: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
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
        return { nodes: [], edges: [], source: 'tree-sitter', timestamp: Date.now(), error: `Failed to load ${language}: ${e}` };
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
    const wasmPaths: Record<SupportedLanguage, string> = {
      typescript: 'tree-sitter-typescript.wasm',
      javascript: 'tree-sitter-javascript.wasm',
      python: 'tree-sitter-python.wasm',
      java: 'tree-sitter-java.wasm',
      rust: 'tree-sitter-rust.wasm',
      go: 'tree-sitter-go.wasm',
    };
    const wasmPath = wasmPaths[language];
    const { Language } = await import('web-tree-sitter');
    return await (Language as unknown as TreeSitterLanguage).load(wasmPath);
  }

  private extractSymbols(rootNode: TreeSitterNode, filePath: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();

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

      if (graphType) {
        const nameNode = node.childForFieldName?.('name') || node.children?.find((c: TreeSitterNode) => c.type === 'identifier' || c.type === 'property_identifier');
        const label = nameNode ? nameNode.text : `<${nodeType}>`;
        const id = `${filePath}:${label}:${node.startPosition.row}`;

        if (!visited.has(id)) {
          visited.add(id);
          nodes.push({
            id: id as NodeId,
            label,
            type: graphType,
            filePath,
            lineNumber: node.startPosition.row + 1,
            properties: { source: 'tree-sitter', nodeType },
            ...(parentId ? { parentId: parentId as NodeId } : {}),
          });

          if (parentId) {
            edges.push({
              id: `tsedge:${parentId}->${id}` as EdgeId,
              source: parentId as NodeId,
              target: id as NodeId,
              type: 'dependency',
              properties: {},
            });
          }
        }
      }

      for (let i = 0; i < (node.childCount || 0); i++) {
        const child = node.child(i);
        if (child) walk(child, graphType ? `${filePath}:${node.childForFieldName?.('name')?.text || `<${nodeType}>`}:${node.startPosition.row}` : parentId);
      }
    };

    walk(rootNode);
    return { nodes, edges };
  }

  destroy(): void {
    this.parser = null;
    this.loadedLanguages.clear();
  }
}
