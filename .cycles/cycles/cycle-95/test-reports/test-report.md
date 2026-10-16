# cycle-95 测试报告

- **测试日期**：2026-10-16
- **测试环境**：Windows 11 · Node v24 · 真实 DSH 宿主 `scripts/start-dsh-test.mjs`（http://127.0.0.1:3080，CDP 9222，重启 3 轮：PID 50700/49100/48880）

## 1. 自动化测试（三层全绿）

| 层 | 命令 | 结果 |
|---|---|---|
| 类型 | `node scripts/typecheck.mjs` | exit 0 |
| 规范 | `pnpm run test` → validate | **PASS**（C1 type=module / C2 manifestVersion=1 / C3 platform=web / C4 inject 官方包 / C5 ./client 导出 / C6 exports keys / C7 i18n 键集对齐 / C8 icon 507B ≤256KiB） |
| 单元+契约 | 同上 → vitest | **Test Files 27 passed (27) / Tests 315 passed (315)**（基线 cycle-94：20 文件 / 235 用例） |
| 冒烟 | 同上 → smoke（stub 宿主加载 dist/client.js） | **ALL PASS**（exports.name=dsh-anic-client、inject=[slots]、def.id=anic-workflow-tab、order=101、SVG 圆点 138、边线 164、refresh 唯一、M1 工具栏三动作 buttons=3 prefs=1 selfInit=1、flag-off 零注册） |
| 构建 | `pnpm run build` | exit 0（host-esm/index.js 173.65 kB gzip 46.32 kB；dist/client.js + dist/host.js） |
| 父工程 | `pnpm run typecheck`（外来回滚处置后） | exit 0 |

## 2. 变异探针（守卫先红后绿，逐个记录）

| 守卫 | 变异 | 红/总数 |
|---|---|---|
| runtime.test.ts 包裹形态 | 恢复旧 loadLedger 裸数组实现 | 6/7 红 |
| orgStatusRender.test.ts | 恢复字符串实现 | 4/8 红 |
| shellTheme.test.ts | 恢复 `:root`+媒体查询形态 | 6/16 红 |
| panelLayoutContract.test.ts | 恢复 height:100%+overflow:auto | 3/7 红 |
| graphA11y.test.ts | 删键盘块 / FAIL dash=PASS / 删 approve 别名 | 7/10、1/10、1/10 红 |
| independenceGuard.test.ts | 父工程逃逸 import / 删排除 continue / 全排除 /.*/ | 1/8、1/8、3/8 红 |
| contrastContract.test.ts | 恢复浅 faint / 白字形墨 / 删 warn 深色覆盖 | 各 1/10 红（M3 首探因 CRLF 未命中静默绿 → 复探带 applied 断言） |
| runtime.test.ts（chainHead 残留） | serializeLedger 退化为只写 {entries}（丢 chainHead） | 2/30 红（append 保留 + 自愈两用例；HEAD 校验读盘不依赖写路径故不红，判定正确） |

## 3. 真实 DSH 宿主验证（目标 #7 网页端，重启后逐项实测）

- **账本（P0-LEDGER-SHAPE 修复证明）**：`/anic/api/ledger` → 200 `{total:63, entries:[…]}`（修复前 total:0）；`/anic/api/ledger/verify` → 200 `{ok:true,total:63,brokenAt:null}`；`/anic/org-status` → `"ledger":{"entries":63,"valid":true}` + 信任分恢复（G0 100% 16/16 … G3 100% 15/15）。
- **组织区（P0-ORG-STRING 修复证明）**：`[data-anic-org]` 5 个真 SECTION 子元素（`escapedMarkupInText:false`），h4 = Cycle 全景/信任分/自主级/带检测/流开关。
- **主题（P0-THEME-MISMATCH 修复证明）**：仿真 OS 深色被忽略（面板 light）；宿主 `body[data-ds-dark-theme]` 切换 120ms 内面板跟随（surface #f8fafc→#0f172a），还原后回浅色。
- **工具栏钉住（P0-STICKY-SCROLLPORT 修复证明）**：宿主滚动 0/500/2000/6000px 四点工具栏 y=76 恒定（修复前 76→-424→-1924→-5924）。
- **对比度（P1-A11Y-CONTRAST 修复证明）**：浅色 691 文本元素 0 违约（最差 4.6，恰为校准下限）；深色 480 元素 0 违约；字形墨 5.14:1（PASS 绿底）/5.17:1（FAIL 红底）；节点详情 result 文本色 = 文本级令牌 rgb(43,130,59) 而非填充级。
- **桌面标记仿真**：`data-platform=darwin`（含 4 个 --dsh-frame-* 变量全写）与 `data-windows-titlebar` 两套写入-测量-还原，工具栏几何不变、按钮无裁剪、无标题栏重叠；还原确认（platform:null）。
- **响应式**：502×732 视口工具栏 439px、三按钮 right≤485 全在视口；CSS 强制 240px 工具栏按钮仍不裁剪；200px 状态文本换行不裁剪。
- **路由族**：/anic/cycle/list、/anic/api/self-check（6 探针 PASS，digest d84cc527…）、/anic/skill/list、/anic/api/stack-probe、/anic/api/workflow-snapshot 均 200。

## 4. 事件与回归

- 外来回滚（08:55:39，37 文件）处置后：父工程 typecheck exit 0 复验；stash@{0} + patch（408,483 B）双保全；本仓库 HEAD 历史零污染（本会话提交不含任何外来内容）。
- 历史泄漏清除：`tests/tmp-native/` 87 文件删除；`git ls-files tests/tmp-native` = 0；复跑 Test-Path = False（零新增）。

## 5. 门禁结论

G0 PASS（评估收敛，事实基座为真实测量+数值审计）· G1 PASS（任务行 15/15 完成）· G2 PASS（三层全绿 + 8 组守卫探针证明）· G3 PASS（交付清单完备）。

**账本记录**：四条门禁经正典写入者 `lib/ledger.mjs` 追加进 `.cycles/gates/ledger.json`（63 → 67 条）。追加后双验证器复核：技能脚本严格侧 67 条仅剩 index 0 文档化 genesis 断链（历史形态，docs/anic/05 §134）；插件侧（genesis 豁免设计）`{ok:true,total:67,brokenAt:null}`。
