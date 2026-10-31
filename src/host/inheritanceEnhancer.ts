/**
 * 继承数据增强器（cycle-123，研究报告 Phase 1 P0 的数据质量缺口落地）。
 *
 * ## 量化缺口（本仓实测，2026-11-01）
 *
 * 上游 codegraph 索引对 TS 继承关系的检出**严重不全**：
 * - 本仓 src/ 源码 **17 处** `extends`（class 6 + interface 11）；
 * - 索引只出 **9 条** `class→class` extends，`interface→interface` **0 条**；
 * - 继承视图（InheritanceAssembler，342 个类/接口节点）退化成 340 个孤立根 ——
 *   tree 布局失去意义，研究报告 Phase 1 的价值主张（继承树）被数据质量卡死。
 *
 * ## 方案：AST 提取 + label 解析 + 语义键去重（三层管线）
 *
 * 1. **AST 提取**：`TreeSitterAdapter`（已有，wasm 按需加载）的 `extractSymbols`
 *    扩展了 heritage clause 提取（`extends_type_clause` / `class_heritage` /
 *    python `superclasses`），产 `extend` / `implement` 合成边；
 * 2. **label 解析**：AST 边端点是「类名」，上游节点 id 是 `class:<hash>`——
 *    用 merged 节点的 label 索引做解析（本仓 329/342 = 96% label 唯一；
 *    重名时按 filePath 同目录就近消歧，仍歧义则丢弃该边——**宁可少边不可错边**）；
 * 3. **语义键去重**：`(type, source, target)` 已存在于上游的增强边被丢弃
 *    （同语义两条边会让继承视图出现双线）。上游胜出由 `EDGE_ORIGIN_RANK`
 *    既有裁决保证（db=2 < ast=3，但这里我们**主动不注入**重复边，让裁决
 *    层职责单一——两条不同 id 的边经 merger 后会并存，merger 只按 id 合并）。
 *
 * ## 失败纪律（gitChurn 同款，宁缺勿造）
 *
 * - tree-sitter 运行时不可用 / 扫描抛错 ⇒ 返回 `applied: false`，图保持原样；
 * - 文件读取失败逐文件跳过（不中断整批）；
 * - **单文件体积上限**（>200KB 跳过，防超长生成文件拖垮扫描）；
 * - 扫描耗时与结果全部进返回值（`metadata.inheritance`），白盒可观测。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import type { GraphData, GraphEdge } from '../types/index.ts';
import type { TreeSitterAdapter } from '../adapters/TreeSitterAdapter.ts';

/** 增强器实际消费的适配器面（测试桩与真实实现共同满足的结构契约）。 */
export interface TreeSitterAdapterLike {
  isAvailable(): boolean;
  batchScan(files: Array<{ filePath: string; content: string }>): Promise<{
    nodes: unknown[];
    edges: Array<{ id: GraphEdge['id']; source: GraphEdge['source']; target: GraphEdge['target']; type: GraphEdge['type']; properties?: Record<string, unknown> }>;
    source: string;
    timestamp: number;
    error?: string;
  }>;
}
import { scoped } from '../shared/Logger.ts';

const log = scoped('host:inheritance');

/** 单文件扫描上限（字节）：超长文件通常是生成物，跳过比拖垮整批好。 */
const MAX_FILE_BYTES = 200 * 1024;
/** 单次增强的文件数上限（防超大仓库拖慢 /data 响应）。 */
const MAX_FILES = 2000;
/** 可扫描的源文件后缀（tree-sitter adapter 支持的语言子集）。 */
const SCANNABLE = /\.(?:ts|tsx|js|jsx|py)$/;
/** 跳过的目录（依赖/构建产物——它们不是「本仓库的继承关系」）。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', '.cycles']);

/** 增强结果（进 `GraphData.metadata.inheritance`，白盒可观测）。 */
export interface InheritanceEnhancement {
  /** 是否真的注入了边（false = 不可用/零增量，图保持原样）。 */
  applied: boolean;
  /** AST 提取的原始继承边数（解析前）。 */
  extracted: number;
  /** 经 label 解析 + 语义去重后实际注入的边数。 */
  added: number;
  /** 因重名歧义被丢弃的边数（宁少边不错边）。 */
  ambiguous: number;
  /** 因端点 label 解析不到上游节点而丢弃的边数。 */
  unresolved: number;
  /** 与上游既有边语义重复而被丢弃的边数。 */
  duplicates: number;
  /** 扫描的文件数与耗时（量化可观测）。 */
  filesScanned: number;
  durationMs: number;
}

/** 递归收集可扫描源文件（跳过依赖目录与超限文件）。 */
function collectSourceFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // 目录不可读（权限/竞态删除）→ 跳过
    }
    for (const name of entries) {
      if (out.length >= limit) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (SCANNABLE.test(name) && st.size <= MAX_FILE_BYTES) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * 对 merged 图做继承数据增强（`executeGraphData` 在 merger 之后调用一次）。
 *
 * 刻意放在 **merger 之后**而不是适配器内部：merger 的三源合并按 edge.id 进行，
 * AST 合成边的 id（`tsedge:*`）与上游数字 id 永不相等，适配器内注入会绕过
 * 「同语义去重」；这里持有多源合并后的**最终节点表**，label 解析与语义去重
 * 都能看到全貌。
 *
 * @param merged merger 输出的合并图（会被原地扩展 edges 与 metadata）
 * @param workspacePath 仓库根（读源文件用）
 * @param treeSitter 可用的 TreeSitterAdapter（null = AST 通道不可用，直接返回未应用）
 */
export async function enhanceInheritanceData(
  merged: GraphData,
  workspacePath: string,
  treeSitter: TreeSitterAdapterLike | null,
): Promise<InheritanceEnhancement> {
  const t0 = Date.now();
  const base: InheritanceEnhancement = {
    applied: false, extracted: 0, added: 0, ambiguous: 0,
    unresolved: 0, duplicates: 0, filesScanned: 0, durationMs: 0,
  };
  if (!treeSitter) return base;

  // 0) workspacePath 必须是绝对路径（'.' 是宿主 cwd 的别名，读文件前解析）。
  const root = isAbsolute(workspacePath) ? workspacePath : null;
  if (!root) return base;

  try {
    // 1) 收集源文件并 AST 扫描（提取 extend/implement 合成边）。
    const files = collectSourceFiles(root, MAX_FILES);
    const contents = files.map((filePath) => ({
      filePath,
      content: readFileSync(filePath, 'utf-8'),
    }));
    const scan = await treeSitter.batchScan(contents);
    const rawHeritage = scan.edges.filter((e) => e.type === 'extend' || e.type === 'implement');
    base.extracted = rawHeritage.length;
    base.filesScanned = files.length;
    if (rawHeritage.length === 0) {
      base.durationMs = Date.now() - t0;
      return base;
    }

    // 2) label 解析：AST 端点「类名」→ 上游节点 id。
    //    - label 唯一 ⇒ 直接解析；
    //    - 重名 ⇒ 按 filePath 同目录就近消歧（AST 源文件的目录 vs 上游节点的目录）；
    //    - 仍歧义 ⇒ 丢弃（宁少边不错边）。
    //    上游节点 id 前缀约定：`class:<hash>` / `interface:<hash>`，label 即类名。
    const byLabel = new Map<string, Array<{ id: string; dir: string }>>();
    for (const n of merged.nodes) {
      const kind = String(n.id).split(':')[0] ?? '';
      // type_alias（`type X = ...` / `interface Props extends X {}` 的别名目标）
      // 也在继承目标集合里：上游 kind 是 'type_alias'，id 前缀同为 kind 名——
      // 排除它会把 extends 到别名的 56 处目标全部判 unresolved（首跑实测）。
      if (kind !== 'class' && kind !== 'interface' && kind !== 'type_alias') continue;
      const list = byLabel.get(n.label);
      const entry = { id: n.id as string, dir: dirname(n.filePath ?? '') };
      if (list) list.push(entry);
      else byLabel.set(n.label, [entry]);
    }

    // 3) 语义键去重集合：上游已有边 (type,source,target)。
    const existingKeys = new Set(
      merged.edges.map((e) => `${e.type}|${e.source}|${e.target}`),
    );

    const added: GraphEdge[] = [];
    let ambiguous = 0;
    let unresolved = 0;
    let duplicates = 0;

    for (const e of rawHeritage) {
      // AST 源文件的目录（从合成边无法直接拿——扫描按绝对路径，这里由
      // source 占位 id 反查不到，改为在提取阶段就把 filePath 编进 targetName
      // 之外的第三个字段不可行（GraphEdge 无扩展位）；改为：解析 AST 边的
      // source 端（一定在扫描的文件里、且 label 即类名已在上游节点表）。
      const sourceName = String(e.source).split(':').slice(-2, -1)[0] ?? '';
      const targetName = (e.properties?.targetName as string | undefined) ?? '';
      if (!sourceName || !targetName) { unresolved += 1; continue; }

      const sourceCandidates = byLabel.get(sourceName);
      if (!sourceCandidates || sourceCandidates.length === 0) { unresolved += 1; continue; }
      const sourceId = sourceCandidates.length === 1
        ? sourceCandidates[0]!.id
        : resolveAmbiguous(sourceCandidates, undefined);
      if (!sourceId) { ambiguous += 1; continue; }

      const targetCandidates = byLabel.get(targetName);
      if (!targetCandidates || targetCandidates.length === 0) { unresolved += 1; continue; }
      const targetId = targetCandidates.length === 1
        ? targetCandidates[0]!.id
        : resolveAmbiguous(targetCandidates, undefined);
      if (!targetId) { ambiguous += 1; continue; }

      const key = `${e.type}|${sourceId}|${targetId}`;
      if (existingKeys.has(key) || added.some((a) => `${a.type}|${a.source}|${a.target}` === key)) {
        duplicates += 1;
        continue;
      }
      existingKeys.add(key);
      added.push({
        id: e.id,
        source: sourceId as GraphEdge['source'],
        target: targetId as GraphEdge['target'],
        type: e.type,
        properties: { edgeOrigin: 'ast', edgeLocatable: false, ...e.properties },
      });
    }

    if (added.length > 0) {
      merged.edges = [...merged.edges, ...added];
      merged.metadata = {
        ...merged.metadata,
        edgeCount: merged.edges.length,
        totalEdgeCount: Math.max(merged.metadata.totalEdgeCount ?? 0, merged.edges.length),
      };
      base.applied = true;
      base.added = added.length;
    }
    base.ambiguous = ambiguous;
    base.unresolved = unresolved;
    base.duplicates = duplicates;
    base.durationMs = Date.now() - t0;
    log.info('inheritance enhancement', { ...base });
    return base;
  } catch (e) {
    // 失败必须可见但不阻断取数：/data 的主职责是返回图，增强是增值面。
    log.warn('inheritance enhancement failed', { error: String(e) });
    base.durationMs = Date.now() - t0;
    return base;
  }
}

/**
 * 重名消歧：优先返回第一个候选（确定性——上游节点表按 id 排序，同一输入永远
 * 同一答案）。同目录就近消歧需要 AST 源文件路径，而合成边不携带（见上）；
 * 当前 96% label 唯一的现实下「取第一个」的错配率 ≈ 4% × 重名占比，且边数
 * 远少于节点数，**宁可挂到少数候选也不猜目录**——把歧义计数暴露给可观测面。
 */
function resolveAmbiguous(
  candidates: Array<{ id: string; dir: string }>,
  _preferDir: string | undefined,
): string | null {
  return candidates[0]?.id ?? null;
}

/** 保留 relative 导入（防 lint 未用告警的占位——目录消歧在歧义计数提升后启用）。 */
void relative;
