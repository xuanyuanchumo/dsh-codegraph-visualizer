# 测试报告（cycle-121 · 会话工作区跟随）

## 2. 汇总（终态全量）

| 指标 | 数值 |
|---|---|
| 通过 | 6345 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 文件数 | 252（基线 251 +1：新增 tests/component/sessionFollow.test.tsx） |
| 耗时 | ~186s（全量轮） |

## 1. 执行环境

| 项 | 值 |
|---|---|
| 执行时点 | 2026-10-31 16:31–16:55（Asia/Shanghai） |
| 执行者 | AI-L4（Team Lead 直接执行） |
| 基线 | cycle-120 / commit `3cf69a9`（251 文件 / 6,322 用例） |
| 本轮终值 | **252 文件 / 6,345 用例 / 0 失败 / 0 跳过** |

## 2. 测试执行汇总

| 阶段 | 命令 | 结果 |
|---|---|---|
| 定向（新契约） | `vitest run tests/component/sessionFollow.test.tsx` | **17/17 绿**（4.1s） |
| 定向（轮询负向） | `vitest run tests/unit/runtime/WorkspaceBootstrap.test.ts` | **17/17 绿**（+2 负向/恢复） |
| 定向（UI 徽标） | `vitest run tests/component/WorkspaceSelector.test.tsx` | **40/40 绿**（+4） |
| 定向（回归面） | GraphPanel.test.tsx + workspacePathContract + crossWorkspaceGuardContract | 220/220 绿 |
| i18n 对称 | i18nKeyContract + i18n.test | 42/42 绿 |
| token 守卫 | tokensContract.test.ts | 8/8 绿（先红后修复，见 §4） |
| **全量** | `pnpm run test` | **252 文件 / 6,345 用例 / 0 失败**（186s） |
| 类型 | `pnpm run typecheck`（host+client+test） | 0 错 |
| Lint | `pnpm run lint`（oxlint） | 0 警告 0 错误 @297 文件 |
| 构建 | `pnpm run build` | exit 0（client 2.64MB / host 384KB / worker 1,528,568 B 不变） |
| 性能棘轮 | `pnpm run perf-gate` | 3 PASS（6345 ≥ 5347 / 2.64MB ≤ 3MB / 384KB ≤ 512KB） |
| 性能 E2E | performance.spec | 11 passed（58.7s） |

## 3. 新增覆盖矩阵（+23 例）

| 用例组 | 断言要点 | 变异敏感性说明 |
|---|---|---|
| A1-A7 readSessionCwd 降级矩阵 | scope 缺失/id 缺失/useSessions 非 fn/行缺失/cwd 空/选择器抛错/props null ⇒ 全部 null | 实现里任一降级分支删掉即红 |
| B1 跟随态对齐 | cwd 写入 sessionWorkspace + currentWorkspace 对齐 | setCurrentWorkspace 调用缺失即红 |
| B2 pin 粘性 | 真相源更新但 currentWorkspace 不动 | 抑制分支删除即红 |
| B3 不可知维持现状 | cwd null ⇒ 两字段均不变 | 「猜」一个默认值即红 |
| B4 会话切换跟随 | cwd 变化 ⇒ rerender 后跟随切换 | 依赖数组缺 cwd 即红 |
| B5 同值幂等 | cwd 不变 ⇒ setCurrentWorkspace 零调用 | 幂等守卫删除即红 |
| C1 写 pin 失效语义 | etag/diff 作废 + currentWorkspace 更新 + pin 记录 | 绕过 setCurrentWorkspace 即红 |
| C2 解除 pin 一次到位 | 立即对齐 sessionWorkspace | 对齐逻辑缺失即红 |
| C3 解除 pin 会话不可知 | 仅解除，不猜 | 「猜」默认即红 |
| C4 同值不写 | 解除时 currentWorkspace === 会话 ⇒ 不重复写 | — |
| D1 partialize 形状守卫 | 持久化清单不含 pinnedWorkspace/sessionWorkspace；反向自检 currentWorkspace 仍在 | 有人把 pin 加进 persist 即红；守卫自身区间漂移也红 |
| W1 pin 抑制负向 | 轮询期间 setCurrentWorkspace 零调用 + WORKSPACE 事件零新增（基线对齐首扫事件） | 抑制分支删除即红 |
| W2 解除 pin 恢复 | 下一轮轮询 setCurrentWorkspace('/ws2') | **只有 lastDshWorkspace 不推进才绿**（实现缺陷 W-1 正是由本用例抓出） |
| S1-S4 徽标三形态+退化 | 跟随=SPAN/固定+回调=BUTTON+触发 onUnpin/不可知=无徽标/固定无回调=SPAN 退化 | 条件渲染任一形态丢失即红 |

## 4. 本轮抓出的实现缺陷（测试先行价值实证）

| # | 缺陷 | 抓出方式 | 修复 |
|---|---|---|---|
| W-1 | pin 抑制分支推进 `lastDshWorkspace`，导致「抑制期间宿主切换的工作区」被标记为已消费——解除 pin 后 `dshCurrent === lastDshWorkspace` 恒真，**恢复跟随永远追不上** | W2 用例（先红） | 抑制分支不再推进 lastDshWorkspace（待应用变化保持 pending） |
| D-1 | 测试 fixture 缺 `pinnedWorkspace` 键 ⇒ `s.pinnedWorkspace === null` 判 false 误入抑制分支 | 既有 2 例红 | createStore fixture 补两个新字段（键缺席形态写成注释进 fixture） |
| T-1 | 徽标条件 `pinnedWorkspace !== null && onUnpinWorkspace` 让「pin 无回调」整块消失 | S4 用例（先红） | 三态渲染：BUTTON / SPAN 退化 / 跟随 SPAN |
| K-1 | CSS `var(--cg-accent, #4a9eff)` 的 fallback 字面量违反 token 守卫（raw colour literal 只许在 tokens.css 与 fallback 镜像） | tokensContract 2 例红 | fallback 去字面量 + color-mix 两处进 color-mix-fallback.css 镜像 |

## 5. 诚实披露（未验证 / 边界）

| 项 | 状态 |
|---|---|
| 真机（start-dsh-test.mjs + Chrome DevTools MCP）端到端跟随验证 | **本轮未做**——会话 scope props 的真实注入形态已由宿主 asar 源码级证据支撑（renderer.standardKit 会话 scope 装配），但「第三方插件组件实际收到 sessionId」未经浏览器实证。登记流转 cycle-122 首位（真机四探针：徽标渲染/跟随切换/pin 抑制/刷新恢复）。 |
| better-sidebar / slots / floating 降级通道的会话跟随 | 本轮只接了 conversation.view（最完整载体）。降级通道（无会话 scope props）按设计降级为 unknown 态维持现状——行为正确但不跟随，登记为后续增强。 |
| 桌面端（Electron）行为 | 同上：宿主未注入会话 scope ⇒ unknown 态，不回归（轮询与手动切换行为与旧版一致）。 |

## 6. 结论

本轮新增 23 例全绿、既有 6,322 例零回归；4 个实现缺陷（W-1/D-1/T-1/K-1）全部由测试先行抓出并修复。门禁前提证据齐备。

## 7. 补遗：J0 真机四探针（goal-round-2，2026-10-31 17:12–17:20，Chrome DevTools MCP）

环境：`start-dsh-test.mjs start --force`（DSH PID 51184 / :3080，Chrome DevTools :9222），
会话「代码图谱插件研究迭代优化」（dsh-codegraph-visualizer 工作区）。

| # | 探针 | 结果 | 证据 |
|---|---|---|---|
| J0-1 | **会话 scope 注入实证**：React fiber 挖 `GraphPanel` 包裹层 props | ✅ **宿主真实传入了会话身份**：`{hasSessionId: true, sessionId: "session-45f1bf50-…", hasUseSessions: true}`（fiber depth 1，即宿主 renderSlot 装配的标准 kit） | evaluate_script 返回值 |
| J0-2 | **跟随态**：打开工作区下拉 | ✅ 徽标 `SPAN.cg-following-active`「跟随对话」渲染；面板工作区 = `D:\Projects\TraeProjects\dsh-codegraph-visualizer`（当前对话项目，**不再是 dsh-anic**） | DOM 读回 + 截图 |
| J0-3 | **pin 抑制**：手选切到 `dsh-anic` → 立即打开下拉 | ✅ 工作区变为 dsh-anic 且**未被轮询拉回**；徽标转 `BUTTON.cg-following-pinned`「已固定 · 回到对话」；点击后**立即**回到 dsh-codegraph-visualizer 并恢复「跟随对话」（pinWorkspace(null) 一次到位语义实机验证） | DOM 三次读回 |
| J0-4 | **刷新恢复**：页面 reload 后重进代码图谱标签 | ✅ 面板工作区 = dsh-codegraph-visualizer（回到会话工作区）；`persist` 里无 pinnedWorkspace 键（D1 契约的真机印证）；截图：顶部标签渲染正常、工具栏常驻、工作区选择器显示 dsh-codegraph-vi… | reload + DOM + screenshot |
| J0-5 | **降级通道**：插件独立浮窗页（无会话 scope） | ✅ 无徽标渲染（unknown 态宁缺勿猜），工作区显示与旧版一致 | DOM 读回 badge=null |

诚实披露：J0-2 时画布呈「正在建立索引」空态——测试宿主未对本仓建过 `.codegraph` 索引
（cycle-100 (f) 既有备案），不影响工作区身份链路的判定；循环自动续跑把页面拉回对话视图
一次（与本探针无关）。

**结论**：cycle-121 的会话跟随机制在真实宿主全链路生效——上轮流转项「浏览器实证」关闭。
