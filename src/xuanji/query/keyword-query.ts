/**
 * 关键词查询（graphify P0-2 借鉴）：关键词 → 种子 → 子图 → 预算内文本。
 *
 * 璇玑图原型：读法不只有「按路径规则枚举」，还有一种最常用的读法——**按字找诗**。
 * 本模块把「找种子 / 取邻域 / 渲染成有 token 预算的文本」做成纯函数：
 * 无 IO、无 React、无 cordis，宿主（`src/tools.ts` 的 `graph_query`）只负责取图与序列化。
 *
 * 为什么放在库内而不是宿主 `src/shared/`：这三件事都只依赖「id / label / 边」这种
 * 图空间级概念（id / label / 边），不需要宿主的 metadata 与 branded id；放在库内可以继续维持
 * 「`src/xuanji` 零宿主依赖」的守卫，也让纯函数用例与实际运行的是同一份实现。
 *
 * 三条从 graphify 抄来的关键设计（照抄理由写在各自函数上）：
 * 1. **每词保底一个种子**：多词查询不能被单个精确命中劫持（否则第二个词等于没查）；
 * 2. **超预算三分支**：装得下 / 只有边装不下 / 节点也装不下——最容易做错的是中间那支；
 * 3. **中文 token 估算不能抄 `len/3`**：那个系数按英文校准，中文会被少算 2~3 倍，
 *    于是截断永不触发、调用方以为看全了。
 *
 * @module xuanji/query/keyword-query
 */

import type { EdgeType, NodeId } from '../core/graph-space.ts';
import { topK } from './topk.ts';

/** 参与查询的最小节点视图（宿主节点结构的字段子集：id / label / filePath）。 */
export interface KeywordNode {
  readonly id: NodeId;
  readonly label: string;
  /** 文件路径（可作为弱匹配维度；缺省不参与）。 */
  readonly filePath?: string;
}

/** 参与渲染的最小边视图（宿主边结构的字段子集：source / target / type）。 */
export interface KeywordEdge {
  readonly source: NodeId;
  readonly target: NodeId;
  readonly type: EdgeType;
}

/** 一个种子及其得分。 */
export interface SeedMatch {
  readonly id: NodeId;
  readonly label: string;
  readonly score: number;
  /** 该种子命中的查询词（用于解释「为什么它被选中」）。 */
  readonly matchedTerms: readonly string[];
}

/** `selectSeeds` 的选项。 */
export interface SelectSeedOptions {
  /** 最多几个种子（graphify 用 3）；缺省 3。 */
  readonly maxK?: number;
  /**
   * 断层截断比例：总分低于 `最高分 × gapRatio` 的候选直接丢弃（缺省 0.2）。
   * 取 0（或负数）时不做断层截断。
   */
  readonly gapRatio?: number;
}

/** `renderSubgraphText` 的选项。 */
export interface RenderOptions {
  /** 从种子向外扩几跳；缺省 1，上限 3。 */
  readonly depth?: number;
  /** token 预算；缺省 1200。 */
  readonly tokenBudget?: number;
}

/** 渲染结果的三种形态（对应 graphify 的三分支）。 */
export type RenderReason = 'fits' | 'nodes-only' | 'truncated';

/** 渲染结果。 */
export interface RenderedSubgraph {
  readonly text: string;
  /** 渲染出的文本的 token 估算值（与 `estimateTokens` 同一把尺子）。 */
  readonly tokens: number;
  /** 是否发生了截断（`fits` 之外都为 true）。 */
  readonly truncated: boolean;
  readonly reason: RenderReason;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/** 单个 ASCII 词 / 标识符的最小长度（过短的词会匹配一切，等同噪声）。 */
const MIN_TERM_LENGTH = 2;

/**
 * BFS 展开深度的**库级硬上界**（cycle-112 继承项 E：此前在 `renderSubgraphText` 里
 * 裸写 `Math.min(3, …)`，未导出——宿主 route 只好镜像一份常量，而镜像在库改上界时会
 * 静默撒谎，见 `src/host/routes/queryRoute.ts` 的 `LIBRARY_MAX_DEPTH`）。现在导出，
 * 宿主改为引用这里。
 *
 * 为什么是 3：关键词检索的种子已经是**精确节点**，展开只为「看上下文」；3 跳之后的
 * 邻域对定位几乎没有增量信息，而 token 预算（真正的稀缺资源）在 2-3 跳内通常已耗尽。
 * 要更深的邻域探索请用 `graph_path_find`（两点间精确路径），不是调大这个值。
 */
export const MAX_QUERY_DEPTH = 3;

/** 得分档位（照 graphify `serve.py:339-351`）：精确 > 前缀 > 子串 > 路径。 */
const SCORE_EXACT = 1000;
const SCORE_PREFIX = 100;
const SCORE_SUBSTRING = 1;
const SCORE_PATH = 0.5;

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 估算文本的 token 数。
 *
 * `ceil(cjkCount × 1 + otherCount / 3.5)`：
 * - 一个汉字约 1 token（中文分词器的常见经验值）；
 * - 其余字符按 3.5 字符/token（英文混合标识符的保守值，比 `len/3` 更保守）。
 * **偏向高估**：宁可早截断，也别让调用方以为看全了（研究 §P0-2 风险栏）。
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let cjk = 0;
  for (const ch of text) if (CJK.test(ch)) cjk++;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1 + other / 3.5);
}

/**
 * 把查询串切成词。
 *
 * - ASCII 标识符按 `[A-Za-z0-9_$]+` 取整段（`buildForwardAdjacency` 保持为一个词）；
 * - CJK 按**单字**切（中文没有空格，单字召回是唯一可靠的做法），同时保留连续 CJK
 *   片段作为一个整体词（「依赖环」既能整体命中，也能被「依赖」「环」分别召回）；
 * - 去重、保持首次出现顺序（确定性）；丢弃长度 < 2 的纯 ASCII 词（噪声）。
 */
export function tokenizeQuery(query: string): string[] {
  const terms: string[] = [];
  const push = (term: string): void => {
    const normalized = term.trim().toLowerCase();
    if (normalized.length === 0) return;
    if (!CJK.test(normalized) && normalized.length < MIN_TERM_LENGTH) return;
    if (!terms.includes(normalized)) terms.push(normalized);
  };

  // 单趟扫描，保持**出现顺序**（确定性来自顺序，不能按类别分两趟拼起来）：
  // 连续 CJK 片段 → 整体词 + 逐字词；ASCII 标识符 → 整段词。
  for (const run of query.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[A-Za-z0-9_$]+/g) ?? []) {
    if (CJK.test(run)) {
      push(run);
      for (const ch of run) push(ch);
    } else {
      push(run);
    }
  }

  return terms;
}

/** 单个词对单个节点的得分（档位见 SCORE_*）。 */
function scoreOnce(label: string, filePath: string | undefined, term: string): number {
  if (label === term) return SCORE_EXACT;
  if (label.startsWith(term)) return SCORE_PREFIX;
  if (label.includes(term)) return SCORE_SUBSTRING;
  if (filePath !== undefined && filePath.toLowerCase().includes(term)) return SCORE_PATH;
  return 0;
}

/**
 * 选种子：**分级加分 + 断层截断 + 每词保底**。
 *
 * 每词保底这一条必须抄（graphify `serve.py:862-887`）：两词查询里，一个词精确命中一个
 * 无关节点（1000 分）会把另一个词的相关节点（1 分）挤出前 K，于是第二个词等于没查。
 * 保底规则：每个词各自的最佳候选**无条件**入选，即使它低于断层阈值。
 *
 * 输出顺序：得分降序 → label 升序 → id 升序（完全确定，便于断言与复现）。
 * `maxK` 只约束「非保底」部分：保底条目可以超出 `maxK`（多词查询的必然结果）。
 */
export function selectSeeds(
  nodes: readonly KeywordNode[],
  terms: readonly string[],
  options: SelectSeedOptions = {},
): SeedMatch[] {
  if (nodes.length === 0 || terms.length === 0) return [];
  const maxK = Math.max(1, Math.floor(options.maxK ?? 3));
  const gapRatio = options.gapRatio ?? 0.2;

  const scored: SeedMatch[] = [];
  for (const node of nodes) {
    const label = node.label.toLowerCase();
    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const points = scoreOnce(label, node.filePath, term);
      if (points > 0) {
        score += points;
        matched.push(term);
      }
    }
    if (score > 0) scored.push({ id: node.id, label: node.label, score, matchedTerms: matched });
  }
  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  // 断层截断：低于最高分 × gapRatio 的候选不做主力（保底词仍可把它们拉回来）。
  const topScore = scored[0]!.score;
  const kept = gapRatio > 0 ? scored.filter((match) => match.score >= topScore * gapRatio) : scored;

  // topK 负责「取前 maxK 个」；HOST 不直接关心排序细节，但这一步必须走同一个实现。
  const primary = topK(kept, maxK, (match) => match.score);

  // 每词保底：每个词的最佳候选必须在内（无条件，越过断层阈值）。
  const guaranteed: SeedMatch[] = [];
  for (const term of terms) {
    let best: SeedMatch | undefined;
    for (const match of scored) {
      if (!match.matchedTerms.includes(term)) continue;
      if (!best || match.score > best.score) best = match;
    }
    if (best) guaranteed.push(best);
  }

  const chosen = new Map<NodeId, SeedMatch>();
  for (const match of [...primary, ...guaranteed]) chosen.set(match.id, match);
  return [...chosen.values()].sort(
    (a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

/** 去掉控制字符与换行（LLM 上下文注入防护，对应 graphify `sanitize_label`）。 */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

/**
 * 渲染子图文本：种子优先 → 其余按「跳数 → 度数降序 → id 升序」→ NODE 先 EDGE 后。
 *
 * 三分支（graphify `serve.py:1252-1313`）：
 * 1. `fits`：整份文本装得下预算，原样返回；
 * 2. `nodes-only`：**所有节点装得下、边装不下** ⇒ 返回全部节点 + 一行 over-budget 告示
 *    （这是最容易做错的一支：丢掉节点等于让调用方以为图里没这些节点）；
 * 3. `truncated`：连节点都装不下 ⇒ 按优先级截断，顶部打 `[!] TRUNCATED`，
 *    并给出**真的够用**的预算值（整份文本的估算值），否则告示在骗人（graphify 自己的 issue 2784 就是这样被发现的）。
 */
export function renderSubgraphText(
  graph: { readonly nodes: readonly KeywordNode[]; readonly edges: readonly KeywordEdge[] },
  seeds: readonly SeedMatch[],
  options: RenderOptions = {},
): RenderedSubgraph {
  const depth = Math.min(MAX_QUERY_DEPTH, Math.max(0, Math.floor(options.depth ?? 1)));
  const tokenBudget = Math.max(1, Math.floor(options.tokenBudget ?? 1200));
  const budgetLabel = `token_budget=${tokenBudget}`;

  const byId = new Map<NodeId, KeywordNode>();
  for (const node of graph.nodes) byId.set(node.id, node);

  const seedIds = new Set<NodeId>(seeds.map((seed) => seed.id).filter((id) => byId.has(id)));
  const adjacency = new Map<NodeId, Set<NodeId>>();
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  // 从种子做有界 BFS（跳数用 hop 记录，seed 自身 hop=0）
  const hop = new Map<NodeId, number>();
  const frontier: NodeId[] = [];
  for (const id of [...seedIds].sort()) {
    hop.set(id, 0);
    frontier.push(id);
  }
  for (let head = 0; head < frontier.length; head++) {
    const current = frontier[head]!;
    const currentHop = hop.get(current)!;
    if (currentHop >= depth) continue;
    for (const next of [...(adjacency.get(current) ?? [])].sort()) {
      if (hop.has(next)) continue;
      hop.set(next, currentHop + 1);
      frontier.push(next);
    }
  }

  // 未找到任何种子时不渲染空壳：直接把「无匹配」当作结果（调用方据此报错/换词）。
  if (hop.size === 0) {
    return {
      text: `No seed matched. (${budgetLabel})`,
      tokens: estimateTokens(`No seed matched. (${budgetLabel})`),
      truncated: false,
      reason: 'fits',
      nodeCount: 0,
      edgeCount: 0,
    };
  }

  const pickedNodes = [...hop.keys()]
    .filter((id) => byId.has(id))
    .sort((a, b) => {
      const hopDiff = hop.get(a)! - hop.get(b)!;
      if (hopDiff !== 0) return hopDiff;
      const degreeDiff = (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0);
      if (degreeDiff !== 0) return degreeDiff;
      return a.localeCompare(b);
    });

  const nodeLines = pickedNodes.map((id) => {
    const label = sanitize(byId.get(id)!.label);
    const seedMark = seedIds.has(id) ? ' *' : '';
    return `NODE ${id} ${label}${seedMark}`;
  });

  const pickedSet = new Set(pickedNodes);
  const edgeLines = graph.edges
    .filter((edge) => pickedSet.has(edge.source) && pickedSet.has(edge.target))
    .map((edge) => `EDGE ${edge.source} -> ${edge.target} (${edge.type})`);

  const header = `seeds=${seeds.filter((seed) => seedIds.has(seed.id)).map((seed) => seed.id).join(',') || '(none)'}`;
  const fullText = [header, ...nodeLines, ...edgeLines].join('\n');
  const fullTokens = estimateTokens(fullText);
  if (fullTokens <= tokenBudget) {
    return {
      text: fullText,
      tokens: fullTokens,
      truncated: false,
      reason: 'fits',
      nodeCount: pickedNodes.length,
      edgeCount: edgeLines.length,
    };
  }

  // 中间那一支：节点装得下、边装不下 ⇒ 完整节点 + over-budget 告示。
  const nodesOnlyText = [header, ...nodeLines].join('\n');
  const nodesOnlyTokens = estimateTokens(nodesOnlyText);
  const overBudgetNotice = `[!] over budget: edges omitted (${budgetLabel}, full=${fullTokens})`;
  if (nodesOnlyTokens + estimateTokens(overBudgetNotice) <= tokenBudget) {
    const text = `${nodesOnlyText}\n${overBudgetNotice}`;
    return {
      text,
      tokens: estimateTokens(text),
      truncated: true,
      reason: 'nodes-only',
      nodeCount: pickedNodes.length,
      edgeCount: 0,
    };
  }

  // 最坏分支：逐个塞节点直到预算用尽；告示里的预算值取整份文本的估算值（真的够）。
  const prefix = `[!] TRUNCATED (${budgetLabel}; full=${fullTokens})`;
  const lines: string[] = [prefix, header];
  let used = estimateTokens(`${prefix}\n${header}`);
  let kept = 0;
  for (const line of nodeLines) {
    const cost = estimateTokens(line) + 1; // +1 近似换行
    if (used + cost > tokenBudget) break;
    lines.push(line);
    used += cost;
    kept++;
  }
  const text = lines.join('\n');
  return {
    text,
    tokens: estimateTokens(text),
    truncated: true,
    reason: 'truncated',
    nodeCount: kept,
    edgeCount: 0,
  };
}
