# cycle-96 测试报告

> 测试日期：2026-10-16 · 范围：父工程 + dsh-anic 双侧 · 基线提交：96feb75 / 8941b41

## 1. 自动化测试基线

### 父工程 dsh-codegraph-visualizer

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck`（host+client+test 三 tsconfig） | exit 0 |
| 单元/组件测试 | `pnpm run test`（vitest） | **197 文件 / 5373 用例全过**，exit 0，Duration 77.83s |
| Lint | `pnpm run lint`（oxlint src/） | 0 warnings 0 errors（247 文件 / 103 规则） |

### dsh-anic 插件工程

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `node scripts/typecheck.mjs` | exit 0 |
| DSH 规范符合性门 | `pnpm run lint`（validate-dsh.mjs） | PASS |
| 单元 + 契约测试 | `npx vitest run` | **27 文件 / 331 用例全过**（cycle-95 基线 26/303 → +1 文件/+28 用例） |
| 机制冒烟 | `pnpm run test` 第 3 层（offline-smoke.mjs，stub 宿主） | 20/20 PASS |
| 构建 | `pnpm run build` | exit 0（host-esm 173.65 kB / gzip 46.32 kB + dist/client.js） |

三层汇总：`validate 0.3s ✅ / vitest 25.7s ✅ / smoke 0.1s ✅ → ALL GREEN`。

## 2. 变异探针记录（本轮 4 项，全部先红后绿）

| 探针 | 变异内容 | 结果 | 恢复后 |
|---|---|---|---|
| 工具字段名 | anic_evaluate 退回 inputSchema/handler | 红：`缺 parameters` + `缺 execute` | 11/11 绿 |
| eval 解析器 | parseEvalScore 退回 `Overall score:` 正则 | 红 4 用例（真实格式全灭） | 23/23 绿 |
| gate 解析器 | parseGateVerdict 退回 `GATE: PASS` 正则 | 红 5 用例 | 23/23 绿 |
| chainHead | serializeLedger 丢 chainHead 字段 | 红 2/30 | 绿 |

解析器变异合计 9 红（eval 4 + gate 5，含全部真实格式转录用例与防倒退用例）。

## 3. 真实宿主验证（J0 探针 + HTTP 路由 + 用户旅程）

环境：`node scripts/start-dsh-test.mjs start`（重启后 DSH PID 53852 / Chrome PID 2952，端口 3080 + CDP 9222）。

### J0 探针（8/8 全绿，修复作用域后）

```
[PASS] J0-1 标签可见  role=tab "ANIC" 可见
[PASS] J0-1b 标签共存  顶层标签数=3（≥2 才算共存）
[PASS] J0-3 遥测通道  registered=true registerCount=1
[PASS] J0-2 图渲染  svg=true circles=154 lines=190 遥测 nodes=138 edges=164
[PASS] J0-4 来源如实  ANIC · live 2026-10-16T03:59:35.726Z · 154 nodes / 190 edges
[PASS] J0-5 热卸载/恢复  before=true unregistered=true(count=1) reregistered=true(count=2)
[PASS] J0-6 kill-switch  skipped="flag-off" anicTabGone=true
[PASS] J0-6b 开关恢复  移除开关并 reload 后 registered=true
J0 PROBE PASSED — 8 checks
```

注：J0-2/J0-4 修复前在重启宿主上假阴性（宿主图标 svg 71 个排在文档序前面；宿主文本含 snapshot 字样）——8941b41 收窄作用域到 `[data-anic-workflow]` 后全绿。

### HTTP 路由（7 条全 200）

| 路由 | 状态 | 关键内容 |
|---|---|---|
| /anic/api/ledger | 200 (41231 B) | total=67（cycle-95 G0-G3 已入账） |
| /anic/api/self-check | 200 | 6 探针全 ok（P1 digest=b3ed5f38…） |
| /anic/self/status | 200 | {IDLE, round 0, maxRounds 3} |
| /anic/skill/list | 200 | 15 scripts |
| /anic/api/stack-probe | 200 | node / build_cmd / test_cmd |
| /anic/org-status | 200 | cycles total=61, latest cycle-95, converged 20, failed 5, ledger entries=67 |
| /anic/cycle/list | 200 | {cycles:[95], nextCycleNumber:96} |

### m02105 用户旅程（FreeRoute 免费模型 · 判别矩阵）

1. 轮 1-6（10:39-10:55）：所有提供商（DeepSeek V4 Flash free / MiMo v2.5 free / DeepSeek-V41-Flash / ⚡Auto）对评估请求与裸「你好」全部 STREAM_CLOSED；**禁用 ANIC 插件后 reload（tab 消失）仍 STREAM_CLOSED** ⇒ 提供商侧故障，插件无关。
2. 轮 7（11:01，Step-5-Preview 免费恢复）：流 67 tok/s；禁用窗口内模型如实报告工具不存在（当时的真实状态）。
3. 重新启用插件（开关 true → reload → tab 恢复）。
4. 轮 8（11:08）：模型列出全部工具——**12 个 anic_* 全部在场**（anic_bootstrap, anic_bootstrap_analyze, anic_bootstrap_cycle, anic_evaluate, anic_gate_check, anic_hitl, anic_install, anic_iterate, anic_self_check, anic_skill, anic_snapshot, anic_status），anic_evaluate 描述「Evaluate a project using the ai-native-iteration-cycle skill (eval-runner)」参数 dimensions、workspace 正确投影；模型自我纠正前一轮的「工具不存在」。
5. 轮 9（11:10）：模型**真实调用 anic_evaluate**（工具卡片 anic_evaluate · {}）→ eval-runner.mjs 真实执行 → `.cycles/cycles/cycle-95/项目评估报告.md` 609,260 B 落盘（mtime 11:12:54）。副作用 band-history.json 已还原。

**结论**：旧报错根因已修复（三层证据）；dsh-anic 插件不影响大模型正常工作。

## 4. 解析器真实行为验证（scriptParsers）

- `node gate-check.mjs <tmp> --gate all`（无 config.yml）→ exit 1 + stderr「No .cycles/config.yml found…」（非门禁裁决）→ parseGateVerdict='unknown'（忠实报告，fail-closed）。
- 补 config.yml + cycles/cycle-1/ → stdout `[FAIL] G0: No evaluation report` … `[FAIL] G3: Build failed` + stderr `Gate check FAILED.` → parseGateVerdict='FAIL' 路径实测覆盖。
- runSelfBootstrapCycle 端到端用例断言真实裁决（evalScore=0、gateVerdict='unknown'）。

## 5. 回归矩阵（每项修复后全量重跑）

| 修复 | typecheck | vitest | smoke | build |
|---|---|---|---|---|
| P0-TOOLS-FIELDS | 0 | 27 文件/331 用例 ✅ | 20/20 ✅ | exit 0 |
| P0-BOOTSTRAP-PARSER | 0 | 27/331 ✅（bootstrapOrchestrator 23/23） | ✅ | exit 0 |
| P1-CHAINHEAD | 0 | 27/331 ✅ | ✅ | exit 0 |
| J0 探针修复 | — | — | — | J0 8/8 ✅ |

## 6. G0-G3 门禁自评

- **G0 评估收敛**：PASS（评估报告 + 判别矩阵 + 三层变异探针记录）。
- **G1 任务完成**：PASS（任务清单 6/6 本轮任务完成，携带项全部 P2/P3）。
- **G2 测试报告**：PASS（本文件）。
- **G3 构建可用**：PASS（双侧 build exit 0 + 真实宿主 7 路由 200 + J0 8/8）。
