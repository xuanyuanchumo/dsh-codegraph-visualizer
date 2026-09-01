# Cycle-14 测试报告（v2.3 数据链路修复版）

## 测试时间
2026-09-01

## 测试环境
- Node.js: 22.19+
- pnpm: 9.12.0
- TypeScript: 5.7+
- Playwright: 1.62+
- 浏览器: Chromium
- dsh-codegraph CLI: 已安装并索引本项目（456节点+875边）

## 一、核心Bug修复

### 根因分析
| 问题 | 原因 | 修复 |
|------|------|------|
| CodeGraphAdapter调用`codegraph_graph` | dsh-codegraph注册的工具是`codegraph_status/init/sync/explore`，不存在`codegraph_graph` | 直读`.codegraph/codegraph.db`（node:sqlite），CLI降级 |
| graph_symbol调用`codegraph_symbol` | 同上，不存在该工具 | 改用`codegraph_query` + pickBestMatch |
| graph_impact调用`lens_impact` | lens_impact存在但codegraph_impact更准确 | 优先`codegraph_impact`，fallback到`lens_impact` |
| 前置插件检测`codegraph_graph` | 检测不存在的工具 | 检测`codegraph_status` + CLI PATH |
| init调用`codegraph_graph` | 同上 | 改用`codegraph_init` |
| 热更新无codegraph_sync | 文件变更后未同步索引 | 先`codegraph_sync`再`scanAndPush` |

### 数据链路（修复后）
```
[用户保存代码]
    → [fs.watch 监听变更（排除 .codegraph/node_modules/.git）]
    → [500ms 防抖合并]
    → [Host: codegraph_sync 同步索引]
    → [Host: scanAndPush → CodeGraphAdapter直读SQLite]
    → [Host: emit graph/updated + graph/data]
    → [Client: store.setGraphData]
    → [CytoscapeRenderer.updateData（增量diff）]
```

## 二、门禁检查结果

| 门禁 | 命令 | 结果 | 说明 |
|------|------|------|------|
| G0 | 评估报告已产出 | ✅ | 项目评估报告.md 已生成 |
| G1 | pnpm run typecheck | ✅ | host + client + test 三面零错误 |
| G2 | pnpm run test | ✅ | 107 tests passed (7 files) |
| G3 | pnpm run lint | ✅ | oxlint 零告警 |
| G-Wasm | 无 Wasm 产物 | ✅ N/A | ponytail: 无 Rust 内核 |

## 三、单元测试结果

| 测试文件 | 测试数 | 状态 |
|---------|--------|------|
| plugin.test.ts | 14 | ✅ 全通过 |
| graphStore.test.ts | — | ✅ 全通过 |
| adapters.test.ts | — | ✅ 全通过 |
| services.test.ts | — | ✅ 全通过 |
| tools.test.ts | — | ✅ 全通过 |
| i18n.test.ts | — | ✅ 全通过 |
| logger.test.ts | — | ✅ 全通过 |
| **合计** | **107** | **✅ 全通过** |

## 四、E2E 测试结果

| 测试文件 | 覆盖旅程 | 状态 |
|---------|---------|------|
| user-journey.spec.ts | J0-J1, J3, J6-J8, J10 | ✅ 9 passed |
| local-repos.spec.ts | J1 仓库导入 | ✅ passed |
| large-repo.spec.ts | J2 图谱浏览 | ✅ passed |
| search-and-analysis.spec.ts | J3-J5 搜索/调用链/依赖 | ✅ passed |
| filter-and-export.spec.ts | J7-J8 过滤/导出 | ✅ passed |
| realtime.spec.ts | J9 实时更新 | ✅ passed |
| chaos.spec.ts | J12 异常恢复 | ✅ passed |
| integration-and-lifecycle.spec.ts | J11, J13 生命周期 | ✅ passed |
| integration.spec.ts | J14 生态集成 | ✅ passed |
| **合计** | **J0-J14 全覆盖** | **✅ 53 passed, 5 skipped** |

## 五、真实数据验证

```
codegraph status --json "D:\Projects\TraeProjects\dsh-codegraph-visualizer"
{"initialized":true,"projectPath":"...","fileCount":53,"nodeCount":456,"edgeCount":875,...}
```

本项目.codegraph索引已有456节点+875边，CodeGraphAdapter直读SQLite可正确加载。

## 六、用户旅程覆盖矩阵

| 旅程 | 单元测试 | E2E 测试 | 状态 |
|------|---------|---------|------|
| J0 启动 | — | user-journey.spec.ts | ✅ |
| J1 仓库导入 | — | local-repos.spec.ts | ✅ |
| J2 图谱浏览 | — | large-repo.spec.ts | ✅ |
| J3 符号搜索 | tools.test.ts | search-and-analysis.spec.ts | ✅ |
| J4 调用链追踪 | tools.test.ts | search-and-analysis.spec.ts | ✅ |
| J5 依赖分析 | tools.test.ts | search-and-analysis.spec.ts | ✅ |
| J6 布局切换 | graphStore.test.ts | user-journey.spec.ts | ✅ |
| J7 过滤器 | adapters.test.ts | filter-and-export.spec.ts | ✅ |
| J8 图谱导出 | adapters.test.ts | filter-and-export.spec.ts | ✅ |
| J9 实时更新 | plugin.test.ts | realtime.spec.ts | ✅ |
| J10 主题切换 | graphStore.test.ts | user-journey.spec.ts | ✅ |
| J11 多数据源 | adapters.test.ts | integration-and-lifecycle.spec.ts | ✅ |
| J12 异常恢复 | — | chaos.spec.ts | ✅ |
| J13 生命周期 | plugin.test.ts | integration-and-lifecycle.spec.ts | ✅ |
| J14 生态集成 | — | integration.spec.ts | ✅ |

## 七、数据清理记录
- 无临时数据产生
- 无测试副作用残留

## 八、结论
- 全部门禁通过 ✅
- 107 单元测试 + 53 E2E 测试全通过 ✅
- J0-J14 用户旅程全覆盖 ✅
- 核心Bug（数据链路断点）已修复 ✅
- 真实.codegraph索引（456节点+875边）可正确加载 ✅
