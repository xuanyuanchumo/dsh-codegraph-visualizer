# Agent 资产卡索引

15 张出厂角色卡（5 门 × 3 角色），加载即 schema 校验（`host/agents.ts` validateAgentCard）。

## 字段契约（8 字段闭合 schema，INV-19）

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | `anic.agent.{gate}.{role}` |
| `role` | enum | `planner` / `implementer` / `reviewer` |
| `gate` | enum | `intent` / `spec` / `plan` / `pr` / `release` |
| `systemPrompt` | string | ≥20 字符；内嵌闭合 JSON 输出协议 + evidenceIds 禁编造 + doubt 语义 |
| `toolsAllowlist` | string[] | 每项匹配 `/^anic_[a-z][a-z0-9_]*$/`（M1=[]，M2-a 接 ToolRegistry 存在性校验） |
| `autonomyBand` | enum | `L1` / `L2` / `L3` / `L4`（出厂默认 L2） |
| `outputContract` | string | ≥10 字符；闭合 JSON {verdict, evidenceIds, notes} + INV-23 引用 |
| `escalation` | string | ≥5 字符；升级人类门条件（按角色三分） |

## 卡片清单

| 文件 | 门 | 角色 | 升级条件 |
|---|---|---|---|
| intent-planner.json | 意图门 | 规划者 | 未消解歧义或证据缺口 |
| intent-implementer.json | 意图门 | 实现者 | 连续 2 轮修复失败或破坏性操作 |
| intent-reviewer.json | 意图门 | 评审者 | verdict=reject 或 doubt |
| spec-planner.json | 规格门 | 规划者 | 同上 |
| spec-implementer.json | 规格门 | 实现者 | 同上 |
| spec-reviewer.json | 规格门 | 评审者 | 同上 |
| plan-planner.json | 计划门 | 规划者 | 同上 |
| plan-implementer.json | 计划门 | 实现者 | 同上 |
| plan-reviewer.json | 计划门 | 评审者 | 同上 |
| pr-planner.json | PR 门 | 规划者 | 同上 |
| pr-implementer.json | PR 门 | 实现者 | 同上 |
| pr-reviewer.json | PR 门 | 评审者 | 同上 |
| release-planner.json | 发布门 | 规划者 | 同上 |
| release-implementer.json | 发布门 | 实现者 | 同上 |
| release-reviewer.json | 发布门 | 评审者 | 同上 |

## 覆盖机制

工作区可在 `.cycles/agents/` 放同名文件覆盖出厂卡（加载顺序：出厂 → 工作区，后者胜）。
重复 `id` 拒绝装载（S-11 语义：拒绝部分可用）。
