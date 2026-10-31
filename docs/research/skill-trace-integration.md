# 技能插件轨迹集成研究：dsh-agent 如何调用本插件（cycle-120 / T3）

> 任务来源：objective #3「DSH 大模型使用时 dsh 的轨迹要有本技能插件的调用（结合 dsh 的规范思考如何调用技能插件的能力）」。
> 证据基线：`src/host/skills.ts`（本插件已有实现）、`tests/unit/hostSkillContribution.test.ts`（13 例契约）、
> dsh-plugin-dev-kb 知识库（`site/reference/subsystems/skills.md`）、本仓 cycle-114 的
> LLM 轨迹取证（`.cycles/cycles/cycle-114/llm-trajectory-evidence.json`）。
> 结论先行：**「轨迹里有本插件的调用」在本仓已经全链路成立**——本文档把链路逐环摆出来，
> 指出唯一剩下的改进方向（触发率的可观测），并否决两个看似相关的伪需求。

## 一、链路全景：一次模型调用如何出现在轨迹里

```
模型回合
  → DSH 宿主把工具目录（含本插件 11 个 graph_* 工具 + 1 条 runtime skill）注入 prompt
  → 模型决定调用 graph_query（触发依据 = skill 正文的选择表 + 工具 description）
  → 宿主经 cordis 调 defineTool 的 execute → presentCall 写进轨迹（调用卡片）
  → execute 返回 → presentResult 写进轨迹（结果卡片）
  → DSH 会话日志（session.v4.jsonl.zstd）落盘全部帧
```

逐环的现状证据：

| 环节 | 现状 | 证据 |
|---|---|---|
| 工具注册 | 11 个 `graph_*` 全部经 `ctx.tools.register`（`src/index.ts:53-66`），「工厂返回集合 == 入口注册集合」双向契约 | `tests/unit/tools.test.ts` 注册一致性用例 |
| 工具描述（模型可见） | 每个工具 `defineTool({ name, description, parameters, presentCall, presentResult })` | `src/tools.ts` |
| Skill 指令（触发依据） | `contributeGraphSkill` 经响应式 `ctx.inject(['skills'], …)` 注册 `codegraph-visualizer` 运行时 skill；`registered` 布尔可断言 | `src/host/skills.ts:124`；`tests/unit/hostSkillContribution.test.ts`（13 例，含「content 提到每一个工具名」防空扫） |
| 轨迹落盘 | `presentCall`/`presentResult` 的输出进 DSH 会话日志 | cycle-114 实测：对 dsh-anic 会话日志逐帧解码，71 次工具调用中 graph_* 命中 11 个工具名（`llm-trajectory-evidence.json`） |
| 重复注册安全 | `ctx.skills.register` 同层 first-wins + no-op disposer，不抛错 | kb `skills.md:299`；`skills.ts` 头注释 |

## 二、「轨迹要有调用」的三个可观测层次（已达成度）

| 层次 | 判据 | 达成 |
|---|---|---|
| L1 可注册 | skill 注册成功、工具在目录 | ✅ `hostSkillContribution` 13 例 + tools 注册一致性 |
| L2 可触发 | 模型在合适场景**选择**调用 | ⚠️ 机制已具备（skill 正文的选择表）；**触发率不可观测**——没有「模型看到了 skill 但没调用」的信号 |
| L3 可审计 | 会话日志可取证、调用卡片完整 | ✅ cycle-114 方法论（zstd 多帧解码）已沉淀；`presentCall` 卡片带 rawInput |

**本轮改进（L2 → 可观测）**：`SKILL_CONTENT` 的过期否定句（「要权重排序…当前不支持」）
会让模型在「需要按权重取路径」的场景**放弃**`truncation` 参数——这是触发率损耗的实锤。
已更新正文（top-k-weight 用法 + confidence 值域 + 退化行为）并加防过期守卫
（`hostSkillContribution.test.ts` 第 14 例：`top-k-weight` 必须在正文、否定句必须消失）。

## 三、否决的两个伪需求（写下来防止下轮重提）

1. **「让 DSH agent 主动跑本插件的测试/构建」**——那是 dsh-anic 的事（`.cycles/` 工件 +
   `ai-native-iteration-cycle` skill），不是本插件的 Skill 面。混进 SKILL_CONTENT 会让
   「查询图」的指令密度被稀释（agent-experience 原则：一条 skill 一个意图）。
2. **「注册更多 skill 提高曝光」**——`ctx.skills.register` 同层 first-wins，且 runtime 层
   本就排最后；多注册只会增加 prompt 占用，不会提高触发率。触发率的上限因素是
   **正文质量**（触发条件是否与用户的真实问法对齐），不是条目数量。

## 四、后续可选方向（登记，不实施）

- **触发率量化**：在 `presentCall` 的 rawInput 里已有 `from/to/q` 等参数；若要量化「skill
  触发后 N 回合内的工具调用率」，需要读 DSH 会话日志（zstd 多帧解码已在 cycle-114 沉淀）
  做离线统计——属于 `dsh-anic` 侧的度量，不是本插件运行时职责。
- **Skill 正文 i18n**：当前正文是中文（DSH 默认模型中文语料充足）；若未来出现英文宿主
  profile，按 `agent-experience` 的「触发条件对齐用户问法语言」原则出英文版。

## 五、复现命令

```bash
# skill 契约 13 例（含防过期守卫）
npx vitest run tests/unit/hostSkillContribution.test.ts
# 正文内容直读
sed -n '60,110p' src/host/skills.ts
# 轨迹取证方法（cycle-114 沉淀）
cat .cycles/cycles/cycle-114/llm-trajectory-evidence.json | head -20
```
