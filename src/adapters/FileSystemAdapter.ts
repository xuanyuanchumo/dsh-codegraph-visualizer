import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, AdapterResult } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';
import type { TreeSitterAdapter } from './TreeSitterAdapter.ts';
import { FILE_SYSTEM } from '../shared/constants.ts';

const log = scoped('fs-adapter');

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.java', '.rs', '.go',
  '.json', '.toml', '.yaml', '.yml',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target',
  '__pycache__', '.venv', 'venv', '.next',
  'coverage', '.cache', '.codegraph',
]);


function getLanguageFromExt(ext: string): string {
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.rs': 'rust',
    '.go': 'go',
  };
  return langMap[ext] ?? 'unknown';
}

function getNodeTypeFromExt(ext: string): GraphNode['type'] {
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs') return 'module';
  if (ext === '.py' || ext === '.java' || ext === '.rs' || ext === '.go') return 'module';
  return 'variable';
}

export interface FileSystemApi {
  readdir(path: string): string[];
  readFile(path: string): string;
  stat(path: string): { isDirectory: boolean };
}

export class FileSystemAdapter implements IDataAdapter {
  readonly source = 'tree-sitter' as const;
  private fs: FileSystemApi | null = null;
  private treeSitterAdapter: TreeSitterAdapter | null = null;

  setFileSystem(fs: FileSystemApi): void {
    this.fs = fs;
  }

  setTreeSitterAdapter(adapter: TreeSitterAdapter): void {
    this.treeSitterAdapter = adapter;
  }

  async fetchData(repoId: string, _invoke?: UpstreamInvoker): Promise<AdapterResult> {
    if (!this.fs) {
      log.warn('no filesystem available');
      return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visitedDirs = new Set<string>();
    let fileCount = 0;

    const scanDir = (dirPath: string, parentId?: string): void => {
      if (fileCount >= FILE_SYSTEM.MAX_FILES) return;
      if (visitedDirs.has(dirPath)) return;
      visitedDirs.add(dirPath);

      let entries: string[];
      try {
        entries = this.fs!.readdir(dirPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (fileCount >= FILE_SYSTEM.MAX_FILES) break;
        const fullPath = dirPath.endsWith('/') ? dirPath + entry : `${dirPath}/${entry}`;
        const baseName = entry.split('/').pop() ?? entry;

        if (IGNORED_DIRS.has(baseName)) continue;

        let isDir: boolean;
        try {
          isDir = this.fs!.stat(fullPath).isDirectory;
        } catch {
          continue;
        }

        if (isDir) {
          const dirNodeId = `dir:${fullPath}`;
          nodes.push({
            id: NodeId(dirNodeId),
            label: baseName,
            type: 'module',
            filePath: fullPath,
            properties: { language: 'directory' },
          });
          if (parentId) {
            edges.push({
              id: EdgeId(`contains:${parentId}:${dirNodeId}`),
              source: NodeId(parentId),
              target: NodeId(dirNodeId),
              type: 'contains',
              properties: {},
            });
          }
          scanDir(fullPath, dirNodeId);
        } else {
          const ext = '.' + (baseName.split('.').pop() ?? '');
          if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

          const fileNodeId = `file:${fullPath}`;
          const lang = getLanguageFromExt(ext);
          const nodeType = getNodeTypeFromExt(ext);

          nodes.push({
            id: NodeId(fileNodeId),
            label: baseName,
            type: nodeType,
            filePath: fullPath,
            properties: { language: lang, extension: ext },
          });
          fileCount++;

          if (parentId) {
            edges.push({
              id: EdgeId(`contains:${parentId}:${fileNodeId}`),
              source: NodeId(parentId),
              target: NodeId(fileNodeId),
              type: 'contains',
              properties: {},
            });
          }
        }
      }
    };

    scanDir(repoId);

    log.info(`scanned ${fileCount} files, ${nodes.length} nodes, ${edges.length} edges`);

    return {
      nodes,
      edges,
      source: this.source,
      timestamp: Date.now(),
    };
  }

  async fetchDataWithSymbols(repoId: string, _invoke?: UpstreamInvoker): Promise<AdapterResult> {
    if (!this.fs) {
      log.warn('no filesystem available');
      return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };
    }

    const structureResult = await this.fetchData(repoId, _invoke);
    if (!this.treeSitterAdapter) {
      log.info('no tree-sitter adapter attached, returning structure-only result');
      return structureResult;
    }

    const filesToParse: Array<{ filePath: string; content: string }> = [];
    const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.java', '.rs', '.go']);

    for (const node of structureResult.nodes) {
      if (node.type !== 'module' && node.type !== 'variable') continue;
      const ext = '.' + (node.filePath?.split('.').pop() ?? '');
      if (!CODE_EXTENSIONS.has(ext)) continue;
      try {
        const content = this.fs.readFile(node.filePath);
        filesToParse.push({ filePath: node.filePath, content });
      } catch {
        log.debug(`could not read file: ${node.filePath}`);
      }
    }

    if (filesToParse.length === 0) {
      return structureResult;
    }

    log.info(`parsing ${filesToParse.length} files with tree-sitter`);
    const symbolResult = await this.treeSitterAdapter.batchScan(filesToParse);

    const allNodes = [...structureResult.nodes, ...symbolResult.nodes];
    const allEdges = [...structureResult.edges, ...symbolResult.edges];

    for (const symbolNode of symbolResult.nodes) {
      const fileNodeId = `file:${symbolNode.filePath}`;
      allEdges.push({
        id: EdgeId(`symcontains:${fileNodeId}:${symbolNode.id}`),
        source: NodeId(fileNodeId),
        target: symbolNode.id,
        type: 'contains',
        properties: {},
      });
    }

    log.info(`fetchDataWithSymbols: ${allNodes.length} nodes (${structureResult.nodes.length} structure + ${symbolResult.nodes.length} symbols), ${allEdges.length} edges`);

    return {
      nodes: allNodes,
      edges: allEdges,
      source: this.source,
      timestamp: Date.now(),
    };
  }
}