# 门禁账本

| 门禁 | 结果 | 时间 | 详情 |
|------|------|------|------|
| G0 | PASS | 2026-09-14T12:19:51.540Z | Test with new structure |
| G0 | PASS | 2026-10-05T00:00:00.000Z | 评估报告与事实基座抽验通过（cycle-78） |
| G1 | PASS | 2026-10-05T00:00:00.000Z | 任务清单 T14-1..T14-12 全登记，L1-L6 已登记为下轮候选 |
| G2 | PASS | 2026-10-05T00:00:00.000Z | 179 files / 4903 tests passed; typecheck host+client+test 0 errors; mutation 12/12 red |
| G3 | PASS | 2026-10-05T00:00:00.000Z | build exit 0 (worker 1527487 B); lint 0 warnings 0 errors (239 files); hygiene 19 artefacts / 7 roots, payload 11.23 MB |
| G0 | PASS | 2026-10-05T04:57:07.845Z | 评估报告与事实基座抽验通过（cycle-79：跨工作区图负载污染 P0） |
| G1 | PASS | 2026-10-05T04:57:07.845Z | 任务清单 T15-1..T15-10 全登记完成，L1-L7 已登记流转至 cycle-80 |
| G2 | PASS | 2026-10-05T04:57:07.845Z | 181 files / 5035 tests passed (HEAD baseline 181/5012, +23); typecheck host+client+test 0 errors; mutation 14/14 + 26/26 red |
| G3 | PASS | 2026-10-05T04:57:07.845Z | build exit 0 (client.js 2.38 MB, worker 1527487 B); lint 0 warnings 0 errors (243 files); hygiene 19 artefacts / 7 roots, payload 11.37 MB; perf-gate PASS |
| G0 | PASS | 2026-10-05T06:40:47.052Z | 评估报告与事实基座抽验 6 条通过（cycle-80：跨工作区守卫结构性收口 P0-R16-01） |
| G1 | PASS | 2026-10-05T06:40:47.161Z | 任务清单 T16-1..T16-12 全部完成；9 条流转项已登记去向（L1 关闭候选、L5 文档澄清、L2/L3/L4/L6/L7 + host 单槽 + P3-R16-02 → cycle-81） |
| G2 | PASS | 2026-10-05T06:40:47.264Z | 184 files / 5052 tests passed (HEAD baseline 181/5035, +3 files / +17 tests); typecheck host+client+test 0 errors; lint 0 warnings 0 errors (244 files); mutation 16/16 + 26/26 red; J0 8/8 journeys |
| G3 | PASS | 2026-10-05T06:40:47.932Z | build exit 0 (client.js 2496405 B, worker 1527487 B); hygiene 19 artefacts / 7 roots, payload 11.38 MB; perf-gate PASS (client 2.39MB/3MB, host 194KB/512KB, tests 5052/4463); J0 release bundle verified |
| G0 | PASS | 2026-10-05T09:17:41.111Z | cycle-81: 评估报告与事实基座抽验 8 条通过（E2E 选择器单一事实源 + dev-server 桩图统一 P0） |
| G1 | PASS | 2026-10-05T09:17:41.217Z | cycle-81: 任务清单 T17-1..T17-17 全部完成；10 条流转项已登记去向（L2/L3/L6/L7 + host 单槽 + P3-R16-02 + P3-R17-01 + P2-R17-01） |
| G2 | PASS | 2026-10-05T09:17:41.312Z | cycle-81: 185 files / 5060 tests passed (HEAD baseline 181/5035); E2E smoke 57 passed / 0 failed (2.9 min); typecheck 0 errors; lint 0 warnings 0 errors (244 files); mutation 26/26 + 16/16 red; 3 guard mutations red as expected |
| G3 | PASS | 2026-10-05T09:17:41.414Z | cycle-81: build exit 0 (client.js 2505499 B measured; Round-16 baseline rebuilt from 0cdf734 = 2505159 B, +340 B/+0.014%; worker 1527487 B); hygiene 19 artefacts / 7 roots, payload 11.38 MB; perf-gate PASS (client 2.39MB/3MB, host 194KB/512KB, tests 5060/4463) |
| G0 | PASS | 2026-10-05T10:43:20.078Z | cycle-82: 评估报告与事实基座抽验 **10 条**全部真实存在（`computeGraphEtag`/`GraphEtagResource` 于 `src/shared/graphFingerprint.ts`；6 处 `returnIfEtagMatch` 均带资源名；`dataRoutes.ts:73` 的 etag 与 `:68` 的校验同源；`HttpHelpers.ts` expose 头；`sessionSlice.ts:14` `graphEtag: null`；`types.ts` `graphEtag` 字段；`SSEEvents.ts:48`/`WindowEvents.ts:26` 发 `store.graphEtag`；契约测试 4 条；变异锁 28 条） |
| G1 | PASS | 2026-10-05T10:43:25.820Z | cycle-82: 任务清单 T18-1..T18-16 全 ✅；P0-P3 段无未登记项；**11 条**流转项均写明去向与门禁影响（含本轮新增 P3-R18-01 英文注释 / P1-R18-01 对齐报告 P1-2/P1-4 / P2-R18-01 三层独立面板 / P3-R18-02 五条路由 200 不发 etag） |
| G2 | PASS | 2026-10-05T10:43:25.894Z | cycle-82: **185 files / 5086 tests passed**（0 failed / 0 errors；cycle-81 为 5060，**+26**）；typecheck host+client+test 0 errors；lint `0 warnings and 0 errors`（244 files / 103 rules）；E2E smoke **57 passed / 0 failed**（2.6 min，exit 0）；`cross-workspace-guard-mutations.ps1` **28/28 全红 + restored verbatim OK**（exit 0）；`incremental-update-mutations.ps1` 26/26；J0 真机 **13 项可判别观测**全部符合预期 |
| G3 | PASS | 2026-10-05T10:43:25.965Z | cycle-82: build exit 0（`client.js` 2506859 B vs 基线 2505499 B = **+1360 B/+0.054%**；`index.js` 202364 B vs 198784 B = +3580 B/+1.80%；`index.esm.js` 2323522 B；`index.css` 157984 B；worker 1527487 B）；hygiene 19 artefacts / 7 roots、payload **11.39 MB**；perf-gate 全 PASS（client 2.39MB/3MB、host 198KB/512KB、tests 5086/4463）；真机标签栏同级注册与画布渲染链路未回归 |
