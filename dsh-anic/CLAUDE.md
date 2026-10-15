# dsh-anic — ANIC 独立 DSH 插件

> 独立工程：源码零依赖父项目（G-IND 守卫）。当前借用父工程 node_modules 是过渡态（TD-A1）。

## Commands
- Build: `pnpm run build`（client bundle + host bundle，tsdown）
- Test: `pnpm run test`（validate + vitest + smoke 三层金字塔）
- Lint: `pnpm run lint`（DSH 规范符合性门 validate-dsh.mjs）
- Typecheck: `pnpm run typecheck`（tsconfig.client + tsconfig.host，向上查 tsc）
- Live probe: `pnpm run j0`（真实宿主 J0 六步协议探针，绝不启停宿主）

## Verifying your work
- Run `pnpm run typecheck && pnpm run test && pnpm run build` before reporting done.
- Paste output as evidence.
- 父工程 `src/` 零变更——dsh-anic 是独立工程，不改父项目源码。

## Conventions
- ESM only: `"type": "module"`，`.ts` 扩展名在 import 里
- Host/Client 隔离: tsconfig.host.json / tsconfig.client.json 分离编译
- 模块化纪律: 单文件 ≤~250 行 / 一域一文件 / 路由按端点拆 / 特性模块制
- 日志: scoped() logger from host/logger.ts，不直接 console
- i18n: 所有用户面文本经 t() from locale/
- CSS: cg- 前缀，CSS 变量主题
- 测试: vitest 单元/契约，stub 宿主冒烟，j0-probe 真实宿主

## Things the agent gets wrong
- `tsc` 不在 dsh-anic node_modules——typecheck 脚本向上查父工程 node_modules/typescript/bin/tsc（TD-A1 过渡态）
- `ctx.get(name)` 默认 strict=true 会杀死正在 loading 的 provider——用 `ctx.get(key, false)` 探测存在性
- 嵌入快照与路由快照共用唯一构建器——改 snapshotCore 要同步两处
- 测试读 `dist/` 对 `src/` 变更惰性——先 build 再跑 smoke
- 独立性守卫 G-IND：dsh-anic 源码不得 import 父项目 src/——只许借 node_modules
- `invokeSkillScript` 项目目录是第一个位置参数（`node <script> <workspace> ...args`）——绝不能传 `--project-dir` 旗标，15 个脚本只认 args._[0]；替代性 e2e（skillReplaceE2E）钉死此约定
- truthAudit T4 工具计数扫描整个工具域（`src/host/tools*.ts` glob），不硬编码 tools.ts 单文件——工具拆分后单文件计数漏报
- `anic_install` 不得先 validateWorkspace（要求目录已存在）——安装就是 bootstrap 新目录的动作，只做 `..` 形状校验，mkdir 交给 autoInstallSkill
- smoke 读 dist/ 且 vitest T3（≤250 行）会拦拆分前的超长文件——工具域新文件放 toolsSkillGateway.ts，槽位形状在 toolsSlot.ts
- FlowTracker 每流程状态跟踪：anic_skill handler 在 invokeSkillScript 前后调用 startFlow/finishFlow，持久化到 {workspace}/.cycles/flow-tracker.json；flowStats 中 `stats[f.script]` 在 noUncheckedIndexedAccess 下需用 let s 本地变量收窄（直接 `stats[f.script].total++` 会 TS2532）
- presentCall/presentResult 纯函数在 presentation.ts 构造 ToolCallView/ToolResultView——脚本执行类用终端卡片（card:'terminal'），查询类用通用卡片（card:'generic'）；空字符串经 `output || undefined` 规范化为 undefined（测试断言要匹配）
- continuousLearning 健康等级检查顺序：slow（超时率）先于 degraded（成功率）——因为 timeout 是 DONE 的子集，先检查更具体的；analyzeSkillHealth 是纯函数零副作用，anic_status 返回 health+healthSummary
