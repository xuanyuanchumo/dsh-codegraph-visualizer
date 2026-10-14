# AI-Native Iteration Cycle

> 将 AI-Native SDLC（Plan→Design→Build→Test→Deploy→Maintain）与循环驱动验证流程深度融合，实现 AI 自主规划、评估、拆测、验证、修复、交付，人类在门禁处保留判断权。

## 概览

本 Skill 提供一套完整的 AI 驱动软件开发迭代循环框架，包含：

- **宏观循环**：六个阶段构成完整生命周期（Plan → Design → Build → Test → Deploy → Maintain）
- **微观迭代**：每个阶段内部以"评估→规划→拆测→验证→修复→门禁→复盘"七步循环驱动质量收敛
- **双层门禁**：人类判断门（意图/规格/计划/PR/发布）+ 自动化收敛门（G0-G3）
- **自主性分级**：L1 辅助 → L2 半自动 → L3 监督自主 → L4 全自主。核心原则：**不可直接降级/熔断**——遇到任何问题先进行问题评估研究找出根本原因并尝试修复完善优化，只有修复失败才考虑降级/熔断
- **多 Agent 门禁评估**：L4 模式下，每个人工门由3个不同角色的 AI agent 从不同维度独立评估，信任度≥70%且 `--auto-approve` 时自动根据推荐执行。PR 门和 Release 门要求 3/3 全部通过

## 快速开始

```bash
# 1. 初始化工作流骨架
node scripts/init-workflow.mjs <project-dir> --name "<项目名>"

# 2. 编辑项目配置
# 修改 .cycles/config.yml，填入 build/test/lint 命令、分层定义、用户旅程等

# 3. 初始化循环工作区
node scripts/init-cycle.mjs <project-dir>

# 4. 运行评估
node scripts/eval-runner.mjs <project-dir>

# 5. 检查门禁（判定结果自动入账本，FAIL 也记）
node scripts/gate-check.mjs <project-dir> --gate all --quality --record
```

## 目录结构

```
ai-native-iteration-cycle/
├── SKILL.md                         # 主 Skill 文件（触发入口）
├── README.md                        # 本文件
├── references/                      # 参考文档（按需加载）
│   ├── playbook.md                  # 六阶段完整操作手册
│   ├── principles.md                # 驱动原则（15硬规则+19红线）
│   ├── gates.md                     # 双层门禁判定标准
│   ├── autonomy.md                  # 自主性分级+熔断+Agent Org
│   ├── auto-cycle.md                # L4 全自主循环编排指南
│   ├── multi-agent-gate.md          # 多 Agent 门禁评估机制
│   ├── evaluation.md                # 评估维度+连续Evals+KPI
│   ├── quality-review.md            # Q1-Q8 质量评审体系
│   ├── state-transition.md          # 完整状态流转机制
│   ├── adoption.md                  # 渐进式采用路径
│   ├── graph.md                     # 有向图工程
│   ├── project-config.md            # 项目适配配置规范
│   ├── scripts-reference.md         # 脚本接口参考
│   └── troubleshooting.md           # 常见问题与故障排查
├── scripts/                         # 确定性脚本（16个）
│   ├── init-workflow.mjs            # 初始化工作流骨架
│   ├── init-cycle.mjs               # 初始化循环工作区
│   ├── gate-check.mjs               # G0-G3 门禁自动判定
│   ├── eval-runner.mjs              # E1-E8 + Q1-Q8 评估运行器
│   ├── band-detector.mjs            #1 复杂度控制带检测器
│   ├── workflow-state.mjs           # 工作流状态管理
│   ├── gate-ledger.mjs              # 哈希链门禁账本
│   ├── plan-sync-check.mjs          # 计划同步检查
│   ├── org-status.mjs               # Agent 组织状态管理
│   ├── fact-base-verify.mjs         # 事实基座抽验
│   ├── archive-cycle.mjs            # 循环归档管理
│   ├── hitl-audit.mjs               # H1-H4 HITL 自动审计
│   ├── auto-fix-loop.mjs            # 自动修复循环
│   ├── multi-agent-gate.mjs         # 多 Agent 门禁评估
│   ├── mcp-server.mjs               # MCP Server (v1.6.0)
│   └── quick-validate.mjs           # Skill 包自检
├── assets/                          # 资源文件
│   ├── templates/                   # 15个产物模板
│   ├── config/                      # 配置示例文件
│   └── hooks/                       # 3个 Git Hooks
└── evals/                           # 评估测试用例
    ├── evals.json
    └── trigger-eval.json
```

## 核心概念

### 宏观循环（6个阶段）

| 阶段 | 读取 | 产出 | 人类门 | 收敛门 |
|---|---|---|---|---|
| Plan | 用户想法 | intent.md | 接受→Design | G0 |
| Design | intent.md | spec.md | 批准→Build | G0 |
| Build | spec.md | plan.md → cycle-{N}/ → PR | 计划批准→代码 | G0-G3 |
| Test | 仓库+eval套件 | eval结果+回归evals | 配置变更降通过率须评审 | G2 |
| Deploy | 合并PR+评审 | 授权发布 | PR合并→Deploy | G3 |
| Maintain | 生产指标 | 诊断→新intent.md | 值班分诊 | 控制带触发 |

### 微观迭代（7步循环）

```
评估 → 规划 → 拆测 → 验证 → 修复 → 门禁 → 复盘
E1-E8  子规划  分层   测试报告  根因   G0-G3  量化指标
Q1-Q8          Q1-Q8        Q1-Q8  Q1-Q8
```

### 收敛门禁 G0-G3

| 门禁 | 名称 | 判定标准 | 质量维度 |
|---|---|---|---|
| G0 | 评估基线就绪 | 评估报告已产出；事实基座抽验通过 | Q1+Q5 |
| G1 | 任务清单清零 | P0-P3 全部任务已登记；无未分配测试用例 | Q7 |
| G2 | 测试报告零错误 | 失败=0、错误=0；旅程覆盖零缺口 | Q2 |
| G3 | 构建零失败 | Debug+Release 构建通过；冒烟与全量回归全通过 | Q3+Q4 |

### 自主性分级

| 级别 | 名称 | 特征 | 人类介入 |
|---|---|---|---|
| L1 | 辅助执行 | AI 按人类逐条指令执行 | 每步 |
| L2 | 半自动 | AI 自主执行，产物须人类审核 | 每产物 |
| L3 | 监督自主 | AI 自主决策并执行全流程 | 仅检查点 |
| L4 | 全自主 | AI 全流程自主，检查点自动审计化 | 仅事后审计 |

### 多 Agent 门禁评估（L4 模式）

每个人工门由 3 个不同角色的 AI agent 从不同维度独立评估，综合判定门禁是否应该通过。

| 人工门 | Agent 1 | Agent 2 | Agent 3 | 通过阈值 |
|---|---|---|---|---|
| intent 接受 | 产品经理(业务价值) | 架构师(技术可行性) | 评估者(需求完整性) | 2/3 |
| spec 批准 | 架构师(设计合理性) | 安全审查(安全合规) | 评估者(规格完整性) | 2/3 |
| plan 批准 | 工程师(实现可行性) | 评估者(测试覆盖) | 审查者(代码规范) | 2/3 |
| PR 合并 | 审查者(代码质量) | 安全审查(安全扫描) | 门禁守卫(G0-G3) | 3/3 |
| release 授权 | 门禁守卫(全门禁) | 安全审查(合规) | 评估者(性能基线) | 3/3 |

**信任梯度**：
- 全部通过(3/3)：高信任度，`--auto-approve` 时自动执行
- 多数通过(2/3)：中信任度，推荐执行但记录到审计日志
- 少数通过(<2/3)：低信任度，不推进，需人工审查
- 平均信任度≥70% 且 `--auto-approve`：自动根据推荐执行
- 平均信任度<70%：需人工审查，不自动执行

### L4 先修复后降级原则

L4 全自主模式下的最高优先级原则：**不可直接降级/熔断**。

1. **自动修复循环**（`auto-fix-loop.mjs`）：验证失败→失败模式分析→根因诊断→修复→重新验证，达到重试上限后先进行失败模式分析（重复性/级联性/瞬态），只有分析后仍无法修复才触发熔断
2. **HITL 自动审计**（`hitl-audit.mjs`）：H1-H4 检查点检测到问题时先尝试自动修复，修复后重新审计，只有仍失败才记录事故并建议回退
3. **熔断自动回退**（`org-status.mjs auto-fallback`）：检测到熔断条件后先诊断根因（Phase 1）→尝试自动修复（Phase 2）→只有修复失败才降级自主级别（Phase 3）

## MCP 集成

```bash
node scripts/mcp-server.mjs --project-dir <path>
```

MCP Tools (v1.6.0)：

| Tool | 说明 |
|---|---|
| `init_workflow` | 初始化工作流 |
| `init_cycle` | 初始化循环 |
| `gate_check` | G0-G3 门禁检查（含质量维度） |
| `eval_runner` | E1-E8 + Q1-Q8 评估运行 |
| `band_detector` | 复杂度控制带检测 |
| `workflow_state` | 工作流状态管理 |
| `gate_ledger` | 哈希链门禁账本 |
| `fact_base_verify` | 事实基座验证 |
| `plan_sync_check` | 计划同步检查 |
| `org_status` | Agent 组织状态（含 auto-fallback） |
| `quick_validate` | Skill 包自检 |
| `archive_cycle` | 循环归档管理 |
| `hitl_audit` | H1-H4 HITL 自动审计 |
| `auto_fix_loop` | 自动修复循环 |
| `multi_agent_gate` | 多 Agent 门禁评估 |

在 MCP 客户端配置中注册：
```json
{
  "mcpServers": {
    "iteration-cycle": {
      "command": "node",
      "args": ["<skill-path>/scripts/mcp-server.mjs", "--project-dir", "<project-path>"]
    }
  }
}
```

## 渐进式采用

采用顺序不是阶段顺序，而是依赖图顺序：

| 采用层 | 内容 | 前置条件 | 对应自主级别 |
|---|---|---|---|
| 第1层 | 意图捕获 + 仓库记忆 + 反馈循环 + Hooks + 计划模式 | 无 | L1 |
| 第2层 | Skills + Subagents + 连续 Evals | 第1层 | L2 |
| 第3层 | 需求与设计会话 + PR 评审 | 第2层 | L2 |
| 第4层 | CI/CD 集成 + 审批门禁 | 第3层 | L3 |
| 第5层 | 闭环（监控→新意图）+ Agent Org + 多Agent门禁 | 第4层 | L4 |

## 框架兼容性

本 Skill 框架无关。Claude Code 的仓库记忆文件为 `CLAUDE.md`，Codex 的为 `AGENTS.md`。产物（intent.md, spec.md, plan.md 等）框架无关。

## 版本

v1.6.0 — 强化 L4 先修复后降级原则（不可直接降级/熔断）；增强多 Agent 门禁评估深度（每个 Agent 增加核心要素检查）；完善失败模式分析（重复性/级联性/瞬态分类）；增强 `--auto-approve` 自动执行逻辑；统一各文档熔断条件描述；修复 `analyzeFailurePattern` 级联失败判定精度（需至少一种类型出现≥2次）；修复 `multi-agent-gate.mjs` 变量遮蔽、plan.md 路径兼容、`getPassedGates` 去重逻辑；修复 `org-status.mjs` 跨平台文件删除（`unlinkSync` 替代 `del`）、精确失败判定（状态行匹配替代 `includes('FAIL')`）；修复 `mcp-server.mjs` 版本号统一为 v1.6.0、`org_status` 命令增加 `auto-fallback` 选项