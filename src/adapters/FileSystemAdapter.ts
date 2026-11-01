import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, AdapterResult } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';
import type { TreeSitterAdapter } from './TreeSitterAdapter.ts';
import { parseTsconfigPaths, resolveAliasModule, type TsconfigPathsMapping } from './treeSitterExtractors.ts';
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

    // ── import 边推断（cycle-129 · T2：原生依赖图缺口）────────────────────
    //
    // TreeSitter 只产出「文件 → 模块名」（语法事实，batchScan.importsByFile）；
    // 把模块名解析到 workspace 内真实文件节点是**语义裁决**，需要目录清单——
    // 这正是本适配器已有的 structureResult.nodes（file: 前缀节点）。
    //
    // 路径域（调试实证）：filesToParse 用**绝对路径**（fetchData 从 repoId 起
    // 遍历、readFile 按绝对键），因此 TreeSitter 的 importsByFile 键域与
    // fileSet 同为绝对路径——import 解析统一在绝对域进行，无需前缀换算
    // （曾误判为「结构绝对/符号相对」两域而做前缀剥离，解析永远落空）。
    //
    // 解析策略（保守，宁缺勿造）：
    // 1. 相对路径（./ / ../）按 import 所在文件目录 + 扩展名/index 枚举解析；
    // 2. bare specifier：模块名 + 扩展名直接匹配 workspace 内路径；
    // 3. `lodash`/`react` 等包名自然落空——解析不到即跳过，绝不编造目标
    //    （缺口：tsconfig paths / node_modules 内部图——登记规划 §2 边界）。
    // ── tsconfig paths 别名表（cycle-130 · T1）────────────────────────────
    // 读 workspace 根的 tsconfig.json（缺席/解析失败 = 无别名表，alias 解析跳过，
    // 相对/bare 逻辑不受影响）。一次扫描读一次即可（不缓存——batchScan 频率低）。
    let aliasMapping: TsconfigPathsMapping | null = null;
    try {
      const tsconfigText = this.fs!.readFile(`${repoId}/tsconfig.json`);
      aliasMapping = parseTsconfigPaths(tsconfigText);
      if (aliasMapping) {
        log.info(`tsconfig paths loaded: ${aliasMapping.entries.length} alias patterns`);
      }
    } catch {
      // 无 tsconfig / 读取失败：诚实降级（别名解析跳过）。
    }

    const fileSet = new Set(
      structureResult.nodes.filter((n) => String(n.id).startsWith('file:')).map((n) => String(n.filePath)),
    );
    const EXT_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.rs', '.go', '.java', '/index.ts', '/index.js'];
    // fileSet 是绝对域（`D:/proj/src/a.ts`）；别名解析产出 repo 相对路径——
    // 绝对化时用 repoId 前缀（与 fileSet 同域后匹配）。
    const repoIdPrefix = repoId.endsWith('/') ? repoId : `${repoId}/`;
    const resolveModuleToFile = (fromFile: string, moduleName: string): string | null => {
      // cycle-130 · T1：别名优先（@/utils/helper → src/utils/helper → 绝对域匹配）。
      if (aliasMapping) {
        const aliasRel = resolveAliasModule(aliasMapping, moduleName);
        if (aliasRel) {
          for (const ext of EXT_CANDIDATES) {
            const absCandidate = `${repoIdPrefix}${aliasRel}${ext}`;
            if (fileSet.has(absCandidate)) return absCandidate;
          }
          return null; // 别名命中但文件不在清单内（目录上限截断）——不落 bare（宁缺勿造）
        }
      }
      if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
        const base = fromFile.split('/').slice(0, -1).join('/');
        let joined: string;
        if (moduleName.startsWith('./')) {
          joined = `${base}/${moduleName.slice(2)}`;
        } else {
          let parts = base.split('/');
          let rest = moduleName;
          while (rest.startsWith('../')) {
            parts = parts.slice(0, -1);
            rest = rest.slice(3);
          }
          joined = `${parts.join('/')}/${rest}`;
        }
        for (const ext of EXT_CANDIDATES) {
          const candidate = `${joined}${ext}`;
          if (fileSet.has(candidate)) return candidate;
        }
        return null;
      }
      for (const ext of EXT_CANDIDATES) {
        const candidate = `${moduleName}${ext}`;
        if (fileSet.has(candidate)) return candidate;
      }
      return null;
    };

    let importEdgeCount = 0;
    for (const [fromFile, modules] of symbolResult.importsByFile ?? []) {
      const fromFileId = `file:${fromFile}`;
      for (const moduleName of modules) {
        const resolved = resolveModuleToFile(fromFile, moduleName);
        if (!resolved) continue;
        const targetId = `file:${resolved}`;
        if (targetId === fromFileId) continue; // 自引用跳过
        allEdges.push({
          id: EdgeId(`tsimport:${fromFileId}:${targetId}`),
          source: NodeId(fromFileId),
          target: NodeId(targetId),
          type: 'import',
          properties: { edgeOrigin: 'ast', module: moduleName },
        });
        importEdgeCount++;
      }
    }

    log.info(`fetchDataWithSymbols: ${allNodes.length} nodes (${structureResult.nodes.length} structure + ${symbolResult.nodes.length} symbols), ${allEdges.length} edges (imports ${importEdgeCount})`);

    return {
      nodes: allNodes,
      edges: allEdges,
      source: this.source,
      timestamp: Date.now(),
    };
  }
}