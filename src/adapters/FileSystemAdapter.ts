import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, AdapterResult } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';
import type { TreeSitterAdapter } from './TreeSitterAdapter.ts';
import { parseTsconfigPaths, resolveAliasModule, resolveCallEdges, type TsconfigPathsMapping } from './treeSitterExtractors.ts';
import { FILE_SYSTEM } from '../shared/constants.ts';
import { createGitignoreFilter, DEFAULT_IGNORED_DIRS } from './gitignoreFilter.ts';

const log = scoped('fs-adapter');

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.java', '.rs', '.go',
  '.json', '.toml', '.yaml', '.yml',
]);

// 硬编码兜底目录表下沉到 gitignoreFilter.ts（单一真源 DEFAULT_IGNORED_DIRS）——
// cycle-141 第七轮：.gitignore 在场时与硬编码表并集裁决（见 GitignoreFilter 头注）。
const IGNORED_DIRS = DEFAULT_IGNORED_DIRS;


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
    let ignoredCount = 0;

    // .gitignore 过滤（cycle-141 第七轮）：仓库根的 .gitignore + 硬编码目录表
    // 并集裁决（GitignoreFilter 头注）。读失败 = 纯兜底（gitignore 缺席是常态）。
    const { filter: gitignore, gitignorePresent } = createGitignoreFilter(
      (p) => this.fs!.readFile(p),
      repoId,
    );
    // repoId 前缀长度：把绝对路径归一成「相对仓库根、/ 分隔」的裁决域。
    const repoPrefix = repoId.endsWith('/') ? repoId.length : repoId.length + 1;
    const relPathOf = (absPath: string): string => absPath.slice(repoPrefix).replace(/\\/g, '/');

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

        if (IGNORED_DIRS.has(baseName)) { ignoredCount++; continue; }

        let isDir: boolean;
        try {
          isDir = this.fs!.stat(fullPath).isDirectory;
        } catch {
          continue;
        }

        // .gitignore 裁决。目录在递归前剪枝（整棵子树不进图，性能主路径）——
        // **例外**：.gitignore 含取反规则时降级为「不生成节点但仍递归」，
        // 让 `!.cycles/config.yml` 这类白名单能救回目录内的文件（git 语义对齐；
        // 取反规则数通常 ≤ 几条，降级路径开销可控）。文件被排除只 continue，
        // 不存在子树问题。
        const rel = relPathOf(fullPath);
        const ignored = gitignore.isIgnored(rel, isDir);
        if (ignored && (!isDir || !gitignore.hasNegation)) { ignoredCount++; continue; }
        if (ignored && isDir) {
          // 目录被排除但有取反规则：跳过目录节点本体，仍递归其内容逐个裁决。
          ignoredCount++;
          scanDir(fullPath);
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

    // 白盒可观测：gitignore 是否在场/规则数/排除数——管理面板「索引覆盖范围」的数据面，
    // 也是「图谱为什么少了某目录」的唯一可诊断入口（排除是不可见操作，没有这个数字
    // 「被 gitignore 屏蔽」和「扫描 bug」长得一样）。scanCoverage 随 AdapterResult
    // 上行，tools.ts 回写索引时沉淀进 index_meta（readNativeIndexCoverage 读侧）。
    log.info(`scanned ${fileCount} files, ${nodes.length} nodes, ${edges.length} edges, gitignore ${gitignorePresent ? `${gitignore.ruleCount} rules` : 'absent'}, ignored ${ignoredCount}`);

    return {
      nodes,
      edges,
      source: this.source,
      timestamp: Date.now(),
      scanCoverage: {
        gitignorePresent,
        gitignoreRules: gitignore.ruleCount,
        ignoredEntries: ignoredCount,
      },
    } as AdapterResult & { scanCoverage: { gitignorePresent: boolean; gitignoreRules: number; ignoredEntries: number } };
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
    /** 候选解析：先试原样（模块名已带扩展名——真实项目普遍形态，cycle-131 真机
     * 发现：`./closureModel.ts` 拼接扩展名变 `.ts.ts` 全落空），再走扩展名枚举。 */
    const tryCandidates = (joined: string): string | null => {
      if (fileSet.has(joined)) return joined;
      for (const ext of EXT_CANDIDATES) {
        const candidate = `${joined}${ext}`;
        if (fileSet.has(candidate)) return candidate;
      }
      return null;
    };
    const resolveModuleToFile = (fromFile: string, moduleName: string): string | null => {
      // cycle-130 · T1：别名优先（@/utils/helper → src/utils/helper → 绝对域匹配）。
      if (aliasMapping) {
        const aliasRel = resolveAliasModule(aliasMapping, moduleName);
        if (aliasRel) {
          const absCandidate = tryCandidates(`${repoIdPrefix}${aliasRel}`);
          return absCandidate;
          // 别名命中但文件不在清单内（目录上限截断）——不落 bare（宁缺勿造）。
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
        return tryCandidates(joined);
      }
      return tryCandidates(moduleName);
    };

    let importEdgeCount = 0;
    /**
     * 源文件（绝对路径）→ 被 import 到的目标文件（绝对路径）集合。
     * call 边的第二跳（inferred）**只允许**沿这条已解析出的 import 关系走：
     * import 解析不到的文件不在图里，也就不该成为 call 边端点（宁缺勿造）。
     */
    const importedFilesByFile = new Map<string, Set<string>>();
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
        const bucket = importedFilesByFile.get(fromFile);
        if (bucket) bucket.add(resolved);
        else importedFilesByFile.set(fromFile, new Set([resolved]));
      }
    }

    // ── call 边提取与证据分级（T2：原生通道行为视图的核心缺口）─────────────
    //
    // 为什么要在这里做而不是在 TreeSitter 里：名字 → 符号的裁决需要 workspace
    // 上下文（本文件符号集 + 已解析出的 import 图），那正是本适配器的职能；
    // 语法事实（谁在第几行调用了什么名字）已由 callSitesByFile 交出。
    //
    // 两跳（详见 treeSitterExtractors.resolveCallEdges 的头注）：
    //   exact    同文件唯一命中；
    //   inferred 跨文件（沿 import 图）唯一命中；
    //   同文件多义 / 两跳皆空 ⇒ 跳过（不猜）。统计进日志，便于观测「有多少调用点
    //   因为歧义被放弃」——没有这个数字，「0 条 call 边」和「全被跳过」长得一样。
    const symbolsByFile = new Map<string, Array<{ label: string; id: string }>>();
    for (const symbolNode of symbolResult.nodes) {
      const bucket = symbolsByFile.get(symbolNode.filePath);
      const entry = { label: symbolNode.label, id: String(symbolNode.id) };
      if (bucket) bucket.push(entry);
      else symbolsByFile.set(symbolNode.filePath, [entry]);
    }

    let callEdgeCount = 0;
    let callAmbiguous = 0;
    let callUnresolved = 0;
    let callExact = 0;
    let callInferred = 0;
    for (const [fromFile, callSites] of symbolResult.callSitesByFile ?? []) {
      const importedFileSymbols = new Map<string, Array<{ label: string; id: string }>>();
      for (const importedFile of importedFilesByFile.get(fromFile) ?? []) {
        const symbols = symbolsByFile.get(importedFile);
        if (symbols) importedFileSymbols.set(importedFile, symbols);
      }
      const resolved = resolveCallEdges({
        callSites,
        localSymbols: symbolsByFile.get(fromFile) ?? [],
        importedFileSymbols,
      });
      for (const edge of resolved.edges) {
        allEdges.push({
          id: EdgeId(edge.id),
          source: NodeId(edge.source),
          target: NodeId(edge.target),
          type: 'call',
          properties: { ...edge.properties },
        });
      }
      callEdgeCount += resolved.edges.length;
      callAmbiguous += resolved.ambiguous;
      callUnresolved += resolved.unresolved;
      callExact += resolved.byEvidence.exact;
      callInferred += resolved.byEvidence.inferred;
    }

    log.info(`fetchDataWithSymbols: ${allNodes.length} nodes (${structureResult.nodes.length} structure + ${symbolResult.nodes.length} symbols), ${allEdges.length} edges (imports ${importEdgeCount}, calls ${callEdgeCount} = exact ${callExact} + inferred ${callInferred}; ambiguous ${callAmbiguous} skipped, unresolved ${callUnresolved} skipped)`);

    return {
      nodes: allNodes,
      edges: allEdges,
      source: this.source,
      timestamp: Date.now(),
    };
  }
}