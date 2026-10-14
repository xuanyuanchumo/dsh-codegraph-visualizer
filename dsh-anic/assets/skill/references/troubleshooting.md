# 常见问题与故障排查

> 当流程异常时，按此文档排查和恢复。
> 读取本文件的时机：门禁失败、工具不可用、评估冲突、熔断触发时。

## 门禁失败排查

### G0 评估基线门失败

**症状**：`[FAIL] G0: No evaluation report` 或 `[FAIL] G0: No cycle workspace`

**排查步骤**：
1. 检查 `.cycles/` 目录是否存在 → 不存在则运行 `init-workflow.mjs`
2. 检查 `.cycles/cycles/cycle-{N}/` 目录是否存在 → 不存在则运行 `init-cycle.mjs`（v1.8.0 修正：实际路径多一层 `cycles/`，旧文档写的 `.cycles/cycle-{N}/` 是错的）
3. 检查 `.cycles/cycles/cycle-{N}/项目评估报告.md` 是否存在 → 不存在则运行评估流程
4. 检查评估报告内容是否完整 → 不完整则重新评估

### G1 任务收敛门失败

**症状**：`[FAIL] G1: N of M tasks not completed` 或 `[FAIL] G1: No task entries found`（v1.8.0 起；旧版症状为 "Tasks still pending/in-progress"）

**排查步骤**：
1. 打开 `.cycles/cycles/cycle-{N}/任务清单.md`
2. G1 解析 P0-P3 任务表行（首列非空且末列为状态值）——图例/状态约定文字不参与判定
3. 报 "No task entries found" 说明任务表还全是模板占位行（首列空）——填写真实任务
4. 报 "N of M tasks not completed" 时把未完成任务的状态列改为「完成」
5. 重新运行 `gate-check.mjs --gate G1`

### G2 测试收敛门失败

**症状**：`[FAIL] G2: N failures, M errors` 或 `[FAIL] G2: No test reports`

**排查步骤**：
1. 检查 `.cycles/cycles/cycle-{N}/test-reports/` 目录是否有测试报告
2. 打开最新测试报告，查找失败和错误的测试用例
3. 修复失败的测试或代码
4. 重新运行测试并生成报告
5. 重新运行 `gate-check.mjs --gate G2`

### G3 构建收敛门失败

**症状**：`[FAIL] G3: Build failed: <命令>`

**排查步骤**：
1. 手动执行 `config.yml` 中的 `build_cmd`
2. 查看构建错误输出
3. 修复构建错误
4. 重新运行 `gate-check.mjs --gate G3`

---

## 工具不可用排查

### 脚本执行失败

**症状**：`node scripts/xxx.mjs` 报错

**排查步骤**：
1. 检查 Node.js 版本 ≥ 18（`node --version`）
2. 检查脚本路径是否正确（相对于 Skill 根目录）
3. 运行 `node --check scripts/xxx.mjs` 验证语法
4. 检查脚本是否有执行权限（Linux/Mac）

### 配置文件缺失

**症状**：`No config.yml found`

**排查步骤**：
1. 运行 `init-workflow.mjs` 生成配置模板
2. 编辑 `config.yml`，填写项目的 build/test/lint 命令
3. 验证配置格式（YAML 语法）

### 测试命令未配置

**症状**：`No test command configured`

**排查步骤**：
1. 打开 `config.yml`
2. 在 `build` 部分添加 `test_cmd: "npm test"`（或项目的测试命令）
3. 同理配置 `build_cmd` 和 `lint_cmd`

---

## 评估冲突排查

### 评估维度结果矛盾

**症状**：E1 PASS 但 E3 FAIL（意图对齐通过但测试覆盖不足）

**处理方式**：
- 评估维度之间不要求一致——E1 测意图是否对齐，E3 测测试是否充分
- 以最严格的维度结果为准（FAIL 优先）
- 在评估报告中记录矛盾并说明原因

### 评估报告与实际不符

**症状**：评估报告说 PASS 但实际运行失败

**排查步骤**：
1. 检查评估报告的时间戳——可能已过期
2. 重新运行评估（`eval-runner.mjs`）
3. 检查评估工具是否正常工作
4. 检查 `config.yml` 中的评估配置是否正确

---

## 熔断触发排查

### 熔断条件1：同一异常连续3次修复失败

**排查步骤**：
1. 查看审计日志中的异常记录
2. 分析异常根因——是否需要人类介入？
3. 如果是 Agent 能力不足，考虑切换到更高级别或请求人类指导
4. 如果是环境问题，修复环境后重置计数

### 熔断条件5：性能超预警且1轮优化未恢复

**排查步骤**：
1. 运行 `band-detector.mjs` 检查复杂度是否超标
2. 查看性能监控数据，识别退化指标
3. 分析退化原因（代码变更、数据量增长、环境变化）
4. 制定优化方案或调整预警阈值

### 熔断恢复

**恢复流程**：
1. 确认熔断条件已消除（参考 autonomy.md 的恢复条件定义）
2. 在审计日志中记录恢复事件
3. 逐步恢复自主级别（L3→L4 需要验证期）
4. 监控恢复后的运行状态

---

## 常见配置问题

### config.yml 格式错误

**症状**：脚本读取配置失败

**排查步骤**：
1. 使用 YAML 验证工具检查格式
2. 确认所有字符串值用引号包裹
3. 确认缩进一致（YAML 对缩进敏感）
4. 参考 `assets/config/config.example.yml` 的格式

### workflow-graph.yaml 缺失

**症状**：`init-workflow.mjs` 报告找不到 workflow-graph.yaml

**排查步骤**：
1. 检查 `assets/config/workflow-graph.example.yaml` 是否存在
2. 手动复制到项目根目录：`cp assets/config/workflow-graph.example.yaml <project>/workflow-graph.yaml`
3. 根据项目需求编辑图配置

### 中文文件名编码问题

**症状**：脚本无法找到中文命名的产物文件（如"项目评估报告.md"）

**排查步骤**：
1. 确认文件系统支持 UTF-8 编码
2. 确认终端/编辑器使用 UTF-8 编码
3. 在 Windows 上，确保 PowerShell 或 Git Bash 使用 UTF-8