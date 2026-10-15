# 测试报告

## 1. 头部

| 循环编号 | 日期 | 执行者 | 测试范围 |
|---|---|---|---|
| `cycle-93` | 2026-10-14 | AI（GLM-5.2） | 父项目 unit + dsh-anic 全套 + lint + typecheck + build |

## 2. 测试结果汇总

| 套件 | 命令 | 结果 | 耗时 | 备注 |
|---|---|---|---|---|
| 父项目 typecheck | `pnpm run typecheck` | ✅ exit 0 | ~15s | tsconfig.host + client + test 三份 |
| 父项目 lint | `pnpm run lint` | ✅ 0 warnings 0 errors | 169ms | oxlint 247 files 103 rules |
| 父项目 unit tests | `pnpm run test` | ✅ 5373 passed (197 files) | 160s | 含新增 virtualScrollReachability 4 例 + e2eSelectorContract 10 例 |
| 父项目 build | `pnpm run build` | ✅ exit 0 | ~30s | layoutWorker 1528568 bytes |
| dsh-anic typecheck | `pnpm run typecheck` | ✅ exit 0 | ~5s | scripts/typecheck.mjs 向上查 tsc |
| dsh-anic validate | `pnpm run lint` | ✅ 12/12 | 0.4s | DSH 规范符合性门 |
| dsh-anic vitest | `pnpm run test:unit` | ✅ 36/36 | 4.7s | 含新增 8 套件（evolution/governance/native/reviewEngine/runtime/segmentedLedger/selfBootstrap/truthAudit） |
| dsh-anic smoke | `pnpm run test:smoke` | ✅ 19/19 | 0.1s | stub 宿主机制冒烟 |
| dsh-anic build | `pnpm run build` | ✅ exit 0 | 70ms | tsdown client + host bundle |

## 3. 覆盖率

| 套件 | 覆盖率 | 备注 |
|---|---|---|
| 父项目 unit | 未跑 coverage（耗时） | cycle-92 已验证 ≥86% 门 |
| dsh-anic | 未跑 coverage | M9 新模块由单元测试覆盖 |

## 4. 新增/变更测试

| 测试 | 类型 | 说明 |
|---|---|---|
| tests/unit/virtualScrollReachability.test.ts | unit | 4 例：SCROLL_THRESHOLD 与聚类上限联合约束 |
| tests/unit/e2eSelectorContract.test.ts | unit | 10 例（扩 3 例）：选择器契约硬化 |
| dsh-anic/tests/unit/evolution.test.ts | unit | 进化引擎模块 |
| dsh-anic/tests/unit/governance.test.ts | unit | 治理模块 |
| dsh-anic/tests/unit/native.test.ts | unit | 原生路由 |
| dsh-anic/tests/unit/reviewEngine.test.ts | unit | LLM 评审引擎 |
| dsh-anic/tests/unit/runtime.test.ts | unit | 运行时模块 |
| dsh-anic/tests/unit/segmentedLedger.test.ts | unit | 分段账本 |
| dsh-anic/tests/unit/selfBootstrap.test.ts | unit | 自举闭环 |
| dsh-anic/tests/unit/truthAudit.test.ts | unit | 真值审计 |

## 4b. 第二轮新增测试（技能替代性，goal-6e516be5，2026-10-15）

| 测试 | 类型 | 说明 |
|---|---|---|
| dsh-anic/tests/unit/skillInvokerContract.test.ts | 契约 | 5 例：resolveSkillScriptsDir 唯一定义在 host/skillInvoker.ts；所有 import 来自该文件；≥3 真实使用方；反向自检（g 标志） |
| dsh-anic/tests/unit/skillReplaceE2E.test.ts | 端到端 | 7 例：全新空工作区→autoInstallSkill→resolveSkillScriptsDir 命中工作区副本→init-workflow 退出 0 且 .cycles/config.yml+CLAUDE.md 落在 workspace（P1 回归锚点：位置参数形态）→幽灵目录守卫→workflow-state status 可读→幂等重跑→未安装工作区内联兜底 |

第二轮验证证据（10:09 实测）：

| 套件 | 结果 | 备注 |
|---|---|---|
| dsh-anic typecheck | ✅ exit 0 | scripts/typecheck.mjs |
| dsh-anic vitest | ✅ 165/165（13 套件） | 153 + 5 + 7 = 165 对账一致 |
| dsh-anic smoke | ✅ 19/19 | ALL PASS |
| dsh-anic validate | ✅ 12/12 | DSH 规范符合性门 |
| dsh-anic build | ✅ 52ms | dist/client.js + dist/host.js |

## 5. G2 门禁判定

- 测试零错：是（第二轮：165 + 19 + 12 全绿；第一轮：5373 + 36 + 19 + 12 全绿）
- G2 通过

## 6. 第三轮增量（DSH 原生调用面，用户指令，2026-10-15）

| 套件 | 结果 | 备注 |
|---|---|---|
| dsh-anic vitest | ✅ **172/172（14 套件）** | +skillToolNative 7 例：白名单⇄内联底座集合恰好相等 / schema 枚举≡listSkillScripts / stub 宿主真实 spawn（安装→init→workflow-state 全链退出 0）/ 白名单外拒绝回显 allowed / dispose 全量（断言次数） |
| truthAudit T3/T4 | ✅ | T3 拦截 320 行 tools.ts → 拆分 toolsSkillGateway.ts + toolsSlot.ts 后通过；T4 计数改扫工具域 glob（src/host/tools*.ts）后通过 |
| smoke | ✅ 19/19 | 先 build 再跑（smoke 读 dist/） |
| validate | ✅ 12/12 | — |
| typecheck | ✅ 0 错误 | scripts/typecheck.mjs |
| build | ✅ | tsdown host+client（38ms/46ms） |
| 提交 | a8667e9 | 7 文件（2 改源 + 3 新源/测 + 2 文档） |

第三轮 G2 判定：测试零错 → 通过（172 + 19 + 12 全绿）

## 7. 第四轮增量（M10-a FlowTracker，2026-10-15）

| 套件 | 结果 | 备注 |
|---|---|---|
| dsh-anic vitest | ✅ **188/188（16 套件）** | +flowTracker 15 例（生命周期/查询/淘汰/截断/持久化）+ flowTrackerIntegration 3 例（anic_skill→flow-tracker.json→anic_status 端到端） |
| truthAudit T3/T4 | ✅ | tools.ts 225 行 / toolsSkillGateway.ts 130 行 / flowTracker.ts 158 行 均 ≤250；工具域 10 工具计数正确 |
| smoke | ✅ 19/19 | ALL PASS |
| validate | ✅ 12/12 | DSH 规范符合性门 |
| typecheck | ✅ 0 错误 | scripts/typecheck.mjs |
| build | ✅ | tsdown host+client（44ms/62ms） |
| P0-P3 扫描 | ✅ 零问题 | 零 console.log（除 logger.ts）/ 零 as any / 零 .then / 零超 250 行 |
| 提交 | 7ec23eb + f50dacb | 10 文件（3 新源/测 + 7 改源/测/文档） |

第四轮 G2 判定：测试零错 → 通过（188 + 19 + 12 全绿）

## 8. 第五轮增量（M10-b/c + P0-P3 修复，2026-10-15）

| 套件 | 结果 | 备注 |
|---|---|---|
| dsh-anic vitest | ✅ **204/204（18 套件）** | +bootstrapOrchestrator 11 例（解析 8 + 端到端 3）+ bootstrapEngineIntegration 5 例（引擎洞察/H1-H4/tech-debt/完整结构/幂等） |
| truthAudit T3/T4 | ✅ | tools.ts 225 行 / toolsSkillGateway.ts 163 行 / bootstrapOrchestrator 132 行 / bootstrapEngineIntegration 91 行 均 ≤250；工具域 12 工具计数正确 |
| smoke | ✅ 19/19 | ALL PASS |
| validate | ✅ 12/12 | DSH 规范符合性门 |
| typecheck | ✅ 0 错误 | scripts/typecheck.mjs |
| build | ✅ | tsdown host+client（45ms/52ms） |
| P0-P3 修复 | ✅ 6 项 | P0-1 archiver require→ESM / P1-1 verifyFn 真实检查 / P1-2 review CORS / P1-4 safeHandler 兜底 / P2-1 timeout 校验 / P3-3 import 位置 |
| 测试审计修复 | ✅ | usePanelResize.test.ts:38 no-op → 真实 DOM 断言（父工程 12/12） |
| 提交 | 57c86cc + b9e4a7a + f6d2dc8 + 8d4c771 + 3b2de1f | 20 文件 |

第五轮 G2 判定：测试零错 → 通过（204 + 19 + 12 全绿）

## 9. 第六轮终态验证（2026-10-15，父项目）

| 套件 | 命令 | 通过 | 失败 | 错误 | 备注 |
|---|---|---|---|---|---|
| 父项目 unit | `npx vitest run` | 5373 | 0 | 0 | 197 文件；含 virtualScrollReachability 4 例、e2eSelectorContract 10 例 |
| 父项目 typecheck | `tsc -p tsconfig.{host,client,test}.json` | 3/3 | 0 | 0 | exit 0 |
| 父项目 lint | `pnpm run lint` | 1 | 0 | 0 | oxlint 247 文件 / 103 规则，0 warnings 0 errors |
| 父项目 build | `pnpm run build` | 1 | 0 | 0 | layoutWorker 1528568 B |
| 父项目 perf-gate | `node scripts/perf-gate.mjs` | 3 | 0 | 0 | client 2.47MB/3MB · host 208KB/512KB · testCount 5373 ≥ baseline 5347 |
| 父项目 e2e（performance project） | `npx playwright test --project=performance` | 11 | 0 | 0 | 含 J35 三条新用例（开启 / 反向关闭 / 大图平移） |
| dsh-anic 三层 | `node scripts/run-tests.mjs` | 204+19+12 | 0 | 0 | 见第五轮 |

**通过：5373+3+1+1+3+11+235**　**失败：0**　**错误：0**

### 9.1 变异探针（证明新断言有鉴别力）

| 探针 | 变异 | 结果 | 结论 |
|---|---|---|---|
| M-A | `VIRTUAL_VIEWPORT.SCROLL_THRESHOLD` 500 → 5000（高于注入的 3000 节点） | e2e J35 **3 failed** | 开启断言真的依赖阈值可达 |
| M-B | `CytoscapeRenderer.disableVirtualScroll` 去掉 `removeAttribute` | e2e **1 failed / 2 passed**（仅反向用例红） | 双向断言中反向那条在做实事 |
| M-C | 阈值回到历史值 2500 | unit `virtualScrollReachability` **1 failed** | 联合校准契约能抓住旧值 |
| M-D | 动态面板豁免恢复为形状判定 `/^cg-[a-z-]+-panel$/` + 加入未登记 `.cg-fake-panel` | 守卫 **10 passed** | 旧豁免正是逃逸口（修复前该形状确实放行） |
| M-E | 恢复一条裸字面量 `.cg-graph-panel` | 守卫 **1 failed** 并指名 `PANEL.root` | 零容忍断言生效 |

### 9.2 未闭环项（诚实披露）

- `performance` project 仍无 npm script、不在 CI ⇒ J35 的**端到端**覆盖仍未进门禁；进门禁的是单测侧可达性契约。
- `docs/长期愿景评估.md` 缺失 ⇒ 六维评分 KPI 不可采集（既有登记项）。
- 50,000 节点 FPS ≥ 30（FR-50 验收原文）**未实测**；本次只证明了特性可达，未做规模压测。

## 10. 门禁汇总（G2 解析口径）

| 项 | 数值 |
|---|---|
| 通过 | 5627 |
| 失败 | 0 |
| 错误 | 0 |

> 口径（明细见 §2 / §4b / §6 / §8 / §9）：
> - 用例级：父项目 unit 5373 + 父项目 e2e(performance) 11 + dsh-anic 204 + smoke 19 + validate 12 = **5619**
> - 套件级门：父项目 typecheck 3 份 tsconfig + lint 1 + build 1 + perf-gate 3 档 = **8**
> - 合计 **5627**；失败 0、错误 0（变异探针的失败不计入：它们是刻意的红→绿对照，见 §9.1）

## 11. 真实 DSH 宿主复验（objective #7，2026-10-15）

命令：`node ./scripts/start-dsh-test.mjs start 120000` → DSH PID 43052（3080）+ Chrome PID 46292（9222）；
认证 URL `http://127.0.0.1:3080/?token=0l1HF…`；经 **Chrome DevTools MCP** 驱动（`navigate_page`/`evaluate_script`/`take_screenshot` 均需显式传 `pageId`）。
结束后 `node ./scripts/start-dsh-test.mjs stop`，status 确认 3080/9222 均已停止。

| # | 验证项 | 方法 | 实测结果 |
|---|---|---|---|
| 1 | 顶部标签栏同级注册 | 读 `[role=tab]` 列表 | `["对话","轨迹","代码图谱"]` —— 与本插件 objective #4 的「同级动态注册」一致 |
| 2 | 标签激活 | 点击「代码图谱」后读 `aria-selected` | `代码图谱=true`，其余 false |
| 3 | 视图容器可见 | 读 `[data-cg-conversation-view]` | `data-cg-visible="true"`，rect `[280,76,824,432]` |
| 4 | 面板完整渲染 | 统计 `[class*="cg-"]` | 64 个元素；`.cg-graph-panel` 与 `.cg-graph-container` 均存在 |
| 5 | **虚拟滚动标记（本轮修复项）** | 注入 3000 个 `function` 节点 + `setViewMode('callgraph')` | 容器 `data-cg-virtual-scroll="on"`，`cy.nodes().length = 3000`，store 显示层 3000 |
| 6 | 虚拟滚动反向 | `setViewMode('code')` + 1 节点小图 | 标记变为 `null`（`removeAttribute` 生效） |
| 7 | 非空图谱渲染 | `setCurrentWorkspace` 切到本仓库（`.codegraph/codegraph.db` 12.8MB 索引）→ `loadBootstrap()` | `indexStatus=ready`，50 节点 / 6 边；状态栏「50 节点 · 6 边」「✓ 图谱完整（2193 节点）」，截图见 `.cycles/cycles/cycle-93/` 审计记录 |

> 说明：第 5 项在真机上直接复现了本轮修复的效果——**同一个 3000 节点注入在修复前不可能出现该标记**（阈值 2500 且 code 视图上限 1500）。
> 第 7 项同时排除了「插件在真机里只能看空态」的可能：换成已建索引的工作区后图谱真实渲染。

## 12. 第八轮：M10-d/e 测试结果（2026-10-15）

| 套件 | 命令 | 结果 | 耗时 | 备注 |
|---|---|---|---|---|
| dsh-anic typecheck | `node scripts/typecheck.mjs` | ✅ exit 0 | ~5s | tsconfig.client + tsconfig.host |
| dsh-anic vitest | `npx vitest run` | ✅ 235/235 (20 files) | 5.66s | 含新增 presentCallContract 19 例 + continuousLearning 12 例 |
| dsh-anic smoke | `pnpm run test:smoke` | ✅ 19/19 | 0.1s | stub 宿主机制冒烟 |
| dsh-anic validate | `pnpm run lint` | ✅ 12/12 | 0.4s | DSH 规范符合性门 |
| dsh-anic build | `pnpm run build` | ✅ exit 0 | 55ms | tsdown host 166.79 kB + client |

### 12.1 新增测试套件明细

| 套件 | 例数 | 覆盖内容 |
|---|---|---|
| presentCallContract.test.ts | 19 | terminalCall/terminalResult/genericCall/genericResult 形状 + 7 工具专用呈现函数 + 纯函数幂等性 + 安全降级 |
| continuousLearning.test.ts | 12 | 空状态/healthy/degraded/slow/expensive/insufficient/排序/全局成功率/lastInvoked/格式化 |

### 12.2 门禁汇总（G2）

| 项 | 数值 |
|---|---|
| 通过 | 266（235 vitest + 19 smoke + 12 validate） |
| 失败 | 0 |
| 错误 | 0 |

### 12.3 Chrome DevTools 验证（objective #7）

| # | 验证项 | 方法 | 实测结果 |
|---|---|---|---|
| 1 | 插件面板加载 | 点击「插件」按钮 → wait_for "ANIC" | 8 官方 + 8 已安装；ANIC 工作流（uid=23_28）描述「以项目真实 .cycles/ 工件渲染的 AI 原生迭代循环工作流图」 |
| 2 | 插件启用状态 | 读 switch `aria-checked` | `checked`（启用），无「异常」标签 |
| 3 | 控制台错误 | `list_console_messages types=['error','warn']` | 零 error/warning |
| 4 | 轨迹面板 | 读 `[role=tab]` 列表 + 轨迹时间线 | 3 标签（对话/轨迹/代码图谱）；轨迹显示 pwsh git add/commit 工具调用记录 |

## 13. 第九轮：P0-P3 全面修复验证（2026-10-15）

| 套件 | 命令 | 结果 | 耗时 | 备注 |
|---|---|---|---|---|
| dsh-anic typecheck | `node scripts/typecheck.mjs` | ✅ exit 0 | ~5s | i18n.ts 新增 + reviewRoute try/catch |
| dsh-anic vitest | `npx vitest run` | ✅ 235/235 (20 files) | 4.9s | 全量回归无破坏 |
| dsh-anic smoke | `node scripts/offline-smoke.mjs` | ✅ 19/19 | 0.1s | stub 宿主冒烟 |
| dsh-anic validate | `node scripts/validate-dsh.mjs` | ✅ 12/12 | 0.4s | DSH 规范符合性门 |
| dsh-anic build | `pnpm run build` | ✅ exit 0 | 54ms | tsdown host 170.09 kB + client |

### 13.1 P0-P3 修复清单

| 级别 | 修复 | 文件 | commit |
|---|---|---|---|
| P0-1 | require()→ESM import | archiver.ts | 8d4c771 |
| P1-1 | verifyFn 恒 true→existsSync | nativeRoute.ts | 8d4c771 |
| P1-2 | CORS 头 | reviewRoute.ts | 8d4c771 |
| P1-4 | safeHandler 兜底 + reviewRoute try/catch 500 | toolsSlot.ts/toolsSkillGateway.ts/reviewRoute.ts | 3b2de1f + 13255c9 |
| P1-6/P1-7 | any→RouteReq + parseBody 共享辅助 | routeContext.ts + 4 routes | 41df4e8 |
| P2-1 | timeout typeof+Math.min | skillRoute.ts | 8d4c771 |
| P2-2 | 输入校验 band/score/cycleNumber | evolutionRoute.ts/nativeRoute.ts/cycleRoute.ts | 8ec298c |
| P2-4 | i18n t() | i18n.ts/presentation.ts/reviewRoute.ts/locale | 0ac0857 |
| P2-5 | 20 导出函数补 JSDoc | 18 routes + 2 tools | 0ac0857 |
| P3-2 | 16 未使用 req→_req | 5 routes | 0ac0857 |
| P3-3 | import 移至顶部 | renderGraph.ts | 8d4c771 |

### 13.2 门禁汇总（G2）

| 项 | 数值 |
|---|---|
| 通过 | 266（235 vitest + 19 smoke + 12 validate） |
| 失败 | 0 |
| 错误 | 0 |
