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
| [01-插件开发规范.md](./01-插件开发规范.md) | 写代码必须遵守什么？宿主版本怎么承诺？清单怎么声明？ | 动手改任何文件**之前** |
| [02-宿主API参考.md](./02-宿主API参考.md) | 宿主侧能用哪些 Context 服务？18 条路由、8 个 tool、27 个错误码长什么样？ | 改 `src/host/**` 或 `src/index.ts` 时 |
| [03-客户端API参考.md](./03-客户端API参考.md) | 客户端怎么注册标签页？store 有哪些字段？hooks / i18n / CSS 怎么用？ | 改 `src/client/**` 时 |
| [04-架构设计.md](./04-架构设计.md) | 分层怎么切的？数据怎么流的？为什么这么决策？ | 做结构性改动、评审设计时 |
| [05-DSH官方规范检索证据.md](./05-DSH官方规范检索证据.md) | 我们对 DSH 契约的每条断言，官方依据（带来源 URL）在哪？ | 引用宿主契约、抬版本窗、判断某个服务是否真实存在时 |

## 与既有文档的关系（避免重复，各司其职）

| 文档 | 定位 | 不要在这里找 |
|---|---|---|
| `CLAUDE.md` | 命令速查 + 事故教训清单（R10 编码化） | 完整 API 签名 |
| `docs/agents/*`（本目录） | 规范 / API / 设计三件套 | 需求原文、测试用例清单 |
| `docs/需求分析.md` | 需求与缺陷分析全集（341 KB，含 §59.x 系列） | 快速上手 |
| `docs/测试体系.md` | 七层测试策略与覆盖矩阵 | 架构说明 |
| `docs/用户旅程.md` | J1–J44 用户旅程定义 | 实现细节 |
| `docs/anic/*` | **另一个独立工程** `dsh-anic/` 的设计文档 | 本插件的 API |
| `docs/research/dsh-多代API规范差异与兼容矩阵.md` | 多代 API 差异与兼容矩阵（行级证据） | 快速上手 |

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

## 事实基座自检

本目录引用的事实可用以下命令抽验（`fact-base-verify` 只扫评估报告，故这里手写）：

```bash
# 1) 目录与文件存在性
ls docs/agents/
# 2) 关键行号是否仍然指向声称的内容
grep -n "export const inject" src/index.ts
grep -n "export const inject" src/client/index.ts
grep -n "DSH_SUPPORTED_RANGE" src/shared/dshGeneration.ts
grep -n "manifestVersion" package.json
# 3) 路由数量（应为 18 个 register*Route 调用）
grep -c "register.*Route(" src/host/routes.ts
# 4) tool 数量（应为 8 个 defineTool）
grep -c "defineTool(" src/tools.ts
# 5) 错误码数量（应为 27）
grep -c "^  [A-Z_]*:" src/shared/constants.ts
```

## 版本

- 适用插件版本：`dsh-codegraph-visualizer@0.2.0`
- 适用 DSH 宿主：`>=0.2.0-rc.2 <0.4.0`（见 [01-插件开发规范.md](./01-插件开发规范.md) §2）
- 文档族版本：`1.0.0`（cycle-92 首次落地）
