/**
 * 所有权/知识视图（研究方案 §4 的 $\Pi_{\text{own}}$ 维）的**纯函数层**。
 *
 * 定义：以 `git blame` 为数据源，把「符号 → 作者」映射出来，进而支撑 bus factor、
 * 知识孤岛等度量。codeknow 的 `owners` 命令展示了这一视图的实用价值。
 *
 * ## 数据来源
 *
 * 宿主用 `git blame --porcelain <file>` 采集逐行作者事实，本模块负责：
 * ① 解析 porcelain 原始输出（`parseGitBlamePorcelain`）；
 * ② 按归一化文件路径分组（`groupBlameByFile`）；
 * ③ 与 `GraphNode` 对齐，产出「作者 → 符号」映射（`buildOwnershipMap`）；
 * ④ 计算 bus factor（`computeBusFactor`）。
 *
 * **刻意不新建存储层**：宿主每次查询现跑一次 blame，与 `gitChurn.ts` 的
 * 「短 TTL 缓存 + 失败可见」同一套取舍；这里只做纯函数，单测不必真跑 git。
 *
 * ## 证据纪律
 *
 * - 节点没有 `lineNumber` 时，归到该文件最后一行 blame 的作者（文件最新改动者），
 *   并在 `reason` 里说明用了「文件级近似」——不做无根据的猜测。
 * - 文件在 blame 里没有记录（例如新文件）时该节点**不被归属**；`attributedCount`
 *   会小于 `nodeCount`，调用方据此知道覆盖不全，而不是看到一个看起来完整的假映射。
 *
 * @module shared/ownership
 */

import type { GraphNode } from '../types/index.ts';
import { normalizeChurnPath } from './churn.ts';

/** `git blame --porcelain` 的一行记录（已抽出字段）。 */
export interface BlameLine {
  /** 提交 hash。 */
  commit: string;
  /** 该行在文件中的最终行号（1-based）。 */
  line: number;
  /** 作者名。 */
  author: string;
  /** 作者邮箱（已去掉尖括号）。 */
  email: string;
  /** 归一化文件路径。 */
  filename: string;
}

/** 单个作者的归属汇总。 */
export interface OwnershipEntry {
  author: string;
  email: string;
  nodeIds: string[];
  files: string[];
  lineCount: number;
}

/** `buildOwnershipMap` 的结果。 */
export interface OwnershipReport {
  /** blame 数据是否可用（与「是否有节点被归属」是两件事）。 */
  available: boolean;
  nodeCount: number;
  /** 成功归属到作者的节点数。 */
  attributedCount: number;
  authorCount: number;
  entries: OwnershipEntry[];
  /** nodeId → 作者名。 */
  nodeLabels: Record<string, string>;
  reason?: string;
}

/** `computeBusFactor` 的结果。 */
export interface BusFactorResult {
  /** 覆盖 threshold 所需的最少作者数；无数据为 0。 */
  busFactor: number;
  /** 累计覆盖的行数。 */
  covered: number;
  /** 参与统计的总行数。 */
  total: number;
  available: boolean;
  reason?: string;
}

/**
 * 解析 `git blame --porcelain <file>` 的原始输出。
 *
 * porcelain 形状（每个记录）：
 *
 * ```
 * <sha> <srcLine> <dstLine> <count>\n
 * author <name>\n
 * author-mail <<email>>\n
 * author-time <unix>\n
 * ...
 * filename <path>\n
 * \n
 * <行内容>\n
 * ```
 *
 * 状态机：遇到记录头开启新记录；随后收集头部字段直到空行；空行后是行内容，跳过。
 * 刻意不用「按空行切分」——`author-mail` 等字段的值本身不含空行，但重命名残留行
 * 可能让朴素切分错位；逐行状态机对字段顺序更宽容。
 *
 * 纯函数：不抛异常；解析不出记录头时跳过该行。
 */
export function parseGitBlamePorcelain(raw: string): BlameLine[] {
  const lines = String(raw ?? '').split(/\r?\n/);
  const out: BlameLine[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = /^([0-9a-f]{7,40}) \d+ (\d+) \d+/.exec(lines[index] ?? '');
    if (!header) {
      index += 1;
      continue;
    }
    const commit = header[1] as string;
    const line = Number(header[2]);
    index += 1;

    let author = '';
    let email = '';
    let filename = '';
    // cycle-146：字段循环的硬边界是 tab 前缀 content 行（porcelain 头块与行内容
    // 之间没有空行；旧「等到空行」的假设在拼接输入上把后续记录头整个吞掉）。
    while (index < lines.length) {
      const field = lines[index] ?? '';
      if (field === '' || field.startsWith('\t')) break;
      if (field.startsWith('author ')) author = field.slice('author '.length);
      else if (field.startsWith('author-mail ')) email = field.slice('author-mail '.length).replace(/^<|>$/g, '');
      else if (field.startsWith('filename ')) filename = normalizeChurnPath(field.slice('filename '.length));
      index += 1;
    }
    // content 行本身（tab 前缀；缺失容忍：截断输入的尾部可能只剩头块）。
    if (index < lines.length && (lines[index] ?? '').startsWith('\t')) index += 1;

    out.push({ commit, line, author, email, filename });
  }

  return out;
}

/** 把逐行 blame 按归一化文件路径分组。 */
export function groupBlameByFile(lines: readonly BlameLine[]): Record<string, BlameLine[]> {
  const byFile: Record<string, BlameLine[]> = {};
  for (const record of lines) {
    if (!record.filename) continue;
    const bucket = byFile[record.filename];
    if (bucket) bucket.push(record);
    else byFile[record.filename] = [record];
  }
  return byFile;
}

/**
 * 把 blame 事实与图节点对齐，产出作者 → 符号映射。
 *
 * 归属规则：
 * - 有 `lineNumber` 且该文件有对应行 → 精确归属；
 * - 有 `lineNumber` 但找不到对应行 → 归到该文件最后一行 blame 的作者（近似）；
 * - 没有 `lineNumber` → 同样归到最后一行 blame 的作者（文件级近似）。
 *
 * 两种近似都会在 `reason` 里留痕，避免调用方把近似当成精确证据。
 */
export function buildOwnershipMap(
  nodes: readonly GraphNode[],
  blameByFile: Readonly<Record<string, BlameLine[]>> | null | undefined,
): OwnershipReport {
  if (!blameByFile || Object.keys(blameByFile).length === 0) {
    return {
      available: false,
      nodeCount: nodes.length,
      attributedCount: 0,
      authorCount: 0,
      entries: [],
      nodeLabels: {},
      reason: '未提供 git blame 数据',
    };
  }

  const authors = new Map<string, OwnershipEntry>();
  const nodeLabels: Record<string, string> = {};
  let attributedCount = 0;
  let approximated = 0;

  for (const node of nodes) {
    const key = normalizeChurnPath(node.filePath);
    const fileLines = blameByFile[key];
    if (!fileLines || fileLines.length === 0) continue;

    const exact = node.lineNumber === undefined
      ? undefined
      : fileLines.find((record) => record.line === node.lineNumber);
    const match = exact ?? fileLines[fileLines.length - 1];
    if (!match) continue;
    if (!exact) approximated += 1;

    const author = match.author || '(未知作者)';
    let entry = authors.get(author);
    if (!entry) {
      entry = { author, email: match.email, nodeIds: [], files: [], lineCount: 0 };
      authors.set(author, entry);
    }
    entry.nodeIds.push(String(node.id));
    if (!entry.files.includes(key)) entry.files.push(key);
    entry.lineCount += 1;
    nodeLabels[String(node.id)] = author;
    attributedCount += 1;
  }

  const entries = [...authors.values()].sort((a, b) => b.lineCount - a.lineCount || a.author.localeCompare(b.author));
  const reason = approximated > 0 ? `${approximated} 个节点使用了文件级近似归属` : undefined;

  return {
    available: true,
    nodeCount: nodes.length,
    attributedCount,
    authorCount: entries.length,
    entries,
    nodeLabels,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * 计算 bus factor：覆盖 `threshold` 比例行数所需的最少作者数。
 *
 * 缺 blame 数据时返回 `available: false`（不编造「1 个作者」）；行数为 0 同样拒绝。
 * 作者按归属行数降序累加，返回刚好跨过阈值的那一位的作者数。
 */
export function computeBusFactor(
  nodes: readonly GraphNode[],
  blameByFile: Readonly<Record<string, BlameLine[]>> | null | undefined,
  threshold = 0.5,
): BusFactorResult {
  if (!blameByFile || Object.keys(blameByFile).length === 0) {
    return { busFactor: 0, covered: 0, total: 0, available: false, reason: '未提供 git blame 数据' };
  }
  const report = buildOwnershipMap(nodes, blameByFile);
  const entries = report.entries.filter((entry) => entry.lineCount > 0);
  const total = entries.reduce((sum, entry) => sum + entry.lineCount, 0);
  if (total === 0) {
    return { busFactor: 0, covered: 0, total: 0, available: false, reason: '没有任何节点可归属' };
  }

  let covered = 0;
  let busFactor = 0;
  for (const entry of entries) {
    covered += entry.lineCount;
    busFactor += 1;
    if (covered / total >= threshold) break;
  }

  return { busFactor, covered, total, available: true };
}
