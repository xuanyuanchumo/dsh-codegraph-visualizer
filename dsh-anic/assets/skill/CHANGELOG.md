# Changelog — ai-native-iteration-cycle

## 1.9.0 — 门禁完整性：三态裁决 + 漂移守卫（iteration-5）

### 裁决完整性（行为变更）

- `eval-runner.mjs`：**引入三态裁决 PASS / FAIL / SKIP**。原先"无法评估"（缺主题 / 缺证据 /
  手工项）一律返回 `{ pass: true, detail: '…(skipped)' }`——评估器对**没评估过**的东西记 PASS，
  这正是 fail-open 的入口（屏幕上"没评估"和"评估通过"长得一模一样）。现在统一走
  `skipped()` → `{ pass: false, skipped: true }`；`combine()` 在合取里**传播** SKIP
  （任一 FAIL ⇒ FAIL；无 FAIL 但有 SKIP ⇒ SKIP），不再被外层吞掉；报告行写 `SKIP`；
  退出码只由 FAIL 决定（SKIP 不阻塞运行，否则文档型项目永远跑不完）但**响亮列出**。
- `eval-runner.mjs` 附带三处：`.env` 存在而项目无 `.gitignore` 时 E6 不再静默跳过；
  手工项（无基线工件）不得记 PASS；继承既有报告行时保留三态（否则 SKIP 在下次部分
  运行时被读成 FAIL）。
- `gate-check.mjs checkQualityGate`：**行缺失 / SKIP 不再等于通过**。原先正则只拦 `FAIL`，
  报告缺 Q1/Q5 行（match=null）或写 SKIP 都静默通过——质量门禁**无证据即可关门**。
  现在报 `not evaluated — gate cannot close without evidence`（判 FAIL）。
- `gate-check.mjs checkG0`：存在性 → 完整性（空报告、只有标题的报告不再算"已评估"）。
- `gate-check.mjs checkG2`：报告格式本身是契约（见 `assets/templates/test-report.md` §2
  汇总表），缺表格不再按"0 失败"判 PASS。

### 漂移守卫（新增，错误级）

- `quick-validate.mjs` 新增四类机器守卫。四轮进化里这些漂移每轮都要人工 grep 重扫，
  而且每轮都能扫出新的一层（人读文档 → agent prompt → 机器 schema/hook）：
  1. **版本一致性**：`SKILL.md` 的 `MCP Tools (vX)`、`mcp-server.mjs` 的 Server version、
     `CHANGELOG.md` 顶层条目三处必须一致；锚点找不齐即报错（守卫必须能失败，否则会随
     被守卫物一起消失）。
  2. **配置入口唯一**：脚本代码内不得出现 `.cycles/cycle-config.yml`（唯一豁免
     `lib/config.mjs` 兼容层）；样例字面量按字符串拼接构造，守卫不匹配自身源码。
  3. **原子写**：`lib/fs-safe.mjs` 之外不得直接调用 `writeFileSync(`；另报"死 import"警告。
  4. **词表漂移**：B 族旧维度名只在**与维度编号绑定**的上下文中判罚（同行含 `E1-E8`/`Q1-Q8`
     或 `name:` 绑定）——过宽的规则会把"技术债务"这类正常概念误判成漂移，那正是
     "守卫变成噪音、然后被忽略"的路径。豁免 `references/evaluation.md`（弃用声明本身
     必须提到旧名）与 `CHANGELOG.md`（历史）。

### 词表漂移清零（23 处）

守卫首次运行即抓出 23 处真实残留，全部修正：`assets/templates/eval-report.md`（E1-E8 表）、
`references/project-config.md`（evaluation 段 8 项）、`references/playbook.md`（5 行评估步骤）、
`references/state-transition.md`（G0/G2/G3/H4 的 Q 名）、`references/troubleshooting.md`
（示例改为 E1 意图对齐 / E3 测试覆盖）。

## 1.8.3 — 剩余脚本收口：账本不可变 + 反模式全清（iteration-4）

### 账本完整性（行为变更，P0）

- `archive-cycle.mjs`：**归档不再删改账本条目**。原先按 detail 是否含 `cycle-N` 过滤 entries
  并整文件重写——被删条目之后每条 entry 的 previousHash 都指向已删除条目，下一次
  verifyLedger 必报 CHAIN_BREAK（归档动作本身毁掉整条链）。改为只移动目录，
  账本永不触碰（INV-9：归档不改账本链，docs/anic/05 §4.3 / 08 §3.5）。
- `hitl-audit.mjs` attemptH4Fix：**不再原地改写 entry.detail**。entry 的 hash 覆盖 detail
  字段，改写即 HASH_MISMATCH（"修复"自毁链）。缺失证据必须以新条目补充
  （重跑 `gate-check --record` 或 `gate-ledger append`），历史记录不可变。

### 反模式全清（S-6 字典序/非原子写家族的最后一轮）

- 字典序收敛：`auto-fix-loop.mjs` / `hitl-audit.mjs` / `archive-cycle.mjs`（列表形态 ×2）/
  `workflow-state.mjs` / `org-status.mjs`（连续失败统计 ×1 + 评审摘要 ×1）→ `lib/cycle.mjs`
  新增 `listCycleDirNames()`（数值序列表）。fact-base-verify / plan-sync-check 的
  全目录遍历与顺序无关，不改。
- 原子写收尾：auto-fix-loop（审计日志 ×2/事故/报告）、hitl-audit（审计日志 ×2/事故/
  gitignore/审计表头）、workflow-state（saveState）、org-status（agent 配置/CB3 gitignore）、
  init-workflow（模板/补丁名/仓库记忆 ×3）、init-cycle（模板 ×1）→ `lib/fs-safe.mjs`。
- 配置单入口补齐：auto-fix-loop / hitl-audit 的本地 loadConfig → `lib/config.mjs`
  （缺配置响亮告知；auto-fix-loop 允许 `--test-cmd` 兜底继续）。
- **新增 `lib/tasks.mjs`**：P0-P3 任务表行解析唯一实现。`archive-cycle isCycleComplete`
  原先用整文件 `includes('待办')`（与 G1 修复前同一模板自陷家族），现与 gate-check G1
  共用同一解析器——消灭"G1 说完成、归档说没完成"的分叉。

## 1.8.2 — MCP 面 / hooks 面 / 引用面收口

### 脚本与 hooks（行为变更）

- `scripts/mcp-server.mjs`：`gate_check` 工具补 `record` 输入属性并转发 `--record`
  （**v1.8.0 的记账能力此前经 MCP 不可达**——按 SKILL.md L4 链走 MCP 的 agent 会漏记 FAIL，CB2 熔断失明）。
- `assets/hooks/production-gate.sh` 三处：
  1. `set -e` 下裸 `node gate-check` 失败即终止，`GATE_RESULT=$?` 与定制 FAIL 提示是死代码 → `|| GATE_RESULT=$?` 显式捕获；
  2. `sort` 字典序选最新循环（cycle-10 与 cycle-9 并存时选错）→ `sort -V`（与 gate-check 字典序缺陷同族）；
  3. 交付清单名 `交付检查清单.md` 是第三种拼法（init-cycle 与 multi-agent-gate 均用 `交付清单.md`）→ 对齐 `交付清单.md`。

### 文档与评测（无行为变更）

- `references/evaluation.md`：eval-runner 输出路径/文件名修正（`.cycles/cycles/cycle-{N}/项目评估报告.md`；
  旧文档的 `.cycles/cycle-{N}/eval-results.md` 两处都错）。
- `references/gates.md`：门禁流转一节补 `--record` 自动登记语义（FAIL 也记，CB2 依赖）。
- `README.md` 快速启动第 5 步补 `--record`。
- `evals/trigger-eval.json`：第 7 条查询的"E3 技术债务"改"E7 文档同步"（旧 B 族词表残留）。

## 1.8.1 — 评测面与引用文档收口（无脚本行为变更）

### 文档

- `references/scripts-reference.md`：gate-check 参数表补 `--record`（去重 + FAIL 也记 + CB2 依赖说明）。
- `references/auto-cycle.md` Phase 5：门禁行改 `--gate all --quality --record`；"全部通过 → 记录到 gate-ledger"
  更正为"门禁记录已在 --record 时写入账本"（原描述与 1.8.0 的自动记账机制矛盾——按旧文档走会漏记 FAIL）。
- `references/state-transition.md` 常用命令表：gate-check 行补 `--record`。

### 评测

- `evals/evals.json` 7 → **10 条**：新增 id8（G1 任务表行解析 + `--record` 去重，对应契约场景 G1/R1）、
  id9（纯中文 intent 通过意图门，对应 W1）、id10（空账本 verify 显式注记，对应 V1）——
  技能自带评测面自此与 15 场景契约套件对齐。

## 1.8.0 — 结构进化 iteration-2（修 N-1/N-2/N-3/N-4/N-5/N-6/N-7/N-8a/N-9/N-11）

> 进化依据：端到端 A/B 评测（`docs/anic/10-技能进化记录.md` §4）暴露的 10 处发现中，
> 取高价值且低风险的 8 项修复；关键词计数评审的语义局限（N-10）按设计保留到插件层解决。

### 修复

- **N-1 G1 模板自陷**：`gate-check` 的 G1 原对 `任务清单.md` 整文件 `includes('待办')||includes('进行中')`
  ——模板自带的状态约定图例（"待办 → 进行中 → 完成"）永远触发 FAIL，必须手删图例才能过门。
  现解析 P0-P3 任务表行（首列非空且末列为状态值的行）：无任务行报
  `No task entries found`，有行则按未完成数判定 `N of M tasks not completed` / `All N tasks completed`。
  模板图例不再参与判定（`assets/templates/task-list.md` §7 同步改写）。
- **N-2 门禁结果不入账本**：`gate-check` 新增 `--record`——每次判定结果经 `lib/ledger.appendEntry`
  写入账本（带去重：同门最新一条 result+detail 相同则跳过并提示 `unchanged, not re-recorded`，
  防重复运行污染链；FAIL 也记录，`org-status` CB2 熔断依赖 FAIL 记录）。
  SKILL.md L4 链同步改为 `gate-check.mjs --gate all --quality --record`。
- **N-3 中文词数低估**：`multi-agent-gate` 的 `countWords` 原按 `\s+` 切词，纯中文意图文档按空格切
  只得 1-3 个"词"，永远过不了 50 词门槛。现中文按字计数（CJK 区段），非中文按词计数。
- **N-4 快速启动缺步骤**：SKILL.md 快速启动补第 7 步 `init-cycle.mjs`（此前漏写，
  直跑 `eval-runner` 必报 No cycle directory）。
- **N-5 troubleshooting 路径错误**：`.cycles/cycle-{N}/` → `.cycles/cycles/cycle-{N}/`（3 处），
  G1 症状段按新判定重写。
- **N-6 `--name` 不落盘**：`init-workflow --name <n>` 现写回 `config.yml` 的 `project.name`。
- **N-7 模板清单漂移**：`scripts-reference.md` 的 init-cycle 模板 5 → 7 个
  （补 交付清单.md、非功能验证报告.md）。
- **N-8a 评估报告覆盖**：`eval-runner` 部分维度运行（`--dimensions`/`--quality`）时不再整文件覆盖
  既有报告，未运行维度从既有报告行继承（输出 `merged: N dimension(s) inherited`）。
- **N-9 空账本误导**：`gate-ledger --verify` 空账本时在 `Valid: YES` 后加注记
  `ledger is empty — no gate results recorded yet. "Valid" only means no tampering.`
  （"没被篡改"不再冒充"跑过门禁"；N-8b 空账本放行问题由 N-2 的 --record 从源头补记录）。
- **N-11 计数歧义**：`multi-agent-gate` Result 行 `PASS (3/2)` →
  `PASS (3/3 agents, threshold 2)`。

### 测试

- 契约套件 11 → 15 场景（新增 G1/W1/R1/V1），新旧两版各 15/15 通过：
  新版全部按新契约，旧版复现全部缺陷（含旧版 `--gate bogus` → NaN 信任分 + exit 0）。

## 1.7.0 — 结构进化 iteration-1（修 S-1/S-2/S-5/S-6/S-7/S-10/S-11）

> 进化依据：`docs/anic/09-结构优化与逻辑重构设计.md`（结构缺陷 S-1..S-11 取证）。
> 本轮不新增功能，只消灭结构性缺陷；所有 CLI 输出格式保持向后兼容。

### 新增：共享库 `scripts/lib/`（词表与机制单一来源）

- `lib/config.mjs` — 唯一配置入口 `loadProjectConfig`：canonical `.cycles/config.yml`，
  旧名 `.cycles/cycle-config.yml` 兼容读取但打印弃用告警；缺文件响亮失败（错误提示指向正确文件）；
  `getYamlString`/`getYamlInt` 引号容错 + 行尾注释剥离；`getAutonomyLevel` 引号容错。
- `lib/dimensions.mjs` — E1-E8/Q1-Q8 16 维注册表（id→名称唯一来源）+ `resolveDimensions`
  （未知维度抛 `UNKNOWN_DIMENSION` 并列出合法值）。
- `lib/ledger.mjs` — 账本 load/save/appendEntry/verifyLedger 唯一实现；
  `saveLedger` 原子写（temp+rename）；entry 六字段键序不变（既有账本哈希链完全兼容）。
- `lib/cycle.mjs` — `getLatestCycleDir` 数值序取最新 cycle（修 `cycle-9` > `cycle-10` 字典序缺陷）。
- `lib/fs-safe.mjs` — `atomicWriteFileSync`。

### 修复

- **S-1 配置发现路径漂移**：`init-workflow` 只创建 `.cycles/config.yml`，而 `eval-runner` /
  `gate-check` / `band-detector` 原先读的是从不存在的 `.cycles/cycle-config.yml`
  （缺文件时 eval-runner 静默返回空 → 测试维度恒 FAIL、
  lint/build 维度恒 PASS；gate-check exit 1 且错误提示自相矛盾）。现统一走 `lib/config.mjs`。
- **S-5 信任分伪造验证**：`multi-agent-gate` release 门 gatekeeper 原以 `existsSync(ledger.json)` 冒充
  "ledger verified"（篡改/断链账本照样放行）。现调用真 `verifyLedger` 链校验，detail 记录
  `ledger chain verified (N entries)` / `ledger-chain-broken(HASH_MISMATCH,…)`，agent 结果带
  `source: deterministic-chain-verify`。
- **S-6 非原子写**：账本/报告/状态写入全部改 `atomicWriteFileSync`（崩溃不再留下半截 JSON）。
- **S-7 自主降级正则改写**：`org-status auto-fallback` 原以 `content.replace(/autonomy_level:\s*L4/…)`
  改写配置——引号写法 `autonomy_level: "L4"` 时正则不匹配 → 配置保持 L4 但日志/事故记录称"已降级"；
  且降级成功与否与记录解耦。现走 `applyAutonomyDowngrade`：引号容错匹配 → 原子写 → **回读再解析**
  （Post-Verify），事故记录按回读事实写；写不生效时记录 `HUMAN INTERVENTION REQUIRED IMMEDIATELY`。
- **S-11 未知标识符静默丢弃**：`eval-runner --dimensions E9` 原静默过滤（空集 → exit 0）；
  `gate-ledger --gate G9` 原把任意字符串写进哈希链；`multi-agent-gate --gate bogus` 原打印错误后
  `continue` → 空结果 → NaN 信任分 + exit 0。现全部 exit 1 并列出合法值。
- **S-8 正则即接口（部分）**：build/test/lint/complexity_budget/autonomy_level 解析统一收敛到
  `lib/config.mjs`（各脚本不再各写一份正则）。
- **字典序缺陷**：`eval-runner` / `gate-check`（G0/G1/G2/质量门）/ `multi-agent-gate` 取最新 cycle
  统一走 `lib/cycle.mjs` 数值序。

### 文档对齐（S-2 / S-10）

- `references/evaluation.md`：E 维词表对齐声明（注册表 A 族名称唯一有效，B 族旧称废弃）；
  报告示例表改用注册表名称。
- `references/quality-review.md`：Q→E 映射表改用注册表名称。
- `assets/config/config.example.yml`：evaluation 段名称与注册表对齐。
- `SKILL.md`：L4 操作链补入 `band-detector.mjs`（S-10：原先不在自动化链上）；
  新增"结构契约"节；版本 v1.5.0 → v1.7.0（与 mcp-server 1.6.0 漂移一并收口）。

### 行为变更（有意，响亮失败原则）

- 缺 `lint_cmd` / `build_cmd`：由 `{pass:true, '(skipped)'}` 改为 **FAIL**（无法评估不得记 PASS）。
- 未知维度 / 未知门 / 缺失配置：由静默降级或伪通过改为 **exit 1 + 合法值清单**。
- 既有 `.cycles/` 数据零迁移：账本哈希算法、entry 字段、CLI 输出格式均不变；
  旧账本若有 genesis 断链（首条 previousHash 非空），行为与旧版一致。

## 1.6.0 — MCP Server 版本号（未同步 SKILL.md）

- mcp-server.mjs 版本号 1.5.0 → 1.6.0（当时未同步 SKILL.md，属版本漂移来源之一）。

## 1.5.0 — 初始发布基线

- 16 脚本 + MCP Server + 15 references + 模板/钩子资产。
