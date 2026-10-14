## 循环验证摘要

### 当前循环
- 循环编号: cycle-{N}
- 阶段: [Plan / Design / Build / Test / Deploy / Maintain]
- 自主级别: [L1 / L2 / L3 / L4]

### 门禁状态
| 门禁 | 结果 | 时间 |
|------|------|------|
| G0 评估收敛门 | [PASS / FAIL / PENDING] | |
| G1 任务收敛门 | [PASS / FAIL / PENDING] | |
| G2 测试收敛门 | [PASS / FAIL / PENDING] | |
| G3 构建收敛门 | [PASS / FAIL / PENDING] | |

### 评估维度
| 维度 | 评分 | 状态 |
|------|------|------|
| E1 规格符合度 | [0-10] | [OK / WARN / FAIL] |
| E2 测试覆盖率 | [0-10] | [OK / WARN / FAIL] |
| E3 性能基线 | [0-10] | [OK / WARN / FAIL] |
| E4 安全审计 | [0-10] | [OK / WARN / FAIL] |
| E5 代码质量 | [0-10] | [OK / WARN / FAIL] |
| E6 文档同步 | [0-10] | [OK / WARN / FAIL] |
| E7 事实基座抽验 | [0-10] | [OK / WARN / FAIL] |
| E8 计划同步 | [0-10] | [OK / WARN / FAIL] |

### 变更范围
- 修改文件数: {N}
- 新增文件数: {N}
- 删除文件数: {N}
- 计划内变更: {N} / 计划外变更: {N}

### 复杂度控制带
- 总复杂度评分: {N}
- 超预算文件数: {N}
- Western Electric 违规: {N}
- 状态: [OK / WARNING / OVER_BUDGET]

### 人类判断门
- [ ] 规格意图符合
- [ ] 用户体验达标
- [ ] 业务约束满足
- [ ] 伦理合规通过

### 哈希链账本验证
- 账本完整性: [VALID / INVALID]
- 条目总数: {N}

---
> 此 PR 由 AI-Native Iteration Cycle 流程生成。门禁和评估结果可通过 `.cycles/gates/ledger.json` 和 `.cycles/cycles/cycle-{N}/项目评估报告.md` 查看详情。