# Cycle-73 意图文档

## 目标
基于docs\评估评审研究开发体系.md、docs\图谱按需加载.md、docs\research\多种开源项目图谱深入研究报告.md、docs\测试体系.md、docs\用户旅程.md，以及context7 MCP对DSH官方API规范的研究，对本项目进行全方位的研究自主循环迭代增强优化开发。

## 核心改进项

### P0 — 核心改进
1. **ConversationViewIntegration CSS模块化** — 将90行内联样式改为CSS类，确保主题适配和暗色模式一致性
2. **工具栏按钮整合优化** — 右侧4组按钮重新分组整合，减少视觉密度，优化交互体验
3. **package.json dsh-plugin topic** — 添加dsh-plugin topic支持dsh-market搜索发现
4. **dsh-remote-web-ui client.inject** — 在client.inject中添加dsh-remote-web-ui确保标签页兼容

### P1 — 重要改进
5. **工具栏常驻显示** — 功能域拆分：工具栏属于常驻显示，不能因为工作区无图谱数据而消失
6. **J0用户旅程测试完善** — 确保J0旅程完整覆盖所有关键路径（安装→入口→面板可见）
7. **ConversationViewIntegration header优化** — 使用CSS类替代内联样式，与项目CSS规范一致
8. **无用测试审查清理** — 审查并清理过时或重复的测试

### P2 — 增强改进
9. **响应式布局优化** — 根据不同集成入口的容器尺寸适配
10. **客户端bundle体积分析** — 分析是否可优化bundle大小

## 约束
- DSH v0.2.0兼容，预留后续版本适配性
- 多代适配器架构兼容dsh多版本
- 同时兼容网页端与桌面端
- ESM only，.ts扩展名导入
- cg-前缀CSS类名，CSS变量主题
- Branded类型安全(NodeId/EdgeId/RepoId)
- 所有用户面向文本通过t()国际化