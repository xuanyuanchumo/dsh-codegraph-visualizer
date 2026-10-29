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
 * ## `builtin` 是一个**已弃用的兼容别名**
 *
 * 已安装的旧客户端读的是 `builtin`（`src/client/api/hostRequests.ts` 的 `builtin ?? true`、
 * `EmptyState.tsx` 的 `builtin ?? true`）。直接删字段会让那些客户端拿到 `undefined` 再按
 * `true` 兜底 —— 症状与修前完全一样，等于没修但多了一次崩溃面。所以保留一个版本：
 *
 *   · 宿主侧：`builtin` 恒等于 `astSource`（旧位描述的就是 AST 那一层，这是它能诚实对应的唯一解释）；
 *   · 客户端侧：`normalizePrerequisiteStatus()` 在**旧宿主**（只发 `builtin`）上把
 *     `builtin` 映射回 `astSource`，`graphSource` 一律**降级为 false**（旧宿主无权声称有图通道）。
 *
 * **已知残留（本轮明确接受，下一轮移除别名时消失）**：旧客户端仍会用 `builtin` 当作
 * 「内置图可用」的判据，因此在 `astSource === true && graphSource === false` 的宿主上，
 * 旧客户端会多显示一次降级提示。新客户端读 `graphSource`，不受影响。
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
  /**
   * @deprecated 兼容别名，值恒等于 `astSource`。下一轮（cycle-112）移除。
   * 旧客户端读这个字段；新代码一律读 `astSource` / `graphSource`。
   */
  builtin: boolean;
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
  builtin?: boolean | undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 把一份线上载荷归一成 `PrerequisiteStatus`。
 *
 * 三个方向都要能读，否则「旧客户端 × 新宿主」「新客户端 × 旧宿主」里总有一个方向会崩：
 *   · 新宿主（四个位齐全）⇒ 原样采纳 `astSource` / `graphSource`；
 *   · 旧宿主（只有 `builtin`）⇒ `astSource` 取 `builtin`，`graphSource` 降级为 `false`；
 *   · 缺字段 / 类型不对（手写响应、代理截断）⇒ `false`。
 *
 * `graphSource` 的缺省方向是 `false` 而不是 `true`：**不知道**不等于**有**。反过来兜底会让
 * 「降级模式」在根本没有图通道的宿主上重新出现，而那正是本轮要修的假叙事。
 */
export function normalizePrerequisiteStatus(raw: unknown): PrerequisiteStatus {
  const wire: WireStatus = (raw && typeof raw === 'object' ? raw : {}) as WireStatus;
  const builtin = asBoolean(wire.builtin);
  const astSource = asBoolean(wire.astSource) ?? builtin ?? false;
  const graphSource = asBoolean(wire.graphSource) ?? false;
  return {
    codegraph: asBoolean(wire.codegraph) ?? false,
    lens: asBoolean(wire.lens) ?? false,
    astSource,
    graphSource,
    // 别名由 astSource 派生，不接受线上单独声明 —— 两个来源迟早会分叉（本仓反复的教训）。
    builtin: astSource,
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
  return { codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false };
}
