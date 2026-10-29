import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import { fetchKeywordQuery, commitKeywordQueryEtag } from '../../api/keywordQuery.ts';
import type { KeywordQueryResult, KeywordSeed } from '../../api/keywordQuery.ts';
import { log } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

/**
 * 关键词图检索的请求状态（cycle-111 / N-5）。
 *
 * ## 为什么状态必须住在 store 而不是组件里
 *
 * 本仓的既有纪律是「store 是唯一状态源」，但这里还有一个更硬的理由：面板的四种终态
 * （空查询 / 无结果 / 失败 / 超时）与「结果」是**同一个状态机**的成员。拆成 `useState`
 * 会让「关闭面板再打开」丢掉上一次结果、让 E2E 只能靠 DOM 猜状态；放进 store 后
 * `keywordQueryStatus` 一个字段就能被断言，面板只负责渲染。
 *
 * ## 为什么 `status` 是枚举而不是 `isLoading + error + result` 三件套
 *
 * 「超时」与「失败」对用户的下一步动作要求不同（超时建议重试或换词，失败要看到服务端错误），
 * 合并成一个 `error: string` 就无法在 UI 上区分它们。
 *
 * ## `keywordQuerySeq` 为什么必要
 *
 * `expandGeneration` 回答的是「图变了吗」，不是「这是最新一次关键词」。用户连续按两次
 * Enter（或改词后立刻回车）时，先返回的旧请求会把新结果覆盖掉——与 cycle-85 的 AST
 * 分页同族缺陷。这里用**单调递增令牌**，只有令牌仍然相等才允许写入结果。
 */
export type KeywordQueryStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'timeout';

/** 一次检索的结果快照（含宿主给的元信息与本地时刻）。 */
export interface KeywordQuerySnapshot extends KeywordQueryResult {
  /** 发起这次查询的工作区，供面板显示「结果来自哪个仓库」。 */
  workspace: string;
  /** 请求完成时刻（面板显示"检索于 12:34"，不是校验器域 —— 见 graphEtag 的注释）。 */
  completedAt: number;
}

export interface KeywordQueryState {
  /** 最近一次提交的关键词（输入框的受控值不在 store，避免每次击键触发全局重渲染）。 */
  keywordQuery: string;
  keywordQueryStatus: KeywordQueryStatus;
  keywordQueryResult: KeywordQuerySnapshot | null;
  /** 面向用户的错误文案键（i18n key），`null` 表示没有错误。 */
  keywordQueryError: string | null;
  /** 单调令牌：只有最新一次请求可以写结果。 */
  keywordQuerySeq: number;
}

/**
 * 把本切片的字段并入 `GraphState`。
 *
 * 为什么用**声明合并**而不是去改 `src/client/store/types.ts`：那个文件在本轮由 T2 持有
 * （能力位拆分刚改过 `prerequisites` 的类型），两个成员同时编辑同一个 interface 是
 * "改一个新增功能、红一片无关文件"的典型来源。声明合并让本切片的形状定义留在
 * **它自己所在的文件**里，`types.ts` 只作为聚合点被扩展，冲突面从"同一段文本"缩到"零"。
 *
 * 代价必须写清：`GraphState` 的形状从此分布在两个文件。因此本文件导出了
 * `KEYWORD_QUERY_KEYS` 并在用例里断言 `useGraphStore.getState()` 真的含有这些键——
 * 合并失效（例如有人把本文件从 `graphStore.ts` 的 import 里删掉）时，用例会红，
 * 而不是让面板读到 `undefined` 后静默渲染空态。
 */
declare module '../types.ts' {
  interface GraphState extends KeywordQueryState {
    /**
     * 执行一次检索。返回 `true` 表示结果已写入（含 304 保留现状）。
     *
     * 空串直接落到 `idle`（**不发请求**）：「空查询」是一种可见状态，不是"什么都没有"。
     */
    runKeywordQuery: (query: string, options?: { depth?: number; tokenBudget?: number }) => Promise<boolean>;
    /** 清空结果并回到空态（面板的「清空」按钮与 Esc 都走它）。 */
    clearKeywordQuery: () => void;
    /** 选中一个种子节点，并把命中集合标到画布上。 */
    selectKeywordSeed: (nodeId: string) => void;
  }
}

/** `GraphState` 上由本切片提供的键（声明合并失效时用例靠它变红）。 */
export const KEYWORD_QUERY_KEYS = Object.freeze([
  'keywordQuery',
  'keywordQueryStatus',
  'keywordQueryResult',
  'keywordQueryError',
  'keywordQuerySeq',
  'runKeywordQuery',
  'clearKeywordQuery',
  'selectKeywordSeed',
] as const);

/** 与宿主 `QUERY` 同口径的默认值（各写一份会静默分叉，故此处集中）。 */
const QUERY_DEFAULTS = Object.freeze({
  DEPTH: 2,
  TOKEN_BUDGET: 800,
} as const);

export function createKeywordQuerySlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    keywordQuery: '',
    keywordQueryStatus: 'idle',
    keywordQueryResult: null,
    keywordQueryError: null,
    keywordQuerySeq: 0,

    runKeywordQuery: async (query, options) => {
      const trimmed = query.trim();
      const seq = _get().keywordQuerySeq + 1;
      // 令牌先落库再写 loading：两步之间没有 await，因此不存在「另一个请求插入并抢走令牌」
      // 的窗口。
      _set({ keywordQuerySeq: seq, keywordQuery: trimmed });

      if (trimmed.length === 0) {
        _set({ keywordQueryStatus: 'idle', keywordQueryResult: null, keywordQueryError: null });
        return false;
      }

      _set({ keywordQueryStatus: 'loading', keywordQueryError: null });

      const workspace = _get().currentWorkspace;
      const outcome = await fetchKeywordQuery({
        q: trimmed,
        depth: options?.depth ?? QUERY_DEFAULTS.DEPTH,
        tokenBudget: options?.tokenBudget ?? QUERY_DEFAULTS.TOKEN_BUDGET,
        ...(workspace && workspace !== '.' ? { workspace } : {}),
      });

      // 过期请求一律丢弃（见 `keywordQuerySeq` 的注释），且**不得** commitEtag：
      // 校验值只能描述"客户端确实持有的那份载荷"。
      if (seq !== _get().keywordQuerySeq) return false;

      if (outcome.kind === 'not-modified') {
        // 304 不是失败：服务端确认本请求键对应的载荷没变，而客户端此前**确实应用过**它
        // （校验值只在 commitKeywordQueryEtag 之后才存在）。保留现状、把状态置回终态。
        log.info('keyword query not modified (304)', { q: trimmed });
        const previous = _get().keywordQueryResult;
        _set({ keywordQueryStatus: previous ? 'ready' : 'idle', keywordQueryError: null });
        return true;
      }

      if (outcome.kind === 'timeout') {
        _set({ keywordQueryStatus: 'timeout', keywordQueryError: 'keywordQuery.timeout' });
        return false;
      }

      if (outcome.kind === 'failed') {
        _set({ keywordQueryStatus: 'error', keywordQueryError: 'keywordQuery.error' });
        return false;
      }

      const snapshot: KeywordQuerySnapshot = { ...outcome.data, workspace, completedAt: Date.now() };
      // 「无结果」与「有结果」是两个终态：种子与节点都为空时面板显示
      // 「没有匹配的节点，换个词试试」而不是一张空列表。
      const empty = snapshot.seeds.length === 0 && snapshot.nodes.length === 0;
      _set({
        keywordQueryStatus: empty ? 'empty' : 'ready',
        keywordQueryResult: snapshot,
        keywordQueryError: null,
      });
      // 载荷已落地，此刻登记校验值才安全。
      commitKeywordQueryEtag(outcome);
      return true;
    },

    clearKeywordQuery: () => {
      // 令牌前进一格：清空之后在途的旧请求不得把结果写回来。
      _set({
        keywordQuerySeq: _get().keywordQuerySeq + 1,
        keywordQuery: '',
        keywordQueryStatus: 'idle',
        keywordQueryResult: null,
        keywordQueryError: null,
      });
    },

    selectKeywordSeed: (nodeId) => {
      const state = _get();
      const exists = state.rawNodes.some((node) => (node.id as string) === nodeId);
      if (!exists) {
        // 种子来自宿主返回的 `nodes`，理论上一定在图上；不在说明它是"库认为存在、
        // 客户端这张图里没有"的跨版本结果。不静默写入一个选不中的 id（那在画布上
        // 表现为"点了没反应"），而是明确记一条日志并放弃。
        log.warn('selectKeywordSeed: node not in current graph', { nodeId });
        return;
      }
      // 选中该节点 + 把所有种子标成高亮，让「命中集合」在画布上可见。
      _set({
        selectedNodeId: nodeId as GraphState['selectedNodeId'],
        highlightedNodeIds: seedIdsOf(state.keywordQueryResult),
      });
    },
  };
}

/**
 * 把种子的 id 列表转成画布高亮用的 id 数组。
 *
 * 单独导出成纯函数：面板与将来的快捷键入口都要"把命中集合标到画布上"，
 * 判据只应有一份。
 */
export function seedIdsOf(result: KeywordQueryResult | null): GraphState['highlightedNodeIds'] {
  if (!result) return [];
  return result.seeds.map((seed) => seed.id) as GraphState['highlightedNodeIds'];
}

/** 结果里的节点/边计数（面板概要行与 E2E 断言共用，避免两处各数一遍）。 */
export function summarizeKeywordResult(result: KeywordQueryResult | null): {
  nodes: number;
  edges: number;
  tokens: number;
  truncated: boolean;
} {
  if (!result) return { nodes: 0, edges: 0, tokens: 0, truncated: false };
  return {
    nodes: result.nodes.length,
    edges: result.edges.length,
    tokens: result.tokens,
    truncated: result.truncated === true,
  };
}

/** 结果里被截断时展示给用户的 i18n 键（面板与用例共用同一判据）。 */
export function truncationReasonKey(reason: string): string {
  if (reason === 'nodes-only') return 'keywordQuery.reasonNodesOnly';
  if (reason === 'truncated') return 'keywordQuery.reasonTruncated';
  return 'keywordQuery.reasonFits';
}

export type { GraphNode, GraphEdge, KeywordSeed };
