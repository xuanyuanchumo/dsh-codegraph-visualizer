# cycle-99 测试报告——dsh-anic 独立仓库迁移

- 测试时间：2026-10-16
- 测试对象：迁移后的独立仓库 `D:\Projects\TraeProjects\dsh-anic`（HEAD d9b560f）+ 删除嵌套目录后的父仓库 `dsh-codegraph-visualizer`（HEAD 8893355）

## 1. 独立仓库三层套件

`pnpm run test`（在 D:\Projects\TraeProjects\dsh-anic 下执行）：

| 层 | 结果 | 耗时 |
|---|---|---|
| validate（DSH 规范符合性门） | ✅ PASS | 0.2s |
| vitest（单元 + 契约守卫） | ✅ PASS（31 文件 / 380 用例，与迁移前一致） | 7.3-8.4s |
| smoke（机制冒烟，stub 宿主） | ✅ PASS（20 检查，含 SVG 169/217、刷新唯一、三动作、flag-off） | 0.1s |

辅助验证：
- `node scripts/typecheck.mjs` → exit 0
- `pnpm run build` → dist/client.js + dist/host.js + host-esm/index.js 173.65 kB（gzip 46.32 kB）
- `pnpm run snapshot` → nodes=169 edges=217 cycles=64 ledgerEntries=79 incidents=3, autonomy=L4（workspace: dsh-codegraph-visualizer）

### smoke 惰性回归事件（已知陷阱重现，当场处置）

快照重生成（workflowGraphData.ts 169/217）后未先 rebuild 直接跑 smoke → 4 FAILURE（旧 138/164 数据 + 红圈 0/1）。rebuild 后 ALL PASS。证明「smoke 读 dist 对 src 变更惰性」陷阱的真实性——冒烟必须在 build 之后。

### governance flake 修复验证

`tests/unit/governance.test.ts` 修复前：独立跑 5/5 绿、满载并发跑偶发 1 红（NTFS 时间戳量化边界：`tmpMaxAgeMs:-1` 下 mtime 可比 Date.now() 晚 ~15.6ms）。修复后（utimesSync 钉 60s 前 + `tmpMaxAgeMs: 30_000`）：满载并发跑 0 红。

## 2. J0 真实宿主探针（8/8 × 三场景）

环境：`node scripts/start-dsh-test.mjs start` 从新仓库启动 → DSH PID 52392 / Chrome 45432 / 端口 3080。

| 场景 | 前置构造 | 结果 |
|---|---|---|
| A 残留开关自愈 | localStorage['anic-workflow-tab']='off' 残留（上轮探针被截断终止的现场） | `[清理] 检测到残留 kill-switch…` + **8/8 PASS** |
| B 空态兜底 | 全新 profile「新会话」空态（无 conversation view） | `[兜底] 无打开会话——已代开既有会话「anic技能」` + **8/8 PASS** |
| C 常规 | 已打开会话视图 | **8/8 PASS** |

八项判据全过：J0-1 标签可见 / J0-1b 标签共存（4 标签）/ J0-2 图渲染（svg=true circles=169 lines=217，与遥测一致）/ J0-3 遥测通道（registered=true）/ J0-4 来源如实（ANIC · live · 169 nodes / 217 edges）/ J0-5 热卸载恢复 / J0-6 kill-switch / J0-6b 开关恢复。

修复前对照：同页面 4/8 FAIL（J0-1/1b/2/4），由 Chrome DevTools MCP 手查证实标签实际存在——假失败。

## 3. 宿主路由级验证（新位置激活）

| 路由 | 状态 | 关键数据 |
|---|---|---|
| GET /anic/api/ledger | 200 | total=79（工作区账本全量） |
| GET /anic/api/self-check | 200 | 6 探针全 ok（P1 digest=bc0cba3ebcb4fa56） |
| GET /anic/org-status | 200 | cycles total=64 latest=cycle-98; ledger 79 valid |
| GET /anic/api/invocations/live | 200 | diagnostics 活（sessionEvents=3 toolsResults=2） |

## 4. 父仓库回归（删除嵌套 dsh-anic 后）

- `pnpm run typecheck` → exit 0（host+client+test 三 tsconfig）
- `pnpm run lint` → 0 warnings 0 errors（247 文件）
- `pnpm run test` → **5373/5373 passed**（Duration 68.65s）

## 5. 双 profile 指向验证

- web profile：package.json `"dsh-anic": "link:D:/Projects/TraeProjects/dsh-anic"` + junction Target 确认新路径
- desktop profile：同上（junction 一致性维护；其 bundles 数组本就不含 dsh-anic，见 CO-4）

## 6. 结论

迁移后两仓库全绿；J0 探针在三种前置场景下稳定 8/8；真实宿主从新位置正常激活并提供全部 18 路由。
