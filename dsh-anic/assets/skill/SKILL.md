---
name: ai-native-iteration-cycle
description: >
  AI-Native 迭代驱动开发流程：将 Anthropic AI-Native SDLC（Plan→Design→Build→
  Test→Deploy→Maintain）与循环驱动验证流程深度融合。AI 自主规划、评估、拆测、
  验证、修复、交付，人类在门禁处保留判断权。适用于任何需要系统性质量保证的
  软件项目。当用户提到"迭代验证"、"质量门禁"、"循环开发"、"AI自主开发"、
  "评估驱动开发"、"intent"、"SDLC"、"AI-Native"、"迭代循环"、"收敛门禁"、
  "自主开发流程"时触发。也适用于用户希望建立结构化开发流程、需要分层测试策略、
  或希望 AI 以全自主模式执行开发的场景。即使用户只是提到想要一个系统化的开发
  流程或质量保证框架，也应考虑使用此 skill。
---

# AI-Native Iteration Cycle

将一个目标或想法转化为已规划、构建、测试、部署和监控的项目，通过运行融合循环：
**Plan → Design → Build → Test → Deploy → Maintain**，每个阶段内嵌入
**评估 → 规划 → 拆测 → 验证 → 修复 → 门禁 → 复盘** 的微观迭代。

## 核心理念

1. **宏观循环 + 微观迭代**：六个宏观阶段构成完整生命周期，每个阶段内部以循环迭代驱动质量收敛
2. **产物即证据**：每个阶段产出版本化产物（intent.md → spec.md → plan.md → cycle-{N}/ → PR → release），提交链即审计轨迹
3. **双层门禁**：人类判断门（意图接受→设计；规格批准→构建；计划批准→代码；PR合并→部署；发布授权→生产）+ 自动化收敛门（G0-G3）
4. **三层护栏**：驱动原则（红线）→ Skills（建议层）→ Hooks（确定层）
5. **自主性分级**：L1 辅助 → L2 半自动 → L3 监督自主 → L4 全自主，熔断条件自动回退
6. **渐进式采用**：从叶子节点开始，依赖图驱动采用路径，不需要一步到位

## 硬性规则

| # | 规则 | 说明 |
|---|---|---|
| R01 | 人类门禁不可跳过 | 意图接受→设计；规格批准→构建；计划批准→代码；PR合并→部署；发布授权→生产 |
| R02 | 永不越过生产门 | Agent 生成的变更止于合并/发布边界，高风险操作须人类授权 |
| R03 | 验证先于评审 | 先自行运行构建/测试/lint/截图，修复失败项，再提交人类评审 |
| R04 | 评估先行 | 功能验证前先做项目/功能业务架构评估 |
| R05 | 证据纪律 | 每次验证必须产出测试报告（通过/失败/断言/日志/复现步骤/手工记录） |
| R06 | 不降级 | 不因赶进度降低验收标准 |
| R07 | 不条件通过 | 任何"仅当X才通过"均不成立 |
| R08 | 缺陷闭环 | 发现→登记→根因→修复→回归→关闭→逃逸度量 |
| R09 | 计划模式优先 | 无已接受计划不实现；实现偏离计划时同提交更新 plan.md |
| R10 | 重复教训编码化 | 同一错误出现两次→写入 CLAUDE.md/AGENTS.md、Skill 或 Hook |
| R11 | 评审须有证据 | 每条发现引用文件/行号+具体证据，按严重度排序，每轮最多5条 nit |
| R12 | Subagent 须命名可见 | 功能性命名、提交定义、解释派遣、有界报告+证据，非静默后台工作者 |
| R13 | 工具可用性门禁 | 验证开始前先检查核心工具，不可用先自动修复 |
| R14 | 事实基座抽验 | 抽验文档引用的≥5条路径/命令在仓库真实存在 |
| R15 | 旅程全覆盖 | 用户旅程正反向场景100%通过 |

### 规则→执行矩阵

| 硬规则 | 建议层（Skill/CLAUDE.md） | 确定层（Hook/脚本） | 检查点 |
|---|---|---|---|
| R01 门禁不可跳过 | CLAUDE.md 约定 | git 提交链 + hooks | 门禁接受提交 |
| R02 不越生产门 | 本 Skill | production-gate.sh + 审批账本 | Deploy 门 |
| R03 验证先于评审 | CLAUDE.md "验证你的工作" | make 式验证命令 | PR 模板证据 |
| R04 评估先行 | 本 Skill | — | G0 门禁 |
| R05 证据纪律 | 测试报告模板 | — | G2 门禁 |
| R06 不降级 | 本 Skill | — | 门禁判定 |
| R07 不条件通过 | 本 Skill | — | 门禁判定 |
| R08 缺陷闭环 | 任务清单模板 | — | G1 门禁 |
| R09 计划模式优先 | plan.md 模板 | plan-sync-check 脚本 | PR 评审 |
| R10 教训编码化 | CLAUDE.md "常见错误" | protected-path hooks | 评审二次错误规则 |
| R11 评审须有证据 | REVIEW.md | — | 评审通过项，5-nit 上限 |
| R12 Subagent 命名可见 | 本硬规则 | subagent 定义提交 git | subagent 报告 |
| R13 工具可用性门禁 | 本 Skill | init-workflow 脚本 | Phase 0 |
| R14 事实基座抽验 | 本 Skill | fact-base-verify 脚本 | G0 门禁 |
| R15 旅程全覆盖 | 旅程定义模板 | — | G2 门禁 |

## 自主性分级

| 级别 | 名称 | 特征 | 人类介入 |
|---|---|---|---|
| L1 | 辅助执行 | AI 按人类逐条指令执行单步操作 | 每步 |
| L2 | 半自动 | AI 自主执行常规步骤，产物须人类审核 | 每产物 |
| L3 | 监督自主 | AI 自主决策并执行全流程，仅检查点请求人类确认 | 仅检查点 |
| L4 | 全自主 | AI 全流程自主（含 Release），检查点自动审计化 | 仅事后审计 |

**熔断条件**（先修复后降级——任一触发后先诊断根因并尝试自动修复，只有修复失败才回退 L3）：
1. 同一异常连续 3 次自动修复失败
2. 门禁自动判定存疑且无法自动定论
3. 涉及真实用户数据/明文凭据且无隔离方案
4. 破坏性操作影响范围不可评估或不可回滚
5. 性能指标超预警阈值且 1 轮优化后仍未恢复
6. 人类主动要求审计/切换到 L3
7. 无人值守超时/资源上限（单会话 >24h 或上下文水位 >85%）
8. 自动化资源上限（累计重试 >10 次或熔断 >3 次）

## 快速启动

当用户给出目标或想法且尚无工作流时：

1. 运行 `scripts/init-workflow.mjs <project-dir> --name "<项目名>"` 初始化骨架
2. 读取项目配置 `.cycles/config.yml`（无则用脚本生成模板）
3. **Plan 阶段**：以分析师式提问访谈用户——什么无法做到、谁受影响、更好的样子、约束、范围外——直到想法具体化
4. 写出 `.cycles/intent/intent.md`，提交，请求产品负责人接受
5. 接受后进入 **Design 阶段**：读取 intent.md + 组织标准 Skills → 产出 `spec.md` → 请求批准
6. 批准后进入 **Build 阶段**：计划模式 → 产出 `plan.md` → 批准 → 实现 → 循环验证
7. 每轮循环先运行 `scripts/init-cycle.mjs <project-dir>` 建立循环工作区（`eval-runner`/`gate-check` 都要求 `.cycles/cycles/cycle-{N}/` 存在，v1.8.0 补：快速启动此前漏了这一步，直跑 eval-runner 必报 "No cycle directory"）
8. 每个阶段内部运行微观迭代：评估→规划→拆测→验证→修复→门禁→复盘

如果用户已在某个阶段内（如"评审这个 PR"或"诊断这个事故"），直接从该阶段开始。

## 宏观循环概览

| 阶段 | 读取 | 产出 | 人类门 | 收敛门 |
|---|---|---|---|---|
| Plan | 用户想法 | intent.md | 接受→Design | G0 评估基线 |
| Design | intent.md + 标准 Skills | spec.md | 批准→Build | G0 |
| Build | intent.md + spec.md | plan.md → cycle-{N}/ → 代码+测试 → PR | 计划批准→代码；PR合并→Deploy | G0-G3 |
| Test | 仓库 + eval 套件 | eval 结果 + 回归 evals | 配置变更降通过率须评审 | G2 |
| Deploy | 合并 PR + 评审发现 | 授权发布 | 代理评审 + 显式发布授权 | G3 |
| Maintain | 生产指标 | 诊断 → 新 intent.md | 值班分诊：修复/排期/调整阈值 | 控制带触发 |

## 微观迭代（嵌入每个阶段内）

```
评估 → 规划 → 拆测 → 验证 → 修复 → 门禁 → 复盘
E1-E8  子规划  分层   测试报告  根因   G0-G3  量化指标
Q1-Q8          Q1-Q8        Q1-Q8  Q1-Q8
```

每个宏观阶段内部都运行这七步微观迭代，驱动质量收敛。不是每个阶段都必须完整运行所有七步——根据阶段特性裁剪。

## 评估维度 E1-E8 + 质量评审 Q1-Q8

**E1-E8**（评估维度）：E1意图对齐、E2规格符合、E3测试覆盖、E4代码质量、E5性能基线、E6安全检查、E7文档同步、E8回归完整性

**Q1-Q8**（质量评审维度，覆盖功能性需求+非功能性需求+设计约束+UX/UI标准+工程化规范）：

| 维度 | 名称 | 覆盖范围 |
|---|---|---|
| Q1 | 功能与业务 | 功能域覆盖、业务规则正确性、RTM、用户旅程 |
| Q2 | 测试体系 | 分层测试、覆盖率门限、混沌用例、RTM缺口 |
| Q3 | 性能与运维 | 性能基线、退化检测、可观测性、可恢复性 |
| Q4 | 安全与合规 | 漏洞扫描、凭据管理、依赖审计、合规检查 |
| Q5 | 架构约束 | 分层合规、适配器隔离、循环依赖、契约一致性 |
| Q6 | 前端与体验 | a11y、响应式、交互体验、视觉一致性、i18n |
| Q7 | 代码与工程 | lint、复杂度、错误处理、日志规范、依赖管理 |
| Q8 | 评审与验收 | 证据完整性、严重度分级、验收达标、交付清单 |

质量评审与门禁的关系：G0 包含 Q1+Q5，G1 包含 Q7，G2 包含 Q2，G3 包含 Q3+Q4。使用 `--quality` 标志启用质量门禁检查。

## 收敛门禁 G0-G3

| 门禁 | 名称 | 判定标准 | 质量维度 | 违反后果 |
|---|---|---|---|---|
| G0 | 评估基线就绪 | 评估报告已产出且覆盖范围；事实基座抽验通过 | Q1+Q5 | 禁止进入拆测/验证 |
| G1 | 任务清单清零 | P0-P3 全部任务已登记（含归属层）；无未分配测试用例 | Q7 | 禁止进入下一循环 |
| G2 | 测试报告零错误 | 失败=0、错误=0；旅程覆盖零缺口；混沌用例全过 | Q2 | 禁止进入 Release |
| G3 | 构建零失败 | Debug 构建通过；Release 构建通过；冒烟与全量回归全通过 | Q3+Q4 | 禁止提交、禁止交付 |

门禁执行顺序：G0 → G1 → G2 → G3。任何门禁失败即停止流转并登记。使用 `gate-check.mjs --quality` 启用质量维度检查。

## 导航索引

按需加载——只在需要时读取对应参考文档：

| 需要了解 | 读取 |
|---|---|
| 六阶段完整操作手册（宏观×微观） | `references/playbook.md` |
| 驱动原则详解（15硬规则+19红线） | `references/principles.md` |
| 双层门禁判定标准（人类门+G0-G3） | `references/gates.md` |
| 自主性分级+熔断+Agent Org | `references/autonomy.md` |
| L4 全自主循环编排指南 | `references/auto-cycle.md` |
| 多 Agent 门禁评估机制 | `references/multi-agent-gate.md` |
| 评估维度+连续Evals+KPI | `references/evaluation.md` |
| 软件质量保障与全生命周期评审体系（Q1-Q8） | `references/quality-review.md` |
| 完整状态流转机制（阶段/门禁/质量/自主/熔断/微观） | `references/state-transition.md` |
| 渐进式采用路径（依赖图驱动） | `references/adoption.md` |
| 有向图工程（运行时图+采用图） | `references/graph.md` |
| 项目适配配置规范 | `references/project-config.md` |
| 脚本接口参考（输入/输出/退出码） | `references/scripts-reference.md` |
| 常见问题与故障排查指南 | `references/troubleshooting.md` |

## 产物模板

模板位于 `assets/templates/`，按阶段使用。所有运行时产物收纳在 `.cycles/` 目录内：

```
.cycles/                        # 唯一的 skill 产物根目录
├── config.yml                  # 项目配置
├── workflow-graph.yaml         # 工作流图配置
├── workflow-state.json         # 工作流状态（当前阶段/循环）
├── band-history.json           # 复杂度控制带历史快照
├── REVIEW.md                   # 评审标准（全局默认）
├── intent/
│   └── intent.md               # 意图文档（可含 spec.md 等多个文档）
├── cycles/
│   └── cycle-{N}/              # 循环工作区
│       ├── 项目评估报告.md      # E1-E8 + Q1-Q8 评估结果（eval-runner 写入）
│       ├── 当前循环总规划.md
│       ├── 任务清单.md
│       ├── 当前循环页面状态.md
│       ├── 审计日志.md
│       ├── 交付清单.md          # 8项必备交付物清单
│       ├── 非功能验证报告.md    # 性能/安全/稳定性验证
│       ├── subplans/
│       └── test-reports/
├── gates/                      # 门禁记录
│   └── ledger.json             # 哈希链门禁账本
├── incidents/                  # 事故记录
├── retrospectives/             # 复盘记录
├── tech-debt/                  # 技术债务
├── evals/                      # 评估套件
├── archive/                    # 已归档的完成循环
│   └── cycle-{N}/              # 归档循环（保留历史）
```


CLAUDE.md/AGENTS.md 保留在项目根目录（框架要求）。

| 阶段 | 模板 |
|---|---|
| Plan | `intent.md` |
| Design | `spec.md` |
| Build | `plan.md`, `cycle-plan.md`, `task-list.md`, `page-state.md` |
| Test | `test-report.md`, `eval-report.md`, `non-functional-report.md` |
| Deploy | `delivery-checklist.md`, `audit-log.md` |
| Maintain | `incident.md`, `retrospective.md` |
| 全阶段 | `review.md` |

## 项目适配

通过 `.cycles/config.yml` 实现跨项目通用性。读取 `references/project-config.md` 了解配置规范。核心配置项：

- `project`: 项目名称、技术栈、框架
- `build`: 构建/测试/lint/coverage/e2e 命令
- `layers`: 分层验证定义（自定义分层）
- `evaluation`: E1-E8 评估维度配置
- `journeys`: 用户旅程定义
- `gates`: G0-G3 收敛门禁配置
- `human_gates`: 人类门禁角色配置
- `control_bands`: 控制带配置（Maintain 阶段）
- `autonomy_level`: 自主性级别（L1-L4）

## 渐进式采用

采用顺序不是阶段顺序，而是依赖图顺序：

| 采用层 | 内容 | 前置条件 |
|---|---|---|
| 第1层（叶子） | 意图捕获 + 仓库记忆 + 反馈循环 + 构建时 Hooks + 计划模式 | 无 |
| 第2层 | Skills + Subagents + 连续 Evals | 第1层 |
| 第3层 | 需求与设计会话 + PR 评审 | 第2层 |
| 第4层 | CI/CD 集成 + 审批门禁 | 第3层 |
| 第5层 | 闭环（监控→新意图）+ Agent Org | 第4层 |

自主性分级与采用路径对应：L1→第1层，L2→第2-3层，L3→第4层，L4→第5层。

## 框架兼容性

本 Skill 框架无关。Claude Code 的仓库记忆文件为 `CLAUDE.md`，Skills 在 `.claude/skills/`；Codex 的仓库记忆文件为 `AGENTS.md`，Skills 在 `~/.codex/skills/`。产物（intent.md, spec.md, plan.md 等）框架无关。无论本 Skill 中何处提到 CLAUDE.md，请替换为你所用框架识别的仓库记忆文件。
## L4 全自主循环操作

当 `autonomy_level: L4` 时，AI 以全自主模式编排完整微观迭代循环。核心脚本链：

| 步骤 | 脚本 | 说明 |
|---|---|---|
| 基线就绪 | `quick-validate.mjs` + `fact-base-verify.mjs` + `eval-runner.mjs` | 工具自检、事实抽验、评估基线 |
| 规划 | `workflow-state.mjs check` | 检查门禁状态，生成规划 |
| 拆测 | — | 功能→分层用例映射，生成任务清单 |
| 验证 | `eval-runner.mjs --dimensions E3,E4,E8,Q2` | 运行测试+lint+评估 |
| 复杂度漂移 | `band-detector.mjs` | Western Electric 规则检测（S-10：补入 L4 链；连续 2 轮超预算 = CB5 熔断条件，结果供 org-status 读取） |
| 修复循环 | `auto-fix-loop.mjs` | 验证失败→失败模式分析→根因诊断→修复→重新验证，不可直接熔断 |
| 门禁判定 | `gate-check.mjs --gate all --quality --record` | G0-G3 全部门禁；`--record`（v1.8.0）把每次判定结果自动写入账本（带去重，FAIL 也记） |
| 多Agent门禁评估 | `multi-agent-gate.mjs` | 5个人工门各由3个Agent从不同维度评估，信任度≥70%且--auto-approve时自动执行 |
| HITL审计 | `hitl-audit.mjs` | H1-H4 自动审计，先修复后降级（修复失败才回退 L3） |
| 熔断回退 | `org-status.mjs auto-fallback` | 检测8个熔断条件，先修复后降级（Phase 1诊断→Phase 2修复→Phase 3降级） |
| 复盘 | `org-status.mjs review` | 循环评审摘要 |
| 阶段推进 | `workflow-state.mjs advance` | 推进到下一阶段 |

详细编排流程见 `references/auto-cycle.md`。

### 结构契约（v1.7.0，1.8.x/1.9.0 扩充）

- **唯一配置入口**：`.cycles/config.yml`（`init-workflow` 生成的唯一路径）。`cycle-config.yml` 旧名仍被读取但会打印弃用告警，请尽快迁移。
- **词表单一来源**：评估维度 id→名称由 `scripts/lib/dimensions.mjs` 注册表定义；账本结构与校验由 `scripts/lib/ledger.mjs` 定义。文档与配置不得重新定义（`quick-validate.mjs` 已机器守卫 B 族旧词表残留）。
- **响亮失败**：未知维度/未知门/缺失配置一律非零退出并列出合法值；缺 lint/build 命令记 FAIL（无法评估 ≠ 通过）。
- **三态裁决（v1.9.0）**：评估维度只有 PASS / FAIL / **SKIP** 三种结果，"无法评估"记 SKIP 而非 PASS。SKIP 不阻塞 `eval-runner` 运行（退出码只由 FAIL 决定）但会响亮列出；`gate-check --quality` 视 SKIP 与"行缺失"为**不可关门**——门禁必须有证据。
- **账本即真相**：release 门 gatekeeper 以 `verifyLedger` 真链校验为准；账本写入为原子写（temp+rename）；`gate-check --record` 把每次门禁判定（含 FAIL，带去重）写入账本——门禁结果不落在账本里就等于没发生过。
- **漂移机器守卫（v1.9.0）**：`quick-validate.mjs` 校验版本三锚点一致、配置入口唯一、无绕过原子写、无 B 族旧词表——守卫是错误级（exit 1），告警级守卫等于没有守卫。

## MCP 集成

确定性脚本已封装为 MCP Server，AI 可直接调用而非通过 bash 执行：

```bash
node scripts/mcp-server.mjs --project-dir <path>
```

MCP Tools (v1.9.0)：
- `init_workflow` / `init_cycle` / `gate_check`（含 --quality 质量门禁） / `eval_runner`（含 E1-E8 + Q1-Q8）
- `band_detector`（含 Western Electric 规则） / `workflow_state`（status/advance/check） / `gate_ledger`（record/verify/list 哈希链）
- `fact_base_verify` / `plan_sync_check`（含 git diff） / `org_status`（status/agent/review/auto-fallback）
- `quick_validate`（skill 包自检） / `archive_cycle`（archive/clean/list 循环归档管理）
- `hitl_audit`（H1-H4 自动审计，先修复后降级） / `auto_fix_loop`（自动修复循环，先失败模式分析后熔断） / `multi_agent_gate`（多 Agent 门禁评估，含 --auto-approve，信任度≥70%自动执行）

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