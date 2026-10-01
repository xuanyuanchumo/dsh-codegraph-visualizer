# Cycle-56 意图文档

## 目标
基于 L4 全自主循环，对 dsh-codegraph-visualizer 进行客户端整合重构与界面组件优化：
1. Toolbar.tsx 配置常量与类型定义抽取到独立文件（566行→~360行主组件）
2. CSS 模块化拆分（analysis-panels.css 1155行→按组件粒度拆分）
3. i18n 字典命名空间拆分（en/zh 570行→按功能域）
4. 清理误创建的 nul 文件
5. 测试验证与 Chrome DevTools MCP 视觉验证

## 动机
- Toolbar.tsx 566 行，配置常量+类型定义占 200 行，违反 SRP，应抽取
- analysis-panels.css 1155 行，含 6+ 组件样式，违反组件粒度原则
- i18n en/zh 各 570 行，单文件过大，应按功能域拆分
- 根目录误创建 nul 文件（Windows 特殊文件名），需清理

## 范围
- **范围内**：Toolbar 配置抽取、CSS 模块化、i18n 拆分、清理、验证
- **范围外**：渲染引擎替换、WebGL 迁移、数据库重构（已有 Drizzle ORM）

## 约束
- 保持 4463+ 测试通过
- 保持 lint 零错误、typecheck 通过、build 成功
- 保持 ESM only、Host/Client 隔离、Branded 类型
- CSS 拆分不改变任何样式规则，仅按组件边界拆分文件
- i18n 拆分保持所有翻译键不变

## 验收标准
- G0: 评估基线就绪（4463测试通过）
- G1: 任务清单清零（P0-P3 全部完成）
- G2: 测试报告零错误（失败=0、错误=0）
- G3: 构建零失败（build 通过）