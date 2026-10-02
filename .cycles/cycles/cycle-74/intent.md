# Cycle-74 意图文档

## 目标

对 dsh-codegraph-visualizer 项目进行工具栏按钮整合重构、DSH官方API规范对齐、测试体系清理优化。

## 范围

### 包含
1. **工具栏整合重构**：Filter下拉+Filter Panel按钮合并、Hierarchy+Layer Selector合并
2. **DSH规范对齐**：inject声明补全、apply()改用ctx.effect()模式、package.json client.inject与代码对齐
3. **测试清理**：删除6个重复测试文件（迁移独有用例后删除）
4. **文档更新**：用户旅程文档中过时的测试文件映射

### 不包含
- GraphPanel组件拆分（风险过高，留待后续cycle）
- ConversationNodeDefinition实现（需要更深入的DSH对话节点研究）
- Drizzle ORM迁移完成（异步API替代同步SQL）
- 215个toBeTruthy弱断言修复（工作量过大，留待后续cycle）

## 验收标准

1. 4720+测试通过（清理重复后数量可能减少）
2. Lint零警告
3. Typecheck通过
4. Build成功
5. DSH环境J0旅程验证通过
6. Git提交完成

## 自主性级别

L4 - 全自主循环，熔断条件自动回退