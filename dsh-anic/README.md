# dsh-anic — AI-Native Iteration Cycle（DSH 插件）

ANIC 技能（`.dsh/skills/ai-native-iteration-cycle/`）插件化的**独立工程**。可行性研究、
需求分析、架构与里程碑见 [`docs/anic/`](../docs/anic/)（README + 01–10 + spike 报告）。

> 定位：通用插件（零项目假设）。本仓库只是它的第一个验证场——快照数据来自本仓库真实的
> `.cycles/`，但生成器只读结构化字段（INV-21 合规），不解析自由文本。

## 当前形态（M0-① spike 切片 + 热更新）

- 纯客户端贡献：`conversation.view` 顶层标签 `ANIC`（`kind:'list'` 可叠加，不顶掉既有标签）。
- 渲染真实 `.cycles/`：138 节点 / 164 边 / 57 cycles / 56 条账本事件（`autonomy L4`）。
- 零 bundle 依赖（react 之外全部外置或内联）；SVG 渲染，无布局引擎。
- **宿主入口已启用热更新路由**：`GET /anic/api/workflow-snapshot` 每次请求现场读当前
  工区 `.cycles/`（与嵌入快照共用同一构建器 `src/shared/snapshotCore.ts`）；
  面板挂载即拉 live，失败回退嵌入快照并在底行如实显示来源（不伪装）。
- 冒烟 19/19 PASS（`scripts/offline-smoke.mjs`：含刷新按钮与 svg 根断言）。

## 热加载与热更新（三层机制）

| 层 | 机制 | 生效方式 |
|---|---|---|
| **bundle 热更新** | `link:` 安装（Junction 指向本工程）——宿主加载的就是 `dist/client.js` 本体 | `pnpm --dir dsh-anic run build:watch`（tsdown `--watch` 重建 + 自动重 wrap）→ 保存源码 → 浏览器刷新即生效；**无需重装/重启宿主** |
| **数据热更新** | 宿主路由现场构建快照 + 面板 live fetch + 「刷新」按钮 | `.cycles/` 一变（新 cycle/新账本事件），点刷新即见；路由不可用时自动回退嵌入快照 |
| **运行时热卸载** | 遥测句柄 + kill-switch | DevTools：`__ANIC_TAB_SPIKE__.unregister()` / `.reregister()`；`localStorage['anic-workflow-tab']='off'` 零注册 |

## 构建

```bash
pnpm --dir dsh-anic run snapshot      # .cycles/ → src/client/workflowGraphData.ts（已生成）
pnpm --dir dsh-anic run typecheck     # client + host（0 错误）
pnpm --dir dsh-anic run build         # dist/client.js + dist/host.js
pnpm --dir dsh-anic run build:watch   # 热更新开发模式（watch + 自动重 wrap）
pnpm --dir dsh-anic run test          # 全链离线测试：规范门 12 + vitest 36 + 冒烟 19
```

> typecheck/build 依赖父工作区 `node_modules`（typescript/tsdown/@types/react 走目录向上解析）。

## 测试体系

四层金字塔（`node scripts/run-tests.mjs` 一条命令，fail-fast，`--only=<id>` 单跑）：

| 层 | 命令 | 内容 | 数量 |
|---|---|---|---|
| L1 规范门 | `pnpm run validate:dsh` | C1-C12 DSH 清单/exports/locale/icon/产物契约（依据 docs/anic/07 §2 asar 取证，每条注出处） | 12 |
| L2 单元 | `pnpm run test:unit` | snapshotCore（数值序/降级/INV-21 键集）+ snapshotRoute（disposer/404/500/解析链/effect 承接） | 21 |
| L3 契约守卫 | （同上，vitest 内） | 源码形状守卫：register 原型形态（禁未绑定提取，放行 disposer 捕获）/inject 回调形态/disposer 不丢弃/遥测+kill-switch/src 零 console.*；**反向自检 + 样例拼接构造** | 15 |
| L4 机制冒烟 | `pnpm run test:smoke` | stub 宿主 19 断言（__ModuleLoader__ 契约/138 点 164 线/热卸载/kill-switch） | 19 |
| L5 真实宿主 | `pnpm run j0` | j0-probe.mjs 经 CDP(9222) 六判据：标签可见/共存/图渲染/遥测/来源如实/热卸载+恢复/kill-switch | 8 |

测试环境脚本（派生自父工程 `scripts/start-dsh-test.mjs` 895 行，实测修复全保留；PID/日志改 `dsh-anic-*`，遮蔽预检针对 dsh-anic）：

```bash
pnpm run test:dsh:start     # 启动 DSH(3080) + 调试 Chrome(9222)，捕获认证 URL
pnpm run test:dsh:stop|restart|status|check
pnpm run test:live          # = run-tests --live（离线三层 + j0-probe）
```

**纪律**：j0-probe 绝不启动/杀死宿主进程（前置 = start-dsh-test 启动的调试 Chrome）；本脚本与父工程
脚本共用 3080，同时只跑一个测试宿主，切换前先 `stop`；`check` 只读评估端口，绝不越权杀进程。

## 安装（已完成：web + desktop 双 profile）

**网页端**（`%USERPROFILE%\.dsh\profiles\web\`）：`dependencies["dsh-anic"] = "link:D:/Projects/TraeProjects/dsh-codegraph-visualizer/dsh-anic"`
+ `dsh.profile.bundles` 追加 `"dsh-anic"`，`pnpm install` 完成（Junction 已验证，
`node_modules/dsh-anic/dist/client.js` 经链接可达且语法可解析；父插件链接未受影响）。

**桌面端**（`%USERPROFILE%\.dsh\profiles\desktop\`，2026-10-13 同步）：同款 `link:` 依赖 + bundles 末尾追加；
`pnpm install` 后 Junction、served bundle `node --check`、locale/icon 可达性全部验证；18 个既有 bundle 行
逐一在 node_modules 解析通过（4 个 `@deepseek-ai/*` 行是宿主内建，从安装锚点解析，不在 profile 依赖里——安装前后一致）。
dsh-anic 无 `@deepseek-ai/dsh*` peer 依赖 ⇒ 兼容门必过；桌面端是 dsh-anic 在 0.4.x 生态宿主上的首次挂载（07 §3 unknown 宿主姿态的实测场）。

**两端生效都需要重启对应宿主**（bundle 在启动时装载）；`link:` 安装下重启后再次 `build` 即热更新。

### J0 验证清单（重启宿主后逐条勾）

1. 顶层标签栏出现 `ANIC`，可点击，SVG 图渲染 138 圆点 / 164 边线；
2. 底行显示 `live …`（宿主路由生效）；把 `.cycles/` 里造一个变化后点「刷新」→ 数字变化；
3. DevTools：`window.__ANIC_TAB_SPIKE__.registered === true`，`nodes/edges/autonomy` 与快照一致；
4. 既有「对话 / 代码图谱」等标签不受影响（`kind:'list'` 共存）；
5. `__ANIC_TAB_SPIKE__.unregister()` → 标签消失；`reregister()` → 重现（dispose 干净）；
6. 停用开关：`localStorage['anic-workflow-tab'] = 'off'` 后重载 → 零注册、零遥测副作用；
7. 卸载 = 从 profile `package.json` 移除依赖与 bundle 行 + `pnpm install` + 重启（无残留注册）。

### 观察点（CLAUDE.md 纪律）

- `ctx.slots.register` 必须保持原型方法调用（否则 per-plugin disposal 失效）；
- apply() 内不做能力快照门控；slots 缺失走 `skipped='slots-absent'` 响亮降级；
- 路由注册经 `ctx.effect`，disposer 不丢弃（插件级卸载 = 路由注销）。

## 目录

```
dsh-anic/
  package.json            # name=dsh-anic, manifestVersion 1, client.platform web, inject=['slots']
  icon.svg  locale/       # DSH 清单资产（en/zh）
  src/index.ts            # 宿主入口：inject=['webServer','sessions']，注册热更新路由（ctx.effect）
  src/host/snapshotRoute.ts         # GET /anic/api/workflow-snapshot（现场构建，no-store+CORS）
  src/shared/snapshotCore.ts        # 快照构建唯一实现（生成器与宿主路由共用）
  src/client/index.ts     # 客户端入口（name='dsh-anic-client'，inject=['slots']）
  src/client/integrations/WorkflowTabIntegration.ts
  src/client/WorkflowGraphPanel.ts  # 取数组件 + 纯渲染 renderGraph（live→嵌入回退）
  src/client/workflowGraphData.ts   # 生成文件（嵌入快照）
  scripts/generate-snapshot.mjs     # 薄封装（import snapshotCore.ts，Node≥22.18 原生 TS）
  scripts/build-client.mjs          # 构建 + --watch 热更新模式
  scripts/wrap-client-bundle.mjs    # 与父工程同契约的包装器（styleId=dsh-anic-styles）
  scripts/offline-smoke.mjs         # 机制冒烟（stub 宿主，19 断言）
  scripts/validate-dsh.mjs          # L1 规范门 C1-C12（--json 可选）
  scripts/run-vitest.mjs  vitest.config.ts   # L2/L3 测试执行器与配置（pool=forks）
  scripts/run-tests.mjs             # 测试编排器（validate→vitest→smoke[→j0]，fail-fast）
  scripts/start-dsh-test.mjs        # 测试宿主环境（DSH 3080 + 调试 Chrome 9222，PID/日志隔离）
  scripts/j0-probe.mjs              # L5 真实宿主探针（CDP 六判据，绝不启停宿主）
  tests/unit/snapshotCore.test.ts   # 13 用例
  tests/unit/snapshotRoute.test.ts  # 8 用例
  tests/contract/dshConformance.test.ts  # 15 用例（含源码形状守卫）
  artifacts/workflow-snapshot.json  # 快照留档（审计/复现）
```

## 与父插件的关系

- **独立工程**：不 import 父项目源码；tsconfig 严格分立（client/host 隔离沿用父纪律）。
- 父插件 `src/` 保持零变更（本切片未触碰）；两插件可并存（bundle id / 样式 id / 标签 id 均隔离）。
- 评测产物（契约套件、基准、技能快照）在 `.anic-skill-evo/`，不放本工程。
