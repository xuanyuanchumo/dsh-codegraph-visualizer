import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, AdapterResult } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';

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

const MAX_FILES = 500;

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

  setFileSystem(fs: FileSystemApi): void {
    this.fs = fs;
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
      if (fileCount >= MAX_FILES) return;
      if (visitedDirs.has(dirPath)) return;
      visitedDirs.add(dirPath);

      let entries: string[];
      try {
        entries = this.fs!.readdir(dirPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (fileCount >= MAX_FILES) break;
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
}