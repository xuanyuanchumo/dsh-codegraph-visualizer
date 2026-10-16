# cycle-98 测试报告

> 2026-10-16 14:15（UTC+8） · 环境：Windows / Node 22 / pnpm · 范围：dsh-anic 全量三层 + 变异探针 + 真宿主端到端

## 1. 静态层

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `node scripts/typecheck.mjs` | ✅ TYPECHECK OK（tsconfig.client + tsconfig.host，0 错） |
| 构建产物 | `pnpm run build` | ✅ dist/client.js + dist/host.js（tsdown ESM + wrap-client-bundle） |

## 2. 单元 + 契约层（vitest）

`npx vitest run` → **Test Files 31 passed (31) / Tests 380 passed (380)**（cycle-97 末 30/368；本轮 +1 文件 +12 用例）。

新增/扩展用例明细：

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| tests/contract/toolOutputContract.test.ts（新） | 7 | render 返回数组非字符串；每块 {type:'text', text:string}；text 可 JSON.parse 无损还原；schema object-rooted；undefined→null 兜底；反向自检；tools 域零裸字符串 render 源码扫描 |
| tests/unit/invocationFeed.test.ts（扩） | 19→24 | recordResult 返回结算布尔（命中/终态后/无开始三面）；五计数器混合序列；diagnostics() 副本隔离；空流+计数>0 的「到达被过滤」证据；**信封回归锚（P0-FEED-ENVELOPE）**；路由响应携带 diagnostics（接线/null 两面）；全部 fixture 转录真实信封 {type,seq,time,data} |

## 3. 三层汇总（pnpm run test）

| 层 | 结果 | 耗时 |
|---|---|---|
| validate（DSH 规范符合性门 C1-C12） | ✅ PASS | 0.2s |
| vitest（单元 + 契约守卫） | ✅ PASS | 7.4s |
| smoke（stub 宿主机制冒烟，20 检查） | ✅ ALL PASS | 0.1s |

## 4. 变异探针（全部红 → 恢复绿，恢复后源码字节级复核）

| 探针 | 变异内容 | 结果 |
|---|---|---|
| M1 | makeToolOutput render 退回裸字符串（`JSON.stringify(value)` 直返） | **3 failed** \| 4 passed → 红 ✅ |
| M2 | 删五处 diag.*++ 递增（诊断形同虚设） | **4 failed** \| 19 passed → 红 ✅ |
| M3 | payload 退回扁平形状读取（`event as {callId…}`，P0-FEED-ENVELOPE 旧缺陷） | **6 failed** \| 18 passed → 红 ✅ |

## 5. 真宿主端到端（./scripts/start-dsh-test.mjs，Step-5-Preview 免费模型）

三轮验证（restart × 2，认证 URL 轮换）：

1. **P0-A 修复生效**：模型调用 anic_status → 完整结果报告（信任分 G0-G3、自主级 L2/L3、带检测 normal、流开关、最近 skill 调用 eval-runner 明细、技能健康度），**零 content.some 错误**。
2. **P0-B 根因暴露**（修复前诊断读数）：`{sessionEvents: 11, sessionToolCalls: 1, toolsResults: 5, anicCalls: 0}` —— 事件到达但被信封过滤。
3. **P0-B 修复生效**（信封修复 + rebuild + restart 后）：`{sessionEvents: 11, sessionToolCalls: 1, toolsResults: 3, anicCalls: 1, anicResults: 1}`，feed `total:1`，`{name:'anic_status', status:'done', durationMs:10, turn:12, step:1, argumentsPreview:'{}'}`。
4. **客户端面板**：ANIC 标签渲染「实时调用（动态白盒）：1 条 · 快照 …」+ 卡片 `anic_status 完成 10ms t12/s1 {}`；2s 轮询时间戳持续更新；视觉截图取证。

## 6. 结论

三层全绿 + 三组变异探针红→绿 + 真宿主免费模型端到端闭环（工具执行 → 事件流 → feed 配对 → 面板渲染）全部通过。G2 测试收敛门 PASS。
