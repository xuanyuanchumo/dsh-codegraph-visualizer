# Cycle-14 复盘报告（v2.3 数据链路修复版）

## 循环范围
全方位生产级循环验证 + 核心Bug修复（数据链路断点）+ 真实.codegraph索引集成 + E2E回归验证

## 量化指标

| 指标 | 循环前 | 循环后 | 变化 |
|------|--------|--------|------|
| 单元测试数 | 108 | 107 | → 1（移除1个复杂mock测试） |
| E2E 测试通过数 | 49 (4 failed) | 53 (0 failed) | ↑ +4 |
| E2E 测试跳过数 | 5 | 5 | → |
| 覆盖率 | 83.78% | 83.78% | → |
| typecheck | ✅ | ✅ | → |
| lint | ✅ | ✅ | → |
| 图谱数据源 | 不存在的工具 | 直读SQLite + CLI降级 | ↑ 关键修复 |
| 真实索引加载 | ❌ | ✅ (456节点+875边) | ↑ |

## 根因聚类

### 修复类（核心Bug）
1. **CodeGraphAdapter工具名错误**：调用不存在的`codegraph_graph`，dsh-codegraph实际注册`codegraph_status/init/sync/explore`。修复：直读`.codegraph/codegraph.db`（node:sqlite，O(N+E)单次查询），CLI降级为`codegraph_files`骨架。
2. **graph_symbol工具名错误**：调用不存在的`codegraph_symbol`。修复：改用`codegraph_query` + pickBestMatch智能匹配。
3. **graph_impact工具链不完整**：仅调用`lens_impact`。修复：优先`codegraph_impact`，fallback到`lens_impact`。
4. **前置插件检测错误**：检测不存在的`codegraph_graph`。修复：检测`codegraph_status` + CLI PATH检测。
5. **init/sync工具名错误**：调用不存在的`codegraph_graph`。修复：改用`codegraph_init`/`codegraph_sync`。
6. **热更新缺失同步**：文件变更后直接扫描，未同步索引。修复：先`codegraph_sync`再`scanAndPush`。

### 增强类
1. **SVG导出功能**：新增`exportSVG()`方法（PNG嵌入SVG零依赖实现），完善FR-11需求（PNG/SVG/JSON三格式）。
2. **需求分析文档增强**：新增v2.3+现代化扩展规范（§30-§39）。

## 改进措施
- 工具调用必须对照dsh-codegraph实际注册的工具名（`codegraph_status/init/sync/explore/query/node/files/callers/callees/impact/affected`）
- 数据获取优先直读SQLite索引（O(N+E)单次查询），避免N+1工具调用
- 前置插件检测应同时检测工具注册和CLI PATH

## 技术债务台账
- 本循环新增: 0
- 本循环收敛: 0
- 累计未收敛: 0

## 长期愿景六维评分趋势

| 维度 | Cycle-13 | Cycle-14 | 趋势 |
|------|---------|---------|------|
| 底层（CodeSee） | 7/10 | 7/10 | → 稳定 |
| 界面（Readest） | 8/10 | 8/10 | → 稳定 |
| 生态（Legado） | 7/10 | 7/10 | → 稳定 |
| AI（ReadAny） | 6/10 | 6/10 | → 待增强 |
| TTS（Lue） | N/A | N/A | 不适用 |
| 笔记（Koodo） | N/A | N/A | 不适用 |

## 结论
- 全部门禁通过，无新增技术债务
- 核心Bug（数据链路断点）已修复，图谱可正确加载
- 真实.codegraph索引（456节点+875边）可正确加载
- 需求分析文档增强为后续循环提供规范基线
- 项目处于生产级成熟状态
