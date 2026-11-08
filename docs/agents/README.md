# docs/agents/ —— 面向 AI 代理与贡献者的开发文档族

本目录是 `dsh-codegraph-visualizer` 的**权威开发文档**，服务于两类读者：

1. **AI 编码代理**（Claude / GPT / DeepSeek 等）——需要在不读完全部源码的前提下，准确知道
   「边界在哪、契约是什么、改动会破坏什么」；
2. **人类贡献者**——需要一份比 README 更深、比源码更浅的落地指南。

## 为什么单独建一个目录

`CLAUDE.md` 里的「Things the agent gets wrong」已经积累了 120+ 条教训，那是**事故记录**；
`docs/需求分析.md` / `docs/测试体系.md` 是**需求与验证**。二者都回答不了「我现在要加一个
面板，应该动哪几个文件、必须同步改哪些测试」。本目录补的就是这一层。

依据：`docs/评估评审研究开发体系.md` §九 待补输入 + 用户 objective #1
（"在 docs/agents/ 添加本项目的开发规范/API/设计文档"）。

## 文档地图

| 文件 | 回答的问题 | 何时读 |
|---|---|---|
| [01-插件开发规范.md](./01-插件开发规范.md) | 写代码必须遵守什么？宿主版本怎么承诺？清单怎么声明？复杂度与依赖怎么管？ | 动手改任何文件**之前** |
| [02-宿主API参考.md](./02-宿主API参考.md) | 宿主侧能用哪些 Context 服务？19 条路由、11 个 tool、25 个错误码长什么样？ | 改 `src/host/**` 或 `src/index.ts` 时 |
| [03-客户端API参考.md](./03-客户端API参考.md) | 客户端怎么注册标签页？store 有哪些字段？hooks / i18n / CSS 怎么用？**附3 会话工作区跟随（三态）· 附4 增量引擎健康信号** | 改 `src/client/**` 时 |
| [04-架构设计.md](./04-架构设计.md) | 分层怎么切的？数据怎么流的？为什么这么决策？**§12 会话跟随与增量信号的架构注记** | 做结构性改动、评审设计时 |
| [05-DSH官方规范检索证据.md](./05-DSH官方规范检索证据.md) | 我们对 DSH 契约的每条断言，官方依据（带来源 URL）在哪？ | 引用宿主契约、抬版本窗、判断某个服务是否真实存在时 |
| [06-dsh-anic插件开发规范.md](./06-dsh-anic插件开发规范.md) | dsh-anic 独立工程的开发规范：六域分区路由、模块架构、适配器、测试金字塔 | 改 `dsh-anic/src/**` 时 |
| [07-界面与功能域规划.md](./07-界面与功能域规划.md) | 功能域 × 界面组件 × 入口通道 × 状态源 × 测试锚点矩阵；技能/插件能力面怎么进界面 | 改界面、加面板/入口时 |
| [08-质量属性与评审标准.md](./08-质量属性与评审标准.md) | 什么数值才算过？用什么命令验？哪些只有人工评审？ | 评审、发版、判断「够不够」时 |
| [09-破坏性变更与兼容策略.md](./09-破坏性变更与兼容策略.md) | 承诺分几层？真门是哪个字段？宿主换代怎么办？**本轮新增 §9：我们自己跨进程的 API 形状变更怎么判两个方向的兼容** | 抬版本窗、兼容事故、上游插件突然不加载时 |
| [10-璇玑图算法库使用规范.md](./10-璇玑图算法库使用规范.md) | `src/xuanji/**` 分成哪几层？某个需求该用哪个 API？`GraphSpace.log` 与 `drainChangeLog` 的边界？`InvariantChecker` 的 I1–I5 与接线点？截断契约？池的生命周期与 `syncGraph` 三态？**什么绝对不能做**？ | 改 `src/xuanji/**` 或 `src/shared/analysis/XuanjiAdapter.ts`、写路径/环/关键词算法时 |
| [11-图检索与关键词查询.md](./11-图检索与关键词查询.md) | `/query` 路由的参数/响应/etag 五维请求键？面板四态？token 预算口径为什么**不是** `len/3`？截断为什么必须可见？和 `graph_query` 工具是什么关系？ | 做关键词检索、改 token 口径、评审「这能力到底做完没有」时 |

## 与既有文档的关系（避免重复，各司其职）

| 文档 | 定位 | 不要在这里找 |
|---|---|---|
| `CLAUDE.md` | 命令速查 + 事故教训清单（R10 编码化） | 完整 API 签名 |
| `docs/agents/*`（本目录） | 规范 / API / 设计三件套（cycle-111 增至 11 份） | 需求原文、测试用例清单 |
| `docs/需求分析.md` | 需求与缺陷分析全集（341 KB，含 §59.x / §61 / §62 系列） | 快速上手 |
| `docs/测试体系.md` | 七层测试策略与覆盖矩阵 | 架构说明 |
| `docs/用户旅程.md` | J0–J51 用户旅程定义 | 实现细节 |
| `docs/anic/*` | **另一个独立工程** `dsh-anic/` 的设计文档 | 本插件的 API |
| `docs/research/dsh-多代API规范差异与兼容矩阵.md` | 多代 API 差异与兼容矩阵（行级证据） | 快速上手 |
| `docs/research/dsh-round110-规范与破坏性变更.md` | cycle-110 官方规范检索与变更面影响判定（来源 URL） | 本项目的承诺口径（在 09） |
| `docs/评估评审研究开发体系.md` | 七维评估体系与全生命周期门禁的**框架** | 具体阈值与命令（在 08） |

> ⚠️ `docs/anic/` 描述的是仓库内的**独立兄弟工程** `dsh-anic/`（ANIC 工作流可视化），
> 与本插件共享仓库但**源码零依赖**。不要把两者的 API 混用。

## 维护规则（硬约束）

1. **改 API 必须同步改文档**：任何 `export` 的新增/删除/签名变化，都要在
   [02-宿主API参考.md](./02-宿主API参考.md) 或 [03-客户端API参考.md](./03-客户端API参考.md)
   里同步。文档里的路径必须带行号（如 `src/index.ts:30`），便于 `grep` 与交叉验证。
2. **文档引用的事实必须可验证**：本目录所有路径、命令、常量都要真实存在。
   验证方式见下方「事实基座自检」。
3. **中文注释**：本项目要求代码注释使用中文（用户 objective #3）。
   文档正文同样用中文，但**标识符、路径、命令、错误码保持原文**，不做翻译。
4. **不写"应该"**：只写"是"或"不是"。如果某个约束没有对应的守卫测试，必须显式标注
   「无机器守卫」，而不是让它看起来像有保护。
5. **数量型事实只在 02 里写一次**：工具数 / 路由数 / 错误码数 / 组件数 / hooks 数 / CSS 数
   集中登记在 [02-宿主API参考.md](./02-宿主API参考.md)（宿主侧）与
   [03-客户端API参考.md](./03-客户端API参考.md)（客户端侧），本 README 与 04 只引用不复写。
   这类数字最容易过期——2026-10-28 复核时发现 `8 个 tool / 18 条路由 / 27 个错误码` 三个数字全部已漂移。

## 事实基座自检

本目录引用的事实可用以下命令抽验（`fact-base-verify` 只扫评估报告，故这里手写）：

```bash
# 1) 目录与文件存在性
ls docs/agents/
# 期望：01 … 11 共 11 份 + README.md

# 2) 关键行号是否仍然指向声称的内容
grep -n "export const inject" src/index.ts
grep -n "export const inject" src/client/index.ts
grep -n "DSH_SUPPORTED_RANGE" src/shared/dshGeneration.ts
grep -n "manifestVersion" package.json
# 3) 路由数量（应为 19 个 register*Route 定义；/query 属 T3，落地后为 20）
grep -rho "^export function register[A-Za-z]*Route" src/host/routes/*.ts | wc -l
# 4) tool 数量（应为 11 个 defineTool，且与 src/index.ts 的注册数相等）
grep -c "defineTool(" src/tools.ts
grep -c "ctx.tools.register" src/index.ts
# 5) 错误码数量（应为 25，且 ERROR_CODES 与 ERROR_MESSAGES 键集合相等）
grep -c "^  [A-Z_]*:" src/shared/constants.ts   # 全文件，非 ERROR_CODES 段
# 6) dsh-anic 独立性（G-IND）：源码不得 import 父项目 src/
grep -r "from.*\.\./\.\./src/" dsh-anic/src/ || echo "G-IND OK"
# 7) dsh-anic 路由数量（18 个路由文件）
ls dsh-anic/src/host/routes/*.ts | wc -l
# 8) dsh-anic 测试金字塔
cd dsh-anic && pnpm run typecheck && pnpm run test && pnpm run build
# 9) cycle-111：璇玑图库规模与宿主深挖点（10-璇玑图算法库使用规范.md §1-§2）
find src/xuanji -name '*.ts' | wc -l                                 # → 16
grep -rnE "from '.*xuanji/(core|index|query|ops|registry)/" src/ \
  --include="*.ts" | grep -v "^src/xuanji/"                          # → 10 行，落在 3 个宿主文件

# 10) cycle-111：关键词查询的两个口径点（11-图检索与关键词查询.md §2-§8）
grep -n "cjk \* 1 + other / 3.5" src/xuanji/query/keyword-query.ts   # CJK 1 字 = 1 token
grep -rnE "registerKeywordQueryRoute|keywordQuery" src/              # → 0（本轮未落地）
```

> 第 3/4/5 项的**精确口径**见 [02-宿主API参考.md](./02-宿主API参考.md) §3.2 / §7 / §6.1；
> 数量类断言唯一可信的方式是跑 `tests/unit/plugin.test.ts` 与 `tests/unit/routes.test.ts`，
> 而不是数 grep 行——grep 会把注释与字符串里的同形文本一起数进来。

## 版本

- 适用插件版本：`dsh-codegraph-visualizer@0.3.0` + `dsh-anic@0.61.0`
- **声明**的宿主范围：`>=0.2.0-rc.2 <0.4.0-0`（见 [01-插件开发规范.md](./01-插件开发规范.md) §2）
- **已验证**的运行宿主：`0.2.1-rc.3`（gen2 补丁；取证见 [09-破坏性变更与兼容策略.md](./09-破坏性变更与兼容策略.md) §2）
- ⚠️ 「声明范围」与「已验证版本」是两列事实，下限永远写 `0.2.0-rc.2`，不得写成已验证版本
- 文档族版本：`1.3.0`（cycle-111：新增 10/11 两份、05 新增 §6、09 新增 §9、02/03/04/07 刷新）
- cycle-110 的 `1.2.0` 记录（保留以便追溯）：新增 07/08/09、工具 10→11、路由 18→19、错误码口径 27→25
- ⚠️ **cycle-111 的数字口径**：路由仍是 **19**（`/query` 属 T3，未落地）、工具仍是 **11**（未增删）、
  组件 **49**、hooks **39**、CSS **19**、`AnalysisPanelKey` **18**（文档曾误写 17，本轮修正）。
  这些数字的复验命令见 §事实基座自检；**不要**从本节抄数字去写别处（本节只在改动时更新）。


## 更新日志（cycle-121/122 补充）

- **2026-11-08（cycle-147/148）**：生命周期工具缺陷跨仓修复——init-cycle 在归档收口态
  （全部循环已归档、活跃区合法为空）下编号回落 `cycle-1`，触发双后果：① 归档名碰撞
  （archive/cycle-1 已被古档占用 ⇒ archive-cycle 永久 BLOCKED）；② 状态机拒回拉
  （currentCycle 停在旧号）。修复位于 dsh-anic `getNextCycleNum`（活跃区+归档区+
  workflow-state 三源取最大；commit `5a93b53`），技能副本经 `anic_skill_repair` 同步
  （dualTrack in-sync）；6 场景行为测试 + dsh-anic 套件 20/20 绿。教训编码化：
  **归档收口态是合法状态，任何只扫活跃区的计数器都会在此时点归零**（与 gate-check
  cycleBaseDir 的归档回退同源教训）。沙箱验证机制复核：`sb-cgv-c1` profile
  （`link:` 挂载 + bundles 声明）启动即 MCP 4 工具注册、无 skipping 警告、崩溃隔离成立。
- **2026-10-31（cycle-121/122）**：03 号文档新增附3（会话工作区跟随：三态状态机、
  useSessionWorkspaceFollow/pinWorkspace API 面、桌面端自动生效查证）与附4（增量引擎
  健康信号：三层贯通链、显式缺席三分法、指纹豁免、XJ-13 防复活守卫、bench 基线）；
  04 号文档新增 §12 架构注记（默认工作区归属客户端会话 scope 的决策、写返回值必写
  消费面、coerce 修形不重造、指纹豁免判据）。
