# 测试报告（cycle-123 · 继承数据增强）

## 2. 汇总（终态全量）

| 指标 | 数值 |
|---|---|
| 通过 | 6372 |
| 失败 | 0 |
| 错误 | 0 |
| 跳过 | 0 |
| 文件数 | 254（+2：inheritanceEnhancer.test.ts 新增；TreeSitterAdapter.test.ts 扩展） |
| 耗时 | ~120s（全量轮） |

## 1. 执行环境

| 项 | 值 |
|---|---|
| 执行时点 | 2026-11-01 00:18–01:10（Asia/Shanghai） |
| 执行者 | AI-L4（Team Lead 直接执行） |
| 基线 | cycle-122 / commit `5882dd7`（252 文件 / 6,358 用例） |
| 本轮终值 | **254 文件 / 6,372 用例 / 0 失败** |

## 3. 新增测试（14 例）

| 文件 | 用例 | 断言要点 |
|---|---|---|
| tests/unit/TreeSitterAdapter.test.ts（+6，heritage real wasm） | interface extends（extends_type_clause）/ 多继承逐目标 / class implements+extends 双 clause / 自继承不产边 / 非声明节点不触发 / Python superclasses |
| tests/unit/inheritanceEnhancer.test.ts（+8） | A1 label 唯一命中注入 / A2 重名确定性取第一 / A3 未知目标 unresolved / B1 语义键去重 / C1 null 适配器 / C2 非绝对路径 / C3 扫描异常不冒泡 / D1 全字段可观测 |

## 4. 过程缺陷记录

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| P-1 | heritage 测试 fixture 跨行字符串字面量（heredoc 写入把 `\n` 吃成真换行） | 一次性 python/node 脚本的转义层级在 bash heredoc 中丢失 | 用锚文本精确替换脚本（.cycles/tmp-fix）修复 6 处；教训：**测试 fixture 的多行字符串应写入独立脚本文件执行，不走 heredoc** |
| P-2 | 自继承用例红：`targetId === selfId` 恒 false | 占位 id 形态（`<type>:X`）与声明 id（`X:row`）不同，id 相等判定失效 | 改为 `targetName === label` 语义判定（形态无关） |
| P-3 | A2 用例期望 ambiguous=1 与实现（取第一候选不计数）矛盾 | 测试按旧设计（丢弃）写，实现按深思取舍（确定性取第一）落地 | 独立脚本复现澄清行为后，测试对齐实现并在用例注释登记取舍理由 |

## 5. 诚实披露

- 继承增强的 **49 条 unresolved**（type_alias 多泛型/条件类型目标）未解决——客户端已收编 type_alias kind，残余需上游索引器改进（宿主侧，登记）；
- **duplicate=64** 经逐类验证是正确的语义去重（上游对 class→class 覆盖完整），非漏检；
- 真仓全管线增强耗时 4.6s（graph_data 全量轮一次性成本），未做异步化——超时预算内（60s 工具超时），若用户反馈卡顿再优化（YAGNI 登记）；
- 真机继承树视觉验证流转下一真机轮。

## 6. 结论

+14 例全绿、既有 6,358 例零回归；研究报告 Phase 1 P0 的数据质量缺口（interface extends 零检出）以 AST 增补面落地，继承边 22→36（+64%），tree 布局的数据前提（isRoot 非退化）开始成立。门禁证据齐备。
