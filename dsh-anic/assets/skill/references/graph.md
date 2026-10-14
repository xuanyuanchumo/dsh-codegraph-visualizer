# 有向图工程

> AI-Native SDLC 是有向图，不是线性管道。将工作流视为图使其可自动化、可并行、可审计。

## 节点类型

- **Plays** — 工作单元：捕获意图、需求与设计、计划模式、构建、连续 Evals、PR 评审、Hooks、CI/CD、闭环
- **Artifacts** — 每个 Play 产出的提交证据：intent.md, spec.md, plan.md, diff+tests, PR+评审发现, 事故记录
- **Gates** — 人类判断点：接受/批准/驳回。门是自动化永远不可跳过的唯一节点
- **Triggers** — 门通过时触发下一个 Play 的有向边：接受的意图触发 Design；批准的规格触发计划模式；合并的 PR 触发管道；突破的控制带写入新 intent.md

## 运行时循环

```
intent.md → (接受) → spec.md → (批准) → plan.md → (批准) → 代码+测试 → (PR合并) → release → (授权) → 监控 → (控制带突破) → 新 intent.md → 回到起点
```

机器可读形式在 `assets/config/workflow-graph.example.yaml`。

## 运行图

`scripts/workflow-state.mjs` 将 `workflow-graph.yaml` 视为实时状态机，`gates/ledger.jsonl` 视为审批历史：

```bash
# 什么在进行中、什么被阻塞、什么接下来触发
node scripts/workflow-state.mjs status

# 仅通过匹配的、链验证的账本记录关闭门
node scripts/gate-ledger.mjs record --gate product_owner_accept --artifact intent/intent.md --commit abc123 --approver "Ada" --evidence "intent review"
node scripts/workflow-state.mjs advance --node intent --record product_owner_accept-001

# 漂移和模式验证
node scripts/workflow-state.mjs check --strict
```

图节点携带 `status`（工作状态）+ 可选 `done_status`（关闭节点的终态）。`advance` 拒绝门不匹配的记录、重新推进已完成节点、或无批准触发边；不自动启动下游节点。

## 采用图

Plays 也形成依赖图用于采用，与运行时顺序分离。从叶子 Play 开始——没有指向它的边：意图捕获、CLAUDE.md、反馈循环、构建时 Hooks、计划模式。然后采用依赖它们的 Plays。

## 为什么图工程重要

- **自动化**：每个接受的产物机械地触发下一个门。最终状态是一个没有人手动启动阶段的循环
- **并行性**：图的独立分支在单独 worktree 中并行运行；图显示工作可以在哪里拆分和在哪里必须在门前合并
- **审计**：节点历史即记录——每个产物提交、门决策和触发可归属到人或运行
- **可观测性**：图的当前状态——什么在进行中、什么在哪个门被阻塞——是团队对管道的共享视图

## 护栏

- 边可以自动化到门为止的一切；门本身保持人类
- 生产门对 Agent 是终端的：发布授权是 Hook 强制的边，不是建议性的
- 编码图用于自动化时，保持门节点显式，并将图与产物一起版本化
- Subagent 和会话节点遵循与 Plays 相同的规则：功能性命名、对开发者可见、有界、证据报告

## 工作流图配置示例

```yaml
# workflow-graph.yaml
nodes:
  - id: intent
    type: play
    produces: intent.md
    gate: product_owner_accept
    done_status: accepted
    triggers: [design]

  - id: design
    type: play
    reads: [intent.md]
    produces: spec.md
    gate: spec_approve
    done_status: approved
    triggers: [build]

  - id: build
    type: play
    reads: [intent.md, spec.md]
    produces: [plan.md, code, tests]
    gate: plan_approve
    done_status: planned
    sub_gate: pr_merge
    sub_done_status: merged
    triggers: [deploy]

  - id: deploy
    type: play
    reads: [merged_pr, review_findings]
    produces: release
    gate: release_authorize
    done_status: authorized
    triggers: [maintain]

  - id: maintain
    type: play
    reads: [production_metrics]
    produces: diagnosis
    gate: oncall_triage
    done_status: triaged
    triggers: [intent]  # 闭环回到起点

gates:
  - id: product_owner_accept
    type: human
    role: product_owner

  - id: spec_approve
    type: human
    role: product_owner
    consult: tech_lead

  - id: plan_approve
    type: human
    role: engineer

  - id: pr_merge
    type: human
    role: code_owner

  - id: release_authorize
    type: human
    role: release_manager
    hook: production-gate.sh

  - id: oncall_triage
    type: human
    role: oncall_engineer
```