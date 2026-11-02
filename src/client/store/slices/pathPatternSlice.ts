import type { GraphState } from '../types.ts';
import { fetchPathsByPattern, fetchPathPatternSyntax } from '../../api/pathPattern.ts';
import type { PathPatternData, PathPatternPath } from '../../api/pathPattern.ts';
import { log } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

/**
 * 璇玑图 ρ（边类型序列正则）的请求状态（cycle-135）。
 *
 * ## 为什么状态必须住在 store 而不是组件里
 *
 * 与关键词检索同一条纪律（store 是唯一状态源），但这里有一个更硬的理由：ρ 的
 * 终态比关键词检索**多两种**——「拼错类型名」与「语法错误」。两者都表现为
 * 「什么都没有」，拆成 `useState` 会让面板靠 DOM 猜状态；放进 store 后
 * `pathPatternStatus` 一个字段就能被断言，面板只负责渲染。
 *
 * ## `unknown-types` 为什么是独立终态而不是 `empty` 的一个分支
 *
 * 「ρ 里出现不在 Σ 里的类型名」（`calls+`）与「图上确实没有这种边」在**数据上**
 * 同形（`paths: []`），但用户的下一步动作完全不同：前者要改拼写，后者是合法
 * 零结果。若都落 `empty`，面板只能显示一句「没有匹配」，用户永远不知道是自己
 * 打错了——这正是 `src/shared/analysis/XuanjiAdapter.ts` 在 cycle-135 单独加
 * `unknownEdgeTypes` 字段的原因，也是本切片把它落成**可区分终态**的原因。
 * 判据只读 `unknownEdgeTypes` 一个字段，不重算。
 *
 * ## `pathPatternSeq` 为什么必要
 *
 * 与 `keywordQuerySeq` 同族：用户连续按两次 Enter（或改完 ρ 立刻回车）时，
 * 先返回的旧请求会把新结果覆盖掉。用**单调递增令牌**，只有令牌仍然相等才允许
 * 写入结果；翻页同样推进令牌，避免旧分页请求写回一个已经翻走的页面。
 */
export type PathPatternStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'invalid'
  | 'not-found'
  | 'unknown-types'
  | 'error'
  | 'timeout';

/** 一次 ρ 枚举的结果快照（含宿主给的元信息与本地时刻）。 */
export interface PathPatternSnapshot {
  /** 本次请求实际发送的 ρ（trim 后）。 */
  pattern: string;
  paths: PathPatternPath[];
  /** 当前展示的路径条数（翻页时为累计值）。 */
  total: number;
  truncated: boolean;
  nextCursor: number | null;
  unknownEdgeTypes: string[];
  /** 请求完成时刻（面板显示"枚举于 12:34"）。 */
  completedAt: number;
  /** 发起这次枚举的工作区。 */
  workspace: string;
}

/** `runPathPattern` 的可选参数（与宿主 `PatternEnumerationOptions` 对齐）。 */
export interface PathPatternOptions {
  startNode?: string;
  endNode?: string;
  minHops?: number;
  maxHops?: number;
  limit?: number;
  closed?: boolean;
}

export interface PathPatternState {
  /** 最近一次提交的 ρ（输入框的受控值不在 store，避免每次击键触发全局重渲染）。 */
  pathPattern: string;
  pathPatternStatus: PathPatternStatus;
  pathPatternResult: PathPatternSnapshot | null;
  /**
   * 面向用户的错误文案键（i18n key），或语法错误的**原始诊断文本**（含 `^`）。
   * `null` 表示没有错误。
   */
  pathPatternError: string | null;
  /** 单调令牌：只有最新一次请求可以写结果。 */
  pathPatternSeq: number;
  /**
   * Σ（`GraphEdge.type` 取值域）全集——**宿主回显**，客户端不复制一份。
   *
   * cycle-136：cycle-135 的面板把 Σ 列表硬编码进了 i18n 文案，违反了「Σ 是宿主侧事实、
   * 客户端复制会静默分叉」这条纪律。本字段是修法：打开面板时向
   * `/path-pattern/syntax?pattern=`（空 pattern 合法）取一次 Σ，之后所有渲染都用它。
   */
  pathPatternEdgeTypes: string[];
  /** Σ 的取数状态：`idle` 未取 / `ready` 已取 / `failed` 取失败。 */
  pathPatternEdgeTypesStatus: 'idle' | 'ready' | 'failed';
}

/**
 * 把本切片的字段并入 `GraphState`。
 *
 * 与 `keywordQuerySlice.ts` 同一条**声明合并**纪律：`GraphState` 的形状定义留在
 * 本文件里，`types.ts` 只作为聚合点被扩展。代价是形状分布在两个文件，因此本文件
 * 导出 `PATH_PATTERN_KEYS` 并在用例里断言 `useGraphStore.getState()` 真的含有
 * 这些键——合并失效（例如有人把本切片从 `graphStore.ts` 的 import 里删掉）时
 * 用例会红，而不是让面板读到 `undefined` 后静默渲染空态。
 */
declare module '../types.ts' {
  interface GraphState extends PathPatternState {
    /**
     * 执行一次 ρ 枚举。返回 `true` 表示结果已写入（含 `unknown-types` 终态）。
     *
     * 空串直接落到 `idle`（**不发请求**）：「空查询」是一种可见状态，不是"什么都没有"。
     */
    runPathPattern: (pattern: string, options?: PathPatternOptions) => Promise<boolean>;
    /** 清空结果并回到空态（面板的「清空」按钮与 Esc 都走它）。 */
    clearPathPattern: () => void;
    /**
     * 翻页：复用上一次的 options，用 `nextCursor` 取下一页，并把新页**追加**进
     * 现有路径列表（不是替换——否则"加载更多"会把已加载的页面抹掉，用户只能看到
     * 最后一页，且说不出"我丢了前面的"）。
     *
     * 返回 `false` 表示没有可翻的页（没有结果 / `nextCursor === null`）。
     */
    runPathPatternNextPage: () => Promise<boolean>;
    /**
     * 取一次 Σ 全集（cycle-136）。
     *
     * 走 `/path-pattern/syntax?pattern=`（空 pattern 合法，返回 `ok:true` + `edgeTypes`），
     * **不是**一个新的端点：语法预检路由本来就回显 Σ，复用它避免「Σ 有两条来源」。
     *
     * 为什么放进 store 而不是面板的 `useState`：Σ 是**宿主侧事实**，面板关闭再打开
     * 不应该重新付一次网络成本；放进 store 后它随图状态一起存活。
     */
    fetchPathPatternEdgeTypes: () => Promise<void>;
  }
}

/** `GraphState` 上由本切片提供的键（声明合并失效时用例靠它变红）。 */
export const PATH_PATTERN_KEYS = Object.freeze([
  'pathPattern',
  'pathPatternStatus',
  'pathPatternResult',
  'pathPatternError',
  'pathPatternSeq',
  'pathPatternEdgeTypes',
  'pathPatternEdgeTypesStatus',
  'runPathPattern',
  'clearPathPattern',
  'runPathPatternNextPage',
  'fetchPathPatternEdgeTypes',
] as const);

/** 把一次 `data` 分支的载荷转成快照；`basePaths` 非空时表示翻页，做追加。 */
function buildSnapshot(
  data: PathPatternData,
  pattern: string,
  workspace: string,
  basePaths: readonly PathPatternPath[] | undefined,
): PathPatternSnapshot {
  const merged = basePaths ? [...basePaths, ...data.paths] : data.paths;
  return {
    pattern,
    paths: merged,
    total: merged.length,
    truncated: data.truncated,
    nextCursor: data.nextCursor,
    unknownEdgeTypes: data.unknownEdgeTypes,
    completedAt: Date.now(),
    workspace,
  };
}

/**
 * 把一次 `PathPatternOutcome` 落到状态。
 *
 * 抽出成模块级纯函数（只依赖 `set`），让「五分支各自落到哪个终态」这条规则只有
 * 一份：面板与用例都能直接读到它，而不是各自按 `kind` 再写一遍分支表。
 */
function applyOutcome(
  outcome: Awaited<ReturnType<typeof fetchPathsByPattern>>,
  pattern: string,
  workspace: string,
  basePaths: readonly PathPatternPath[] | undefined,
  set: SetFn,
): boolean {
  if (outcome.kind === 'timeout') {
    set({ pathPatternStatus: 'timeout', pathPatternError: 'pathPattern.timeout' });
    return false;
  }
  if (outcome.kind === 'failed') {
    set({ pathPatternStatus: 'error', pathPatternError: 'pathPattern.error' });
    return false;
  }
  if (outcome.kind === 'not-found') {
    set({ pathPatternStatus: 'not-found', pathPatternResult: null, pathPatternError: null });
    return false;
  }
  if (outcome.kind === 'invalid') {
    // ρ 语法错误是用户输入错误（不是服务端故障），记一条 warn 让"哪条 ρ 被拒"在
    // 日志里可查；诊断文本仍原样落到 `pathPatternError` 供面板渲染。
    log.warn('ρ pattern rejected (invalid syntax)', { pattern, diagnostic: outcome.diagnostic });
    // `pathPatternError` 存**原始诊断文本**（带 ^ 指位）：它不是给 `t()` 翻译的，
    // 而是直接渲染的 `<pre>`。没有诊断时退回 i18n 键，避免空块。
    set({
      pathPatternStatus: 'invalid',
      pathPatternResult: null,
      pathPatternError: outcome.diagnostic.length > 0 ? outcome.diagnostic : 'pathPattern.invalidSyntax',
    });
    return false;
  }

  const snapshot = buildSnapshot(outcome.data, pattern, workspace, basePaths);
  if (outcome.data.unknownEdgeTypes.length > 0) {
    // 与 `empty` 可区分的终态：结果仍落库（面板要显示"你拼错了哪些类型名"），
    // 但状态必须能被断言成 `unknown-types`，绝不能退化成 `empty`。
    set({ pathPatternStatus: 'unknown-types', pathPatternResult: snapshot, pathPatternError: null });
    return true;
  }
  const empty = snapshot.paths.length === 0 && !snapshot.truncated;
  set({
    pathPatternStatus: empty ? 'empty' : 'ready',
    pathPatternResult: snapshot,
    pathPatternError: null,
  });
  return true;
}

export function createPathPatternSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  /**
   * 翻页要复用的 options。刻意放在**切片闭包**里而不是 state：它是请求参数，
   * 不是展示状态——放进持久化 store 会让刷新后"加载更多"带着上一个会话的
   * startNode/endNode 去查一张已经切走的图。
   */
  let lastOptions: PathPatternOptions | undefined;

  return {
    pathPattern: '',
    pathPatternStatus: 'idle',
    pathPatternResult: null,
    pathPatternError: null,
    pathPatternSeq: 0,
    pathPatternEdgeTypes: [],
    pathPatternEdgeTypesStatus: 'idle',

    fetchPathPatternEdgeTypes: async () => {
      // 幂等：已取到就不重复取（Σ 是宿主侧事实，不会随会话变化）。
      if (_get().pathPatternEdgeTypesStatus === 'ready') return;
      _set({ pathPatternEdgeTypesStatus: 'idle' });
      const outcome = await fetchPathPatternSyntax('');
      if (outcome.ok) {
        _set({ pathPatternEdgeTypes: outcome.edgeTypes, pathPatternEdgeTypesStatus: 'ready' });
      } else {
        // 取失败**不**静默：留一个空列表 + failed 状态，面板据此渲染「无法获取类型列表」
        // 的降级提示，而不是假装 Σ 是空的（那会让 unknown-types 提示永远显示不出可用类型）。
        _set({ pathPatternEdgeTypes: [], pathPatternEdgeTypesStatus: 'failed' });
      }
    },

    runPathPattern: async (pattern, options) => {
      const trimmed = pattern.trim();
      const seq = _get().pathPatternSeq + 1;
      // 令牌先落库再写 loading：两步之间没有 await，因此不存在「另一个请求插入并
      // 抢走令牌」的窗口。
      lastOptions = options;
      _set({ pathPatternSeq: seq, pathPattern: trimmed });

      if (trimmed.length === 0) {
        _set({ pathPatternStatus: 'idle', pathPatternResult: null, pathPatternError: null });
        return false;
      }

      _set({ pathPatternStatus: 'loading', pathPatternError: null });

      const workspace = _get().currentWorkspace;
      const outcome = await fetchPathsByPattern({ pattern: trimmed, ...options });

      // 过期请求一律丢弃（见 `pathPatternSeq` 的注释）。
      if (seq !== _get().pathPatternSeq) return false;

      return applyOutcome(outcome, trimmed, workspace, undefined, _set);
    },

    runPathPatternNextPage: async () => {
      const state = _get();
      const current = state.pathPatternResult;
      if (!current || current.nextCursor === null) return false;

      const seq = state.pathPatternSeq + 1;
      _set({ pathPatternSeq: seq, pathPatternStatus: 'loading' });

      const workspace = state.currentWorkspace;
      const outcome = await fetchPathsByPattern({
        pattern: current.pattern,
        ...lastOptions,
        cursor: current.nextCursor,
      });

      if (seq !== _get().pathPatternSeq) return false;

      return applyOutcome(outcome, current.pattern, workspace, current.paths, _set);
    },

    clearPathPattern: () => {
      // 令牌前进一格：清空之后在途的旧请求（含翻页）不得把结果写回来。
      lastOptions = undefined;
      _set({
        pathPatternSeq: _get().pathPatternSeq + 1,
        pathPattern: '',
        pathPatternStatus: 'idle',
        pathPatternResult: null,
        pathPatternError: null,
      });
    },
  };
}

/**
 * 一条路径的跳数（边数）。`ids` 含首尾，故为 `ids.length - 1`。
 *
 * 单独导出：面板渲染「a → b → c (N hops)」与用例断言都靠它，判据只应有一份。
 */
export function pathHopsOf(path: PathPatternPath | undefined): number {
  if (!path) return 0;
  return Math.max(0, path.ids.length - 1);
}

/** 结果里的路径计数与截断标志（面板概要行与用例共用，避免两处各数一遍）。 */
export function summarizePathPatternResult(
  result: PathPatternSnapshot | null,
): { paths: number; truncated: boolean; unknownTypes: number } {
  if (!result) return { paths: 0, truncated: false, unknownTypes: 0 };
  return {
    paths: result.paths.length,
    truncated: result.truncated === true,
    unknownTypes: result.unknownEdgeTypes.length,
  };
}
