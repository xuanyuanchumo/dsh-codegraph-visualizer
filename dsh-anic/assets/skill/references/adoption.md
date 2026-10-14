# 渐进式采用路径

> 采用顺序不是阶段顺序，而是依赖图顺序。从叶子节点开始，向外构建。

## 依赖图

```
第1层（叶子，无前置）    第2层              第3层            第4层          第5层
─────────────────       ─────────          ──────          ──────         ──────
意图捕获 ──────────→ Skills ──────────→ 需求与设计 ───→ CI/CD 集成 ──→ 闭环
CLAUDE.md ─────────→ Subagents ──────→ PR 评审 ─────→ 审批门禁 ────→ Agent Org
反馈循环 ──────────→ 连续 Evals ──────→
构建时 Hooks ───────→
计划模式 ───────────→
```

## 采用层级详解

### 第1层（叶子节点 — 无前置条件）

| Play | 内容 | 价值 |
|---|---|---|
| 意图捕获 | intent.md 模板 + 要求新工作使用 | 需求从周→小时 |
| CLAUDE.md | 一页仓库记忆，团队共享 | Agent 上下文一致性 |
| 反馈循环 | make test/build/lint 单命令，非零退出 | Agent 自验证 |
| 构建时 Hooks | 一个确定性 Hook——受保护路径/secrets/格式化 | 确定性护栏 |
| 计划模式 | 会话以计划模式启动，无已接受计划不实现 | 设计评审先于代码 |

**仅此层即可**：需求从周→小时，审计轨迹成为现实。

### 第2层

| Play | 前置 | 内容 |
|---|---|---|
| Skills | CLAUDE.md | 将制度知识编码为 Skills（安全/品牌/API 约定） |
| Subagents | CLAUDE.md + 反馈循环 | 重复工作转为命名 Subagent（verifier/researcher） |
| 连续 Evals | CLAUDE.md + 反馈循环 | 20-50 真实任务作为 eval 套件，CI 中运行 |

### 第3层

| Play | 前置 | 内容 |
|---|---|---|
| 需求与设计 | 意图捕获 + Skills | intent.md → spec.md 一个会话产出 |
| PR 评审 | Skills + Subagents | REVIEW.md + 双向评审 + 5-nit 上限 |

### 第4层

| Play | 前置 | 内容 |
|---|---|---|
| CI/CD 集成 | PR 评审 | Agent 在管道中非交互运行；写步骤在现有门后 |
| 审批门禁 | 构建时 Hooks | release gate + managed settings + 审批账本 |

### 第5层

| Play | 前置 | 内容 |
|---|---|---|
| 闭环 | CI/CD + 审批门禁 | bands.yaml + 检测脚本 + 1σ/2σ/3σ 响应 + 自动 intent.md |
| Agent Org | 全部 | 角色卡片 + 评审协议 + 准入渠道 + 升级规则 |

---

## 最小首次运行

1. 发布 intent.md 模板，要求新工作使用（意图捕获）
2. 创建一页 CLAUDE.md，保持在一页以内（仓库记忆）
3. 教反馈循环：build/test/lint 各一个命令，非零退出（反馈循环）
4. 添加一个确定性 Hook——受保护路径/secrets/release gate（构建时 Hooks）
5. 会话以计划模式启动（计划模式）

**仅此五步**即可将需求从周→小时，并使审计轨迹成为现实。

---

## 自主性 × 采用路径

| 自主级别 | 采用层 | 人类介入 |
|---|---|---|
| L1 辅助 | 第1层 | 每步 |
| L2 半自动 | 第2-3层 | 每产物 |
| L3 监督自主 | 第4层 | 仅检查点 |
| L4 全自主 | 第5层 | 仅事后审计 |

自主级别不是选择而是采用深度的自然结果——不需要一步到位。

---

## 框架映射

| 角色 | Claude Code | Codex |
|---|---|---|
| 仓库记忆 | CLAUDE.md | AGENTS.md |
| Skills | `.claude/skills/` | `~/.codex/skills/` |
| Subagents | `.claude/agents/*.md` | Codex subagent 配置 |
| Hook 配置 | `.claude/settings.json` + `.claude/hooks/` | Codex settings/hooks |
| 产物 | intent.md, spec.md, plan.md, REVIEW.md, bands.yaml | 相同文件 |

---

## 编码组织标准为 Skills

对必须一致应用的策略（品牌/安全/UX/API 设计），创建 Skill：
- 文件夹含 SKILL.md，frontmatter 说何时触发，body 说做什么
- 放在 `.claude/skills/<name>/` 随代码发布，或通过插件组织级分发
- 测试触发是否生效；策略负责人签字确认变更

**规则**：Skills 用于必须一致应用的制度知识；CLAUDE.md 用于工作知识；提示词用于一次性任务。

## 连接 Hooks

Hooks 是确定性后盾。决定哪些红线不可协商，用 platform/IT 拥有的 managed settings 执行，使个人无法关闭。

构建阶段：阻止受保护路径、自动格式化、排除 secrets。
门禁阶段：allow/ask/block；release gate 是典型的 ask。

## 真相源

对每个产物，指定一个系统为真相源：
- **仓库为真相源**：markdown 产物为权威记录；遗留系统引用提交内文件
- **遗留系统为真相源**：Jira/ServiceNow 为权威；Agent 通过 MCP 读写
- **链接为最低标准**：产物携带记录 ID，遗留记录携带提交 SHA

## 保留现有工具

保留 Jira/Figma/GitHub/Slack。此工作流改变的是流程，不是工具链。