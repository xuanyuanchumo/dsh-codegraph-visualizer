# 脚本接口参考

> 所有脚本的输入参数、输出格式、退出码含义。
> 读取本文件的时机：需要调用脚本或理解脚本输出时。

## scripts/init-workflow.mjs

**用途**：初始化 AI-Native Iteration Cycle 工作流骨架

**输入参数**：
```
node scripts/init-workflow.mjs <project-dir> --name "<项目名>" [--framework claude|codex] [--git] [--dry-run]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--name` | 是 | 项目名称 |
| `--framework` | 否 | 框架类型，默认 claude |
| `--git` | 否 | 初始化 git 仓库 |
| `--dry-run` | 否 | 仅打印不执行 |

**输出**：
- 创建目录：`.cycles/intent/`, `.cycles/cycles/`, `.cycles/retrospectives/`, `.cycles/tech-debt/`, `.cycles/evals/`, `.cycles/gates/`, `.cycles/incidents/`
- 复制文件：`.cycles/intent/intent.md`, `.cycles/REVIEW.md`, `.cycles/config.yml`, `.cycles/workflow-graph.yaml`
- 创建仓库记忆文件：`CLAUDE.md`（或 `AGENTS.md`）

**退出码**：0=成功, 1=参数错误

---

## scripts/init-cycle.mjs

**用途**：初始化循环工作区 cycle-{N}/

**输入参数**：
```
node scripts/init-cycle.mjs <project-dir> [--cycle N]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--cycle` | 否 | 指定循环编号，默认自动递增 |

**输出**：
- 创建目录：`.cycles/cycles/cycle-{N}/subplans/`, `.cycles/cycles/cycle-{N}/test-reports/`
- 复制模板（7 个，v1.8.0 修正：旧文档只列 5 个）：项目评估报告.md, 当前循环总规划.md, 任务清单.md, 当前循环页面状态.md, 审计日志.md, 交付清单.md, 非功能验证报告.md

**退出码**：0=成功, 1=参数错误

---

## scripts/gate-check.mjs

**用途**：G0-G3 收敛门禁自动判定

**输入参数**：
```
node scripts/gate-check.mjs <project-dir> [--gate G0|G1|G2|G3|all] [--record]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--gate` | 否 | 指定门禁，默认 all |
| `--record` | 否 | 把每次判定结果写入账本（v1.8.0）：同门最新 result+detail 相同则去重（`unchanged, not re-recorded`）；**FAIL 也记录**（org-status 熔断条件 CB2 依赖账本中的 FAIL 记录） |

**输出格式**：
```
[PASS|FAIL] G0: <详情>
[PASS|FAIL] G1: <详情>
[PASS|FAIL] G2: <详情>
[PASS|FAIL] G3: <详情>

All gates PASSED. / Gate check FAILED. Fix issues before proceeding.
```

**退出码**：0=全部通过, 1=有门禁未通过

**门禁判定逻辑**：
- G0：检查最新 cycle 目录下是否有评估报告
- G1：检查任务清单中是否有"待办"或"进行中"项
- G2：检查测试报告中失败=0、错误=0
- G3：执行 `.cycles/config.yml` 中的 `build_cmd`

---

## scripts/fact-base-verify.mjs

**用途**：验证文档引用的路径/命令在仓库真实存在

**输入参数**：
```
node scripts/fact-base-verify.mjs <project-dir> [--count N]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--count` | 否 | 抽验数量，默认 5 |

**输出格式**：
```
Fact-base verification: X/Y passed
  [PASS] path: <文件路径> (OK)
  [FAIL] path: <文件路径> (NOT FOUND)
  [PASS] command: <命令> (OK)
  [FAIL] command: <命令> (COMMAND FAILED)
```

**退出码**：0=全部通过, 1=有引用不存在

---

## scripts/eval-runner.mjs

**用途**：E1-E8 评估维度运行器

**输入参数**：
```
node scripts/eval-runner.mjs <project-dir> [--dimensions E1,E2,...] [--cycle N]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--dimensions` | 否 | 指定维度（逗号分隔），默认 all |
| `--cycle` | 否 | 指定循环编号，默认最新 |

**输出**：
- 评估报告写入 `.cycles/cycles/cycle-{N}/项目评估报告.md`
- 控制台输出维度通过/失败摘要

**退出码**：0=全部通过, 1=有维度未通过

---

## scripts/band-detector.mjs

**用途**：复杂度预算/控制带检测器，基于 Western Electric 规则的统计过程控制

**输入参数**：
```
node scripts/band-detector.mjs <project-dir> [--threshold 0.15] [--history N]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--threshold` | 否 | 预算波动容忍阈值，默认 0.15 |
| `--history` | 否 | 历史快照分析数量，默认 10 |

**输出格式**：
```
Complexity Band Detection Report
  Total complexity score: <N>
  Average per file: <N>
  Budget: <N> | Upper band: <N> | Lower band: <N>
  Status: OK|WARNING|OVER_BUDGET
  History snapshots: <N>
  Statistical Control:
    Mean: <N> | StdDev: <N>
    1σ: [<low>, <high>]
    2σ: [<low>, <high>]
    3σ: [<low>, <high>]

WESTERN ELECTRIC RULE VIOLATIONS (N):
  Rule <N>: <描述> (at snapshot #<N>, value=<N>)

OVER BUDGET (N files):
  [score] <file> (branches: N, functions: N)

COMPLEXITY HOTSPOTS (top N):
  [score] <file> (branches: N, functions: N)
```

**Western Electric 规则**：
| 规则 | 描述 |
|---|---|
| Rule 1 | 单点超出 3σ 控制带 |
| Rule 2 | 连续 2/3 点在同侧 2σ 外 |
| Rule 3 | 连续 4/5 点在同侧 1σ 外 |
| Rule 4 | 连续 8 点在中心线同侧 |
| Rule 5 | 连续 6 点持续递增或递减 |
| Rule 6 | 连续 14 点交替上下 |
| Rule 7 | 连续 15 点在 1σ 内（变异过小） |
| Rule 8 | 连续 8 点在 1σ 外（变异过大） |

**历史持久化**：每次运行将快照保存到 `.cycles/band-history.json`，最多保留 50 条。

**退出码**：0=在预算内且无统计违规, 1=超出预算或有 Western Electric 违规

---

## scripts/workflow-state.mjs

**用途**：工作流图运行时，支持 status/advance/check 三个子命令

**输入参数**：
```
node scripts/workflow-state.mjs <project-dir> status
node scripts/workflow-state.mjs <project-dir> advance [--node <phase-id>]
node scripts/workflow-state.mjs <project-dir> check
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `status` | 是 | 显示当前循环/阶段/门禁/产物状态 |
| `advance` | 是 | 推进到下一阶段（需当前阶段门禁通过） |
| `check` | 是 | 检查是否可以推进到下一阶段 |
| `--node` | 否 | advance 时指定目标阶段（plan/design/build/test/deploy/maintain） |

**状态持久化**：`.cycles/workflow-state.json`，记录 currentPhase、currentCycle、phaseHistory。

**输出（status）**：
```
=== AI-Native Iteration Cycle Workflow State ===
Current Cycle: cycle-{N}
Current Phase: <阶段名> (<phase-id>)
  Artifacts: [x]/[ ] eval/plan/tasks/pageState/audit/testReports
Phase Progress:
   [x] Plan（规划）  >>> Build（构建）  [ ] Deploy（部署）
Gates:
  Passed: N (G0, G1)
  Failed: N
```

**输出（advance）**：
```
Advanced from <当前阶段> to <下一阶段>.
  Next gates to pass: G1
```
门禁未通过时拒绝推进并报错。

**输出（check）**：
```
Workflow Check Report
  Current phase: <阶段名>
  Inferred phase: <阶段名>
  [PASS|FAIL|PENDING|WARN] <gate>: <message>
```

**退出码**：0=成功/可推进, 1=不可推进/参数错误

---

## scripts/gate-ledger.mjs

**用途**：哈希链门禁账本（tamper-evident hash-chained ledger），支持 record/verify/list 三种模式

**输入参数**：
```
node scripts/gate-ledger.mjs <project-dir> --gate G0|G1|G2|G3 --result PASS|FAIL [--detail "..."]
node scripts/gate-ledger.mjs <project-dir> --verify
node scripts/gate-ledger.mjs <project-dir> --list
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--gate` | record 模式必填 | 门禁编号 |
| `--result` | record 模式必填 | PASS 或 FAIL |
| `--detail` | 否 | 详情描述 |
| `--verify` | 是（验证模式） | 验证账本哈希链完整性 |
| `--list` | 是（列表模式） | 列出所有账本条目 |

**哈希链机制**：
- 每条记录包含 `previousHash`（指向前一条的 hash）和 `hash`（自身内容的 SHA-256）
- 首条记录的 `previousHash` 为 `null`（GENESIS）
- `--verify` 模式重新计算每条记录的 hash 并与链比对，检测篡改

**存储**：`.cycles/gates/ledger.json`（JSON 格式，替代旧的 markdown 索引）

**输出（record）**：
```
Gate G0 PASS recorded.
  Hash: c2e7c9e5eeaf7c18...
  Previous: GENESIS | <hash>...
  Timestamp: <ISO>
```

**输出（verify）**：
```
Gate Ledger Verification
  Total entries: N
  Valid: YES|NO
  Issues (N):
    [CHAIN_BREAK|HASH_MISMATCH|HEAD_MISMATCH] <描述>
```

**输出（list）**：
```
Gate Ledger (N entries):
  [timestamp] G0 评估收敛门 — PASS
    hash: <hash>...
    detail: <详情>
```

**退出码**：0=成功/验证通过, 1=参数错误/验证失败

---

## scripts/plan-sync-check.mjs

**用途**：确定性计划同步检查，基于 git diff 检测计划与代码的同步状态

**输入参数**：
```
node scripts/plan-sync-check.mjs <project-dir> [--verbose]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--verbose` | 否 | 显示未在计划中引用的 git 变更文件 |

**检查逻辑**：
1. 扫描 `.cycles/intent/` 和 `.cycles/cycles/cycle-{N}/` 下的计划文档
2. 提取计划中引用的文件路径和命令
3. 验证引用的文件是否存在（git tracked 或文件系统）
4. 验证引用的命令是否可用
5. `--verbose` 时额外检查 git 变更文件是否在计划中引用（检测计划外变更）

**输出格式**：
```
Plan-Sync Check Report
  Plan files scanned: N
  Referenced files: N
  Referenced commands: N
  Git changed files: N
  Issues found: N

ERRORS (N):
  [ERROR] <file|command> (referenced in: <source>)

WARNINGS (N):
  [WARN] <file> (referenced in: <source>)

UNPLANNED CHANGES (N):    # 仅 --verbose
  [INFO] <file> (changed but not referenced in plan)
```

**退出码**：0=全部同步, 1=有 ERROR 级别不同步项

---

## scripts/org-status.mjs

**用途**：Agent 组织状态管理 CLI，支持 status/agent/review/auto-fallback 四个子命令

**输入参数**：
```
node scripts/org-status.mjs <project-dir> status
node scripts/org-status.mjs <project-dir> agent [--role <role>] [--assign <model>]
node scripts/org-status.mjs <project-dir> review
node scripts/org-status.mjs <project-dir> auto-fallback
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `status` | 是 | 显示自主级别、熔断器、角色分配 |
| `agent` | 是 | 查看或修改 Agent 角色分配 |
| `review` | 是 | 生成循环评审摘要 |
| `auto-fallback` | 是 | 检测熔断条件并自动降级自主级别 |
| `--role` | 否 | agent 模式下指定角色 |
| `--assign` | 否 | agent 模式下指定模型 |

**输出（status）**：
```
=== Agent Organization Status ===
Autonomy Level: L2 — 协作模式
Circuit Breaker: OK|TRIPPED (N/3)
Agent Roles:
  编排者 (orchestrator): <model|unassigned>
  构建者 (builder): <model|unassigned>
  审查者 (reviewer): <model|unassigned>
  评估者 (evaluator): <model|unassigned>
  门禁守卫 (gatekeeper): <model|unassigned>
```

**输出（auto-fallback）**：
```
=== Auto-Fallback Assessment ===
Current Autonomy Level: L4
Circuit Breaker State: OK (0/3)

  [OK] CB1: 同一异常连续3次自动修复失败
  [TRIGGERED] CB2: 门禁自动判定存疑且无法自动定论
    Detail: 2 ambiguous gate results

  Phase 1: Diagnosing root cause...
    Root cause: Gate evaluation logic ambiguous for G2
  Phase 2: Attempting auto-fix...
    Fix: Updated gate evaluation criteria in config.yml
    Re-checking after fix...
    Fix successful. CB2 resolved.
  Phase 3: No downgrade needed.

Auto-fallback completed. Autonomy level maintained: L4
```

**先修复后降级机制**：
- Phase 1：诊断根因（分析熔断条件的根本原因）
- Phase 2：尝试自动修复（根据根因诊断结果尝试修复）
- Phase 3：只有修复失败才降级自主级别

**熔断条件（8个）**：
| 条件 | 说明 |
|---|---|
| CB1 | 同一异常连续3次自动修复失败 |
| CB2 | 门禁自动判定存疑且无法自动定论 |
| CB3 | 涉及真实用户数据/明文凭据且无隔离方案 |
| CB4 | 破坏性操作影响范围不可评估或不可回滚 |
| CB5 | 性能指标超预警阈值且1轮优化后仍未恢复 |
| CB6 | 人类主动要求审计/切换到L3 |
| CB7 | 无人值守超时/资源上限 |
| CB8 | 自动化资源上限（累计重试>10次或熔断>3次） |

**退出码**：0=成功/无熔断, 1=参数错误, 2=熔断触发并已降级

---

## scripts/quick-validate.mjs

**用途**：自检脚本，验证 skill 包完整性

**输入参数**：
```
node scripts/quick-validate.mjs <skill-dir>
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<skill-dir>` | 是 | Skill 包根目录路径 |

**检查内容**：
- 必需文件：`SKILL.md`
- 必需目录：`references/`, `assets/`, `scripts/`, `evals/`
- 预期 references（10个文档）
- 预期 scripts（12个脚本，含 shebang 和内容检查）
- 预期 assets 子目录：`templates/`, `config/`, `hooks/`
- evals JSON 文件格式验证
- SKILL.md 内容长度和格式检查

**输出格式**：
```
=== Skill Package Validation ===
Total files: N
Total size: X KB

ERRORS (N):
  [ERROR] <描述>

WARNINGS (N):
  [WARN] <描述>

INFO (N):
  [OK] <描述>

VALIDATION PASSED|FAILED.
```

**退出码**：0=验证通过, 1=有 ERROR

---

## scripts/mcp-server.mjs

**用途**：MCP Server，将所有确定性脚本暴露为 MCP tools

**启动**：
```
node scripts/mcp-server.mjs [--project-dir <path>]
```

**MCP Tools (v1.5.0)**：

| Tool | 说明 | 关键参数 |
|---|---|---|
| `init_workflow` | 初始化工作流 | `project_name`, `framework` |
| `init_cycle` | 初始化循环 | `cycle_number` |
| `gate_check` | 门禁检查 | `gate` (G0-G3/all), `quality` |
| `eval_runner` | 评估运行 | `dimensions`, `cycle`, `quality` |
| `band_detector` | 控制带检测 | `threshold`, `history` |
| `workflow_state` | 工作流状态 | `command` (status/advance/check), `node` |
| `gate_ledger` | 门禁账本 | `mode` (record/verify/list), `gate`, `result`, `detail` |
| `fact_base_verify` | 事实基座验证 | `count` |
| `plan_sync_check` | 计划同步检查 | `verbose` |
| `org_status` | Agent 组织状态 | `command` (status/agent/review/auto-fallback), `role`, `assign` |
| `quick_validate` | Skill 包自检 | — |
| `archive_cycle` | 循环归档管理 | `command` (archive/clean/list), `cycle`, `keep` |
| `hitl_audit` | H1-H4 自动审计 | `gate` (H1-H4/all) |
| `auto_fix_loop` | 自动修复循环 | `max_retries`, `test_cmd` |
| `multi_agent_gate` | 多 Agent 门禁评估 | `gate` (intent/spec/plan/pr/release/all) |

---

## scripts/archive-cycle.mjs

**用途**：循环归档管理——将已完成循环移到归档目录、清理旧归档、列出循环清单

**输入参数**：
```
node scripts/archive-cycle.mjs <project-dir> --cycle <N>
node scripts/archive-cycle.mjs <project-dir> --clean [--keep <N>]
node scripts/archive-cycle.mjs <project-dir> --list
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--cycle` | archive 模式必填 | 要归档的循环编号 |
| `--clean` | 是（清理模式） | 清理旧归档，保留最近 N 个 |
| `--keep` | 否 | clean 模式保留数量，默认 5 |
| `--list` | 是（列表模式） | 列出所有活跃和归档循环 |

**归档条件**：循环的任务清单中无"待办"或"进行中"项才可归档。

**归档操作**：将 `.cycles/cycles/cycle-{N}/` 移动到 `.cycles/archive/cycle-{N}/`。

**输出（list）**：
```
=== Cycle Inventory ===
Active Cycles (N):
  cycle-1 [in-progress]
  cycle-2 [complete]

Archived Cycles (N):
  cycle-1 [archived 2026-09-17]
```

**退出码**：0=成功, 1=参数错误/循环未完成

---

## assets/hooks/production-gate.sh

**用途**：生产门禁 Hook，在部署前强制执行 G0-G3 全部门禁检查

**调用方式**：
```bash
bash assets/hooks/production-gate.sh <project-dir>
```

**退出码**：0=通过, 1=门禁失败

---

## assets/hooks/plan-sync-check.sh

**用途**：计划同步检查 Hook，在 commit 前验证计划文档与代码库一致

**调用方式**：
```bash
bash assets/hooks/plan-sync-check.sh <project-dir>
```

**退出码**：0=同步, 1=不同步

---

## assets/hooks/test-protection.sh

**用途**：测试保护 Hook，防止在测试失败时提交代码

**调用方式**：
```bash
bash assets/hooks/test-protection.sh <project-dir>
```

**退出码**：0=测试通过, 1=测试失败

---

## assets/config/hook-settings.example.json

**用途**：Hook 配置示例，展示如何在项目中配置 pre-commit、pre-push、post-merge hooks

**结构**：
```json
{
  "hooks": {
    "pre-commit": { "command": "...", "timeout": 60000 },
    "pre-push": { "command": "...", "timeout": 30000 },
    "post-merge": { "command": "...", "timeout": 10000 }
  },
  "production-gate": { "command": "...", "trigger": "manual" }
}
```

---

## assets/config/managed-settings.example.json

**用途**：托管配置示例，展示项目级配置项的完整结构

**核心配置项**：
- `autonomy_level`：L1-L4
- `complexity_budget`：复杂度预算
- `band_threshold`：控制带阈值
- `circuit_breaker_threshold`：熔断阈值
- `gate_strictness`：各门禁严格度
- `evaluation_weights`：E1-E8 评估权重
- `agent_org`：Agent 角色到模型的映射

---

## assets/templates/PULL_REQUEST_TEMPLATE.md

**用途**：PR 模板，包含循环验证摘要、门禁状态、评估维度、变更范围、复杂度控制带、人类判断门、哈希链账本验证等字段
---

## scripts/hitl-audit.mjs

**用途**：L4 HITL 自动审计——H1-H4 检查点自动评估，先尝试自动修复，修复失败才记录事故并建议回退

**输入参数**：
```
node scripts/hitl-audit.mjs <project-dir> [--gate H1|H2|H3|H4|all]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--gate` | 否 | 指定检查点，默认 all |

**检查点说明**：
| 检查点 | 名称 | 检查内容 | 熔断条件 |
|---|---|---|---|
| H1 | 安全敏感操作 | 变更是否涉及真实用户数据/明文凭据；.env 是否在 .gitignore | 涉及敏感文件且未保护 |
| H2 | 破坏性操作 | .gitignore/package.json/tsconfig/migration/schema 变更；影响范围；回滚方案 | 影响范围>10文件或无git历史 |
| H3 | Release交付闸 | G0-G3 全绿；审计日志存在 | 门禁未全绿或无审计日志 |
| H4 | 门禁仲裁 | 门禁账本中 FAIL 条目是否有充分详情 | FAIL 无详情（证据不足） |

**输出格式**：
```
[PASS|FAIL] H1: <详情>
  [CIRCUIT BREAKER] H1 triggered circuit breaker condition
...
All HITL audits PASSED. / HITL audit FAILED.
```

**先修复后降级行为**：
- 检测到问题时先尝试自动修复（如将 .env 添加到 .gitignore、创建审计日志文件、补充账本详情等）
- 修复后重新审计，只有仍失败才记录事故到 `.cycles/incidents/`
- 自动记录审计结果到 `.cycles/cycles/cycle-{N}/审计日志.md`
- 退出码 2 表示熔断触发（修复尝试失败后），建议运行 `org-status.mjs auto-fallback`

**退出码**：0=全部通过, 1=有检查点未通过, 2=熔断触发

---

## scripts/auto-fix-loop.mjs

**用途**：自动修复循环——验证失败→根因诊断→修复→重新验证，最多重试 N 次

**输入参数**：
```
node scripts/auto-fix-loop.mjs <project-dir> [--max-retries N] [--test-cmd "..."]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--max-retries` | 否 | 最大重试次数，默认 3 |
| `--test-cmd` | 否 | 自定义测试命令（默认读取 config.yml 的 test_cmd） |

**执行逻辑**：
1. 运行测试命令（从 config.yml 读取或 --test-cmd 指定）
2. 读取 test-reports/ 下的测试报告，识别失败项
3. 如无失败 → 成功退出
4. 如有失败 → AI 诊断根因并修复 → 重新验证
5. 循环直到失败=0 或达到重试上限
6. 达到上限 → **先进行失败模式分析**（不可直接熔断）：
   - **重复性失败**（repeating）：同一错误反复出现 → 根因可能在于架构层面 → 尝试更深层次修复
   - **级联失败**（cascading）：不同错误连锁出现 → 根因可能在于依赖链 → 尝试隔离修复
   - **瞬态失败**（transient）：偶发性错误 → 尝试增加重试次数或调整超时配置
7. 只有失败模式分析后仍无法修复时，才触发熔断条件1
8. 输出修复报告

**输出格式**：
```
=== Auto-Fix Loop ===
Project: <path>
Cycle: cycle-{N}
Test command: <cmd>
Max retries: 3

--- Attempt 1/3 ---
Running test command: <cmd>
Identified N failure(s):
  - test-command-failure: <detail>
  - test-report-failure: <file> (N failures, M errors)
AI should diagnose root cause and apply fix...
  Re-running verification after fix...
Fix successful. / Fix attempt N failed.

Auto-fix loop completed successfully. / Auto-fix loop FAILED.
```

**产物**：
- 修复报告：`.cycles/cycles/cycle-{N}/test-reports/auto-fix-report.md`
- 审计日志：追加到 `.cycles/cycles/cycle-{N}/审计日志.md`
- 事故记录（熔断时）：`.cycles/incidents/incident-auto-fix-fail-{timestamp}.md`

**退出码**：0=修复成功, 2=熔断触发（达到重试上限）
---

## scripts/multi-agent-gate.mjs

**用途**：L4 多 Agent 门禁评估——5个人工门各由3个不同角色的 AI agent 从不同维度独立评估，综合结果做出推荐

**输入参数**：
```
node scripts/multi-agent-gate.mjs <project-dir> [--gate intent|spec|plan|pr|release|all] [--auto-approve]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `<project-dir>` | 是 | 项目根目录路径 |
| `--gate` | 否 | 指定门禁，默认 all |
| `--auto-approve` | 否 | 信任度≥70%时自动根据推荐执行 |

**门禁与评估 Agent**：
| 门禁 | Agent 1 | Agent 2 | Agent 3 | 通过阈值 |
|---|---|---|---|---|
| intent | 产品经理(业务价值) | 架构师(技术可行性) | 评估者(需求完整性) | 2/3 |
| spec | 架构师(设计合理性) | 安全审查(安全合规) | 评估者(规格完整性) | 2/3 |
| plan | 工程师(实现可行性) | 评估者(测试覆盖) | 审查者(代码规范) | 2/3 |
| pr | 审查者(代码质量) | 安全审查(安全扫描) | 门禁守卫(G0-G3) | 3/3 |
| release | 门禁守卫(全门禁) | 安全审查(合规) | 评估者(性能基线) | 3/3 |

**输出格式**：
```
=== Multi-Agent Gate Evaluation ===
Project: <path>
Gates: intent, spec, plan, pr, release

--- 意图接受门 → Design ---
Result: PASS (2/3) | Trust: 78%
Recommendation: 推荐接受意图
  [PASS] product-manager (业务价值评估): 业务描述充分（5/7 关键要素，3/3 核心要素） [71%]
  [PASS] architect (技术可行性评估): 技术可行性充分（3/3 核心要素，技术栈上下文充分） [100%]
  [FAIL] evaluator (需求完整性评估): 需求要素不足（1/6 关键词，1/3 核心要素） [17%]

All multi-agent gate evaluations PASSED.
Average trust score: 78%
Auto-approve: YES — Proceeding based on multi-agent recommendation.
  (Trust score 78% >= 70% threshold, all gates passed)
  Next action: Advance to next phase via workflow-state.mjs advance
```

**`--auto-approve` 行为**：
- 全部门禁通过 + 信任度≥70% → 自动根据推荐执行（推进到下一阶段）
- 全部门禁通过 + 信任度<70% → 输出"Proceed with caution"，建议人工审查
- 有门禁未通过 + 信任度≥70% → 不自动执行，输出"Review failed gates"
- 有门禁未通过 + 信任度<70% → 不自动执行，输出"Human review required"

**产物**：
- 评估报告：`.cycles/cycles/cycle-{N}/test-reports/multi-agent-gate-report.md`
- 审计日志：追加到 `.cycles/cycles/cycle-{N}/审计日志.md`

**退出码**：0=全部通过, 1=有门禁未通过