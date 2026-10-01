# Cycle-55 意图文档

## 目标
基于 L4 全自主循环，对 dsh-codegraph-visualizer 进行全面升级增强：
1. DSH v0.2.0 适配加固（devDeps升级+features gating+类型声明）
2. 客户端架构重构（src/client/index.ts 拆分+i18n分离）
3. 代码质量加固（a11y+{total}修复+Context类型统一）
4. 功能增强（graphology算法+孤儿检测+工具栏层级选择器+边聚合）
5. 测试验证与Chrome DevTools MCP视觉验证

## 动机
- 评估评审体系 E3 技术债务 9/10，需消除 TODO-05~09
- DSH v0.2.0 已发布 rc.2，devDeps 仍锁定 0.1.7-rc.2 未实测
- better-sidebar 集成缺少 features gating，按版本号门控不够健壮
- src/client/index.ts 500+行职责过多，违反 SRP
- graphology 已在 dependencies 中但未充分利用其算法库
- 工具栏缺少层级选择器（分层图库架构设计 §8.1 要求 L0-L3）

## 范围
- **范围内**：客户端/服务端整合重构、工具栏优化、功能增强、测试验证
- **范围外**：渲染引擎替换（最后手段）、WebGL 迁移、语义搜索

## 约束
- 保持 4412+ 测试通过
- 保持 lint 零错误、typecheck 通过、build 成功
- 保持 ESM only、Host/Client 隔离、Branded 类型
- 保持多代适配器架构兼容性
- 所有 disposer 必须追踪，不可丢弃

## 验收标准
- G0: 评估基线就绪（事实基座抽验通过）
- G1: 任务清单清零（P0-P3 全部完成）
- G2: 测试报告零错误（失败=0、错误=0）
- G3: 构建零失败（Debug+Release 构建通过）