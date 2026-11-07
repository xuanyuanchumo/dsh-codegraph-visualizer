/**
 * 能力位（capability bits）的**单一来源**：宿主 `/status`、`/health` 与客户端 store / 空态
 * 显示都必须经过这里，不允许任何一侧自己拼一遍字段或自己判一遍健康。
 *
 * ## 为什么必须拆成两个位（docs/需求分析.md §61.10，cycle-110 登记 → cycle-111 修）
 *
 * 旧实现只有一个 `builtin` 位，并在 `src/host/prerequisites.ts` 的两处分支里**硬编码 `true`**。
 * 它同时被用来回答两个**不同**的问题：
 *
 *   1. 「内置 AST 分析（`/ast`、`/outline`、`/parse`）能不能用？」
 *   2. 「一个上游插件都没装，也能产出一张图吗？」
 *
 * 第 1 问在 TreeSitter 真的能用时成立；第 2 问**从来不成立** —— 内置的图产出通道只有
 * manifest 依赖图（`/dependencies`，`DependencyAdapter` 的三个纯函数解析器），而
 * `fetchMergedGraph` 的 `auto` 分支在外部数据源全空时**只记日志、不产节点**
 * （`src/tools.ts:132-134`）。两件事被一个恒真位压在一起，后果是可观测的：
 *
 *   · `/health` 的 `healthy = codegraph || lens || builtin` 恒真，「degraded」永不出现
 *     （`src/host/routes/statusRoutes.ts:42` 修前）；
 *   · 客户端空态无条件显示「降级模式 — 使用内置 TreeSitter 和依赖分析」
 *     （`src/client/components/EmptyState.tsx:58` 修前），而它承诺的那张图并不存在。
 *
 * 拆分后：
 *   · `astSource`   —— **AST 分析通道**：由 `TreeSitterAdapter` 的真实初始化状态决定
 *     （见 `src/host/prerequisites.ts` 的探针登记）；
 *   · `graphSource` —— **图数据通道**：由内置 manifest 依赖图解析器的**自检**决定
 *     （解析一段固定 JSON，能产出节点才算这条通道存在）。
 *
 * `/health` 的判定只看「有没有**图**数据通道」：`codegraph || lens || graphSource`。
 * `astSource` **单独上报、不参与判定** —— AST 可用不代表能画图，这正是旧实现的错误等式。
 *
 * ## 能力位回答的是「通道存在」，不是「本工作区有数据」
 *
 * 「`/dependencies` 这次真的返回了节点吗」取决于该工作区有没有 `package.json` / `Cargo.toml` /
 * `go.mod`，那属于**请求期**事实，随工作区、随磁盘变化。把它塞进能力位会让 `/status`
 * 变成一个按请求漂移的值，而客户端把它当作「通道开关」缓存在 store 里 —— 那种设计早就被本仓
 * 反复记为缺陷（能力快照会放大缺陷）。能力位只说「这条分析通道在这台宿主上存在」。
 *
 * ## `builtin` 别名（cycle-111 引入 → cycle-118 移除）
 *
 * 历史背景：拆位（§61.10）时已安装客户端读的是 `builtin`（`builtin ?? true` 兜底），
 * 直接删字段会让那些客户端拿到 `undefined` 再按 `true` 兜底——等于没修但多一次崩溃面。
 * 因此别名「`builtin === astSource`」保留了一个兼容窗口（原定 cycle-112，实际 cycle-118）。
 *
 * **cycle-118 移除判据已满足**（`docs/agents/09` §9.4）：兼容窗口经过 6 个循环 +
 * 真机多轮 fresh load 验证（cycle-112…117 的 J0 均为新 bundle，无旧缓存客户端存活证据）；
 * 客户端消费方（`EmptyState` / `hostRequests` / store）自 cycle-111 起已全部改读
 * `astSource` / `graphSource`。移除方向的安全性：旧客户端拿 `undefined` 会走它自己的
 * `?? true` 兜底——症状回到「多显示一次降级提示」之前的旧世界，是**少一次提示**而不是
 * 崩溃；真机旧 bundle 已无存活证据，接受该残余。
 *
 * 注意：**归一化的输入容错不保留 `builtin` 回读**。`graphSource` 缺省方向是 `false`
 * （「不知道」≠「有」），同一诚实原则适用于 `astSource`：旧宿主载荷里只认 `astSource`，
 * 不再从 `builtin` 推导——两个来源迟早分叉（本仓反复的教训）。
 */

/** 能力位。字段全部必填：任何一侧省略一个位都会在编译期暴露，而不是在运行时变成 `undefined`。 */
export interface PrerequisiteStatus {
  /** 上游 `dsh-codegraph` 的工具面是否存在（`CODEGRAPH_TOOL_EVIDENCE`）。 */
  codegraph: boolean;
  /** 上游 `dsh-tool-lens` 的工具面是否存在（`LENS_TOOL_EVIDENCE`）。 */
  lens: boolean;
  /** 内置 AST 分析通道是否可用（TreeSitter 解析器已初始化）。 */
  astSource: boolean;
  /** 内置图数据通道是否存在（manifest 依赖图解析器自检通过）。 */
  graphSource: boolean;
}

/** 线上形状（旧宿主可能缺 `astSource` / `graphSource`，所以解析入口必须宽容）。 */
type WireStatus = Partial<Record<keyof PrerequisiteStatus, unknown>> & Record<string, unknown>;

/**
 * **输入**形状：任何可能来自旧宿主、旧调用点、mock 的载荷。
 *
 * 为什么输入与状态用两个类型而不是一个：状态必须是「已归一化的真相」（每个位都有确定值），
 * 否则每个消费方都要自己再兜一次 `?? false`，而它们迟早会兜成不同的方向 —— 这正是
 * `builtin ?? true` 那类缺陷的来源。输入则必须宽容（旧宿主没有新字段、测试只关心其中两位），
 * 宽容只允许存在于**边界**，归一化之后一律严格。
 */
export interface PrerequisiteStatusInput {
  codegraph?: boolean | undefined;
  lens?: boolean | undefined;
  astSource?: boolean | undefined;
  graphSource?: boolean | undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 把一份线上载荷归一成 `PrerequisiteStatus`。
 *
 * 两个方向都要能读，否则总有一个方向会崩：
 *   · 新宿主（四个位齐全）⇒ 原样采纳 `astSource` / `graphSource`；
 *   · 缺字段 / 类型不对（手写响应、代理截断、cycle-118 前只发 `builtin` 的旧宿主）⇒ `false`。
 *
 * `graphSource` 的缺省方向是 `false` 而不是 `true`：**不知道**不等于**有**。反过来兜底会让
 * 「降级模式」在根本没有图通道的宿主上重新出现，而那正是本轮要修的假叙事。
 * `astSource` 同理（cycle-118 起不再从 `builtin` 回读推导——见模块头）。
 */
export function normalizePrerequisiteStatus(raw: unknown): PrerequisiteStatus {
  const wire: WireStatus = (raw && typeof raw === 'object' ? raw : {}) as WireStatus;
  return {
    codegraph: asBoolean(wire.codegraph) ?? false,
    lens: asBoolean(wire.lens) ?? false,
    astSource: asBoolean(wire.astSource) ?? false,
    graphSource: asBoolean(wire.graphSource) ?? false,
  };
}

/**
 * 服务是否「有图可看」。**唯一**的健康判据，宿主 `/health` 与任何将来需要它的调用方都走这里。
 *
 * `astSource` 刻意不在其中：AST 分析可用 ≠ 画得出图（旧的 `healthy = codegraph || lens || builtin`
 * 恒真就是因为把这两件事当成了一件）。`hasGraphData`（内存里当前有没有图）同样不在其中 ——
 * 它是「这一次的结果」，不是「这条通道存在」，混进来会让健康检查随请求漂移。
 */
export function isGraphServiceHealthy(
  status: Pick<PrerequisiteStatus, 'codegraph' | 'lens' | 'graphSource'>,
): boolean {
  return status.codegraph || status.lens || status.graphSource;
}

/** 从 `ctx` 之外的地方（测试、日志、事件）构造一份全 false 的能力位。 */
export function emptyPrerequisiteStatus(): PrerequisiteStatus {
  return { codegraph: false, lens: false, astSource: false, graphSource: false };
}

// ---------------------------------------------------------------------------
// 诊断四态 + 问题码分类学（cycle-146 T146-2，对齐 dsh-ops diagnose 模式）
// ---------------------------------------------------------------------------

/**
 * 诊断四态。**状态机**语义（不是布尔）：
 *
 * - `ready`      —— 至少一条图数据通道在场且至少一条 AST 通道在场，全功能；
 * - `degraded`   —— 有图可看但 AST 分析（outline/ast/children 符号树）缺席，核心旅程可用；
 * - `disabled`   —— 没有任何图数据通道（codegraph/lens/graphSource 全 false），
 *                    插件加载了但本宿主画不出图——用户需要装上游插件或检查工具面；
 * - `not-selected`—— 预留：会话未绑定工作区时的「无从谈起」态（dsh-ops 的语义），
 *                    当前 `checkPrerequisites` 不产出它，由调用方在 ctx 提取失败时映射。
 *
 * 为什么不是复用 `/health` 的两态（healthy/degraded）：两态把「装没装上游」和「内置
 * 通道自检」压成一个布尔，管理面板无法给出**分状态的修复指引**（装哪个插件、为什么
 * AST 缺席）。四态 + 稳定 code 是给前端按 code 渲染指引的数据面。
 */
export type PrerequisiteDiagnosisState = 'ready' | 'degraded' | 'disabled' | 'not-selected';

/** 稳定问题码。**对外契约**：客户端/管理面板按 code 匹配渲染修复指引，改名即破坏性变更。 */
export type PrerequisiteIssueCode =
  | 'CODEGRAPH_UPSTREAM_ABSENT'
  | 'LENS_UPSTREAM_ABSENT'
  | 'AST_SOURCE_UNAVAILABLE'
  | 'GRAPH_SOURCE_UNAVAILABLE'
  | 'ALL_GRAPH_CHANNELS_ABSENT';

/** 一条诊断问题：稳定 code + 面向用户的解释（i18n 由客户端按 code 渲染）。 */
export interface PrerequisiteIssue {
  code: PrerequisiteIssueCode;
  /** 机器可读的问题通道（哪个能力位引发的）。 */
  channel: 'codegraph' | 'lens' | 'astSource' | 'graphSource';
}

/** 诊断结果：四态 + 问题码列表 + 就绪通道清单。 */
export interface PrerequisiteDiagnosis {
  state: PrerequisiteDiagnosisState;
  issues: PrerequisiteIssue[];
  /** 就绪的图数据通道（管理面板「数据来源」徽章的数据面）。 */
  readyChannels: Array<'codegraph' | 'lens' | 'graphSource'>;
  /** AST 通道是否就绪（与 readyChannels 正交，见能力位拆分注释）。 */
  astReady: boolean;
}

/** 四态分类的**唯一**实现：宿主 /status、/health、客户端空态、管理面板都必须走这里。 */
export function diagnosePrerequisiteStatus(status: PrerequisiteStatus): PrerequisiteDiagnosis {
  const readyChannels: PrerequisiteDiagnosis['readyChannels'] = [];
  if (status.codegraph) readyChannels.push('codegraph');
  if (status.lens) readyChannels.push('lens');
  if (status.graphSource) readyChannels.push('graphSource');

  const issues: PrerequisiteIssue[] = [];
  if (!status.codegraph) issues.push({ code: 'CODEGRAPH_UPSTREAM_ABSENT', channel: 'codegraph' });
  if (!status.lens) issues.push({ code: 'LENS_UPSTREAM_ABSENT', channel: 'lens' });
  if (!status.astSource) issues.push({ code: 'AST_SOURCE_UNAVAILABLE', channel: 'astSource' });
  if (!status.graphSource) issues.push({ code: 'GRAPH_SOURCE_UNAVAILABLE', channel: 'graphSource' });

  // 有图可看 = readyChannels 非空；AST 缺席把 ready 降为 degraded。
  const hasGraph = readyChannels.length > 0;
  const state: PrerequisiteDiagnosisState =
    !hasGraph ? 'disabled'
    : !status.astSource ? 'degraded'
    : 'ready';

  if (!hasGraph) {
    // 问题码按确定性顺序插到最前：面板指引的第一行永远是「为什么画不出图」。
    issues.unshift({ code: 'ALL_GRAPH_CHANNELS_ABSENT', channel: 'graphSource' });
  }

  return { state, issues, readyChannels, astReady: status.astSource };
}
