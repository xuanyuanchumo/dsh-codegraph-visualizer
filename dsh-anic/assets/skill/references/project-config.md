# 项目适配配置规范

> `.cycles/config.yml` 是实现跨项目通用性的核心配置文件。每个项目通过此文件自定义流程参数。

## 完整配置规范

```yaml
# AI-Native Iteration Cycle 项目适配配置

project:
  name: ""                    # 项目名称（必填）
  tech_stack: []               # 技术栈列表（如 ["typescript", "react"]）
  framework: ""                # 框架名称（可选，如 "next.js"）

# 宏观循环配置
macro_cycle:
  enabled_phases: [plan, design, build, test, deploy, maintain]  # 启用的阶段
  autonomy_level: L2           # 自主性级别：L1/L2/L3/L4

# 构建命令（从项目 package.json/makefile 等推断或手动填写）
build:
  build_cmd: ""                # 构建命令（如 "pnpm run build"）
  typecheck_cmd: ""            # 类型检查命令
  lint_cmd: ""                 # Lint 命令
  test_cmd: ""                 # 测试命令
  coverage_cmd: ""             # 覆盖率命令
  e2e_cmd: ""                  # E2E 测试命令
  hygiene_cmd: ""              # 发布卫生检查命令（可选）

# 分层验证（自定义分层）
layers:
  - name: ""                   # 层名称（如 "Frontend"）
    test_pattern: ""           # 测试文件匹配模式
    coverage_target: 80        # 覆盖率目标百分比

# 评估维度（E1-E8 框架 + 项目特定指标）
evaluation:
  E1:
    name: "意图对齐"            # 维度名称（唯一来源 scripts/lib/dimensions.mjs，不得改写）
    checklist_ref: ""          # 指向项目功能清单文档的路径
  E2:
    name: "规格符合"
    checklist_ref: ""
  E3:
    name: "测试覆盖"
    checklist_ref: ""
  E4:
    name: "代码质量"
    checklist_ref: ""
  E5:
    name: "性能基线"
    checklist_ref: ""
  E6:
    name: "安全检查"
    checklist_ref: ""
  E7:
    name: "文档同步"
    checklist_ref: ""
  E8:
    name: "回归完整性"
    checklist_ref: ""

# 用户旅程（项目特定）
journeys:
  J1:
    name: ""                   # 旅程名称
    forward: ""                # 正向关键路径描述
    reverse: ""                # 反向/异常场景描述
    test_files: []             # 关联测试文件路径列表
  # J2-JN...

# 收敛门禁
gates:
  G0:
    fact_base_verify_count: 5  # 事实基座抽验条数
  G1:
    task_completion_required: true  # 任务清单全部完成才通过
  G2:
    coverage_threshold:
      lines: 80                # 行覆盖率门限
      branches: 65             # 分支覆盖率门限
    journey_coverage: true     # 旅程覆盖零缺口
    chaos_coverage: true       # 混沌用例全过
  G3:
    build_commands: []         # 构建验证命令列表

# 人类门禁角色配置
human_gates:
  intent_accept:
    role: "product_owner"      # 决策角色
  spec_approve:
    role: "product_owner"
    consult: "tech_lead"       # 高风险项咨询角色
  plan_approve:
    role: "engineer"
  pr_merge:
    role: "code_owner"
  release_authorize:
    role: "release_manager"

# 控制带（Maintain 阶段）
control_bands:
  enabled: false               # 是否启用控制带监控
  metrics: []                  # 监控指标列表
  baseline_window_days: 30     # 基线滚动窗口天数
  tiers:
    sigma_1: "log"             # 1σ 响应：仅记录
    sigma_2: "diagnose"        # 2σ 响应：只读诊断
    sigma_3: "act_via_pr"      # 3σ 响应：通过 PR 行动

# 框架规范对齐（可选）
framework_alignment:
  name: ""                     # 框架名称（如 "DSH"）
  rules: []                    # 框架规范规则列表

# 性能基线（可选）
performance_baselines:
  - metric: ""                 # 指标名称
    target: ""                 # 目标值（如 "< 2s"）
    method: ""                 # 测量方法

# 长期愿景对标（可选）
vision_benchmarking:
  enabled: false
  dimensions: []               # 对标维度列表

# 算法选型决策（可选）
algorithm_selection:
  enabled: false
  require_research: true       # 引入新能力前必须先检索成熟库
  decision_table_ref: ""       # 选型决策表文档路径

# 复杂度预算（可选）
complexity_budget:
  enabled: false
  key_paths: []                # 关键路径列表
  budgets: []                  # 每个路径的复杂度预算
```

## 配置生成

运行 `scripts/init-workflow.mjs <project-dir> --name "<项目名>"` 会：
1. 创建产物目录骨架（`.cycles/intent/`, `.cycles/cycles/`, `.cycles/gates/` 等）
2. 复制配置模板（`.cycles/config.yml`, `.cycles/workflow-graph.yaml`, `.cycles/REVIEW.md`）
3. 复制意图文档模板（`.cycles/intent/intent.md`）
4. 创建仓库记忆文件（`CLAUDE.md` 或 `AGENTS.md`）
5. 初始化 git 仓库（可选，`--git` 标志）

初始化后需手动编辑 `.cycles/config.yml`，填入项目的构建/测试/lint 命令、分层定义、用户旅程等。

## 配置验证

配置变更时须验证：
1. 所有引用的命令在项目中真实可执行
2. 所有引用的文档路径真实存在
3. 覆盖率门限与项目测试配置一致
4. 人类门禁角色与团队实际角色对应

## 配置优先级

当配置与文档描述不一致时，以配置文件为准修复文档（事实基座原则）。