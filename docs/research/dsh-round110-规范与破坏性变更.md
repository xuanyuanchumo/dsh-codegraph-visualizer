# DSH 官方规范与破坏性变更研究（cycle-110 / T4）

> 本文是**本轮**（cycle-110）的规范检索与破坏性变更判定记录。它与
> `docs/research/dsh-多代API规范差异与兼容矩阵.md`（cycle-83 取证、cycle-92 抬窗）是**增量**
> 关系，不重复其结论；凡是**推翻**旧结论的条目都单独标出 ⚠️ 并给出新证据。
>
> 证据纪律（沿用 `docs/agents/05`）：只接受两类来源 —— ① 带路径/URL 的官方原文；
> ② 本机实装代码的行级证据或**可复现的实算**。不接受「命名约定看起来是这样」「README 提到过」
> 「按语义应该有」。**未命中本身也是结论**，一律显式记录。
>
> 本文所有「本轮代码受影响 / 不受影响」的判定都对应一个可在本仓复现的检查（`grep` / 用例），
> 不是阅读印象。

---

## 1. 检索元信息

| 项 | 值 |
|---|---|
| 本地知识库 | `C:/Users/86156/.dsh/profiles/desktop/node_modules/dsh-plugin-dev-kb/kb`（技能 `dsh-plugin-dev-kb`） |
| 知识库来源 | 官方文档站点投影，仓库 `deepseek-ai/deepseek-harness` **branch `master`、commit `687f282e8625c6b8d11ff58211a90524be2e4317`、抓取于 2026-10-21**（`kb/meta/source.json`） |
| 知识库规模 | `site/` 192 页（中英双语）、`extra/` 439 篇（上游 `docs/` 未发布差集） |
| context7 库 ID（主） | `/deepseek-ai/deepseek-harness`（snippets 15016，Reputation High，Benchmark 66.6） |
| context7 库 ID（新增候选） | `/websites/deepseek-harness_github_io_deepseek-harness`（snippets 6039，Benchmark 63.53）—— 官方文档站的另一个索引入口，**本轮新增记录**：cycle-92 只登记过 `/deepseek-ai/deepseek-harness` |
| context7 本轮查询数 | 3 次 `query-docs`（工具/presenter、manifest/engines、cordis 生命周期）。受「每问题最多 3 次」限制，其余主题由本地知识库覆盖——后者是同一份 `docs/` 的投影，证据等级相同且**可带行号**，优于 context7 的片段化返回 |
| 本机运行宿主 | **`dsh 0.2.1-rc.3`**（Lead 实测：`D:\DSH\DeepSeek Harness\resources\runtime\cli` 的 desktop runtime） |
| 本机实装树可读性 | ⚠️ `C:/Users/86156/.dsh/profiles/node_modules/@deepseek-ai/*` 全部是指向 `D:\JetBrains\nvm\node_global\...\@deepseek-ai\dsh\node_modules\...` 的**悬空符号链接**（`Get-Item` 的 `Target` 指向不存在的目录）；运行时真身在 `D:\DSH\DeepSeek Harness\resources\app.asar`（182 MB 单文件，本会话无法按目录读取）。因此**本轮无法重跑「asar 树静态扫描」**，旧结论里依赖该树的部分在本文中标为「沿用上轮记录，本轮未复核」 |

### 1.1 context7 本轮命中/未命中清单

| # | 查询 | 命中 | 落点 |
|---|---|---|---|
| 1 | `defineTool … presentCall presentResult … ctx.tools.register … trajectory` | ✅ 命中 `packages/core/tools/README.md`、`docs/subsystems/tools.md`、`docs/cordis-tutorial/07-into-the-harness.md` | §5 |
| 2 | `manifest engines.dsh manifestVersion dsh.client.platform peerDependencies compatibility breaking changes` | ✅ 命中 `packages/boot/app-boot/README.md`（Profiles 段）、`docs/user/develop/basic/publish.md`、`packages/util/package-manifest/README.md`、`packages/boot/app-boot/src/plugin-compatibility.ts` | §3 ⚠️ |
| 3 | `cordis ctx.get strict … ctx.inject … ctx.effect disposer lifecycle` | ✅ 命中 `docs/cordis-api/fiber.md`、`docs/cordis-api/context.md`、快照 `snapshots/web/cordis-tool-round/system-prompt.expected.md` | §6 |
| 4 | 破坏性变更专表（`upgrade-guide`） | ✅ **本地知识库命中** `kb/extra/upgrade-guide/**`（6 个版本目录、40+ 条迁移指南）；context7 侧未直接返回该目录（它的索引偏 API 参考） | §3、§7 |
| 5 | `development.zh.md` / `architecture.zh.md` / `AGENTS.md` 正文 | ⚠️ **context7 未命中（沿用 cycle-92 结论）**；但**本地知识库已命中**：`kb/extra/development.md`、`kb/extra/architecture.md`、`kb/extra/AGENTS.md` 均存在（`extra/` 由上轮 182 篇扩到 439 篇，note 见 `source.json`）。⇒ cycle-92 的否定结论只对 **context7** 成立，对 KB 已失效 |

**未命中也是结论**：`upgrade-guide/` 在 context7 上取不到，而本地 KB 有 —— 说明「用 context7 检索破坏性变更」这条路不可靠，官方迁移指南只存在于仓库 `docs/` 投影里。后续轮次应直接读 `kb/extra/upgrade-guide/`。

---

## 2. 宿主真实状态（本轮实测，作为所有判定的基线）

Lead 提供的启动日志与本轮代码复核（三条，逐条给出对本项目的影响）：

### 2.1 运行版本 `0.2.1-rc.3`

- 按本仓模型 `generationOfVersion(major=0, minor=2)` → **gen2**（`src/shared/dshGeneration.ts`）。
- ⚠️ **措辞澄清**：把它称为「第三代」是**发布线序号**（0.1.7 → 0.2.0 → 0.2.1），不是本仓的
  `DshGeneration` 三代模型。两者混用会导出「gen3 已真机验证」这种错误结论——gen3 指 0.3.x，
  **至今未发布、未验证**。这条已写进 `dshGeneration.ts` 的注释与用例
  （`tests/unit/dshGeneration.test.ts` 的「classifies the live host 0.2.1-rc.3 as gen2」）。
- 由此得到一个比版本号更重要的结论（见 §3.5）：**同一代际内部可以有破坏性变更**，
  所以 `generation` 只能用来选「保守基线」，不能当成「API 面固定」的承诺。

### 2.2 上游 `dsh-codegraph@0.1.3` 被跳过

```
dsh: skipping profile bundle "dsh-codegraph": Plugin dsh-codegraph@0.1.3 is incompatible with dsh 0.2.1-rc.3
```

- 复核该包清单（`C:/Users/86156/.dsh/profiles/web/node_modules/dsh-codegraph/package.json`）：
  `engines` 只有 `{ node: ">=20" }`（**没有 `engines.dsh`**），`peerDependencies` 为
  `@deepseek-ai/dsh-{agent,llm,system-prompt,tools}: ^0.1.0-rc.6`。
- ⇒ 它走的是 **peer 回退规则**（没有 `engines.dsh` 才看 peer），而 `^0.1.0-rc.6` 的上界是
  `0.2.0-0`，`0.2.1-rc.3` 落在外面，所以**必然**被拒。这条日志同时反证了 §3 的规则确实在生效：
  **不是「上游写了 range 就一定装得上」，range 写得比宿主旧就会被安装门拒绝**。
- **对本项目的影响（结论：数据源退化，但不是崩溃）**
  - `codegraph_*` 工具全部缺席 → `checkPrerequisites().codegraph === false`（与日志
    `prerequisite status { codegraph: false, lens: false, builtin: true }` 一致）；
  - 本插件的 `invokeUpstream()` 走 `ctx.tools.execute`，工具缺席时返回 `null`，各 adapter 退化为空；
  - ⚠️ **但「有一份内置图可回落」这件事我们没有做到**（本轮新发现，见 §2.4）。

### 2.3 `dsh-better-sidebar` 处于 pending

```
dsh: warning: 1 entry did not activate — better-sidebar (dsh-better-sidebar): pending (waiting for service: webRuntime)
```

- 这是**第三方插件自己的依赖未满足**（它在等 `webRuntime` 服务），不是我们造成的。
- 对本项目的两层影响：
  1. `ctx.get('betterSidebar', false)` 读不到任何东西 —— 因为该包根本没 apply，也就没有
     `ctx.provide('betterSidebar', …)`。我们的 `BetterSidebarIntegration` 因此不可能走通这条通道。
  2. ⚠️ **但它是"此刻"读不到**。`src/client/integrations/*` 里还留着三处**快照早退**：
     `BetterSidebarIntegration.ts:55  if (!state.flags.betterSidebar) return;`、
     `ConversationViewIntegration.ts:48`、`SidebarRightTabsIntegration.ts:30`。这三处把
     「探测那一瞬间没有」变成「永远没有」：若提供者在 `apply()` 之后 500 ms 才转 active
     （本机日志证明这完全可能），通道就静默丢失，且**没有任何错误可见**。
     `CommandUiIntegration.ts:50` 已经因为踩过这个坑而删掉了同样的早退（注释逐字记录了
     cycle-83 的 5 条 slash command 全灭）。
- **判定**：`src/client/integrations/**` **不在本轮 T4 写域**。本轮只把这条证据与修法写成
  carry-over（§11 C1）交 Lead / T3，不在自己的写域外动手。可在自己写域内修的同类缺陷已修
  （§8.2：`prerequisites.ts` 的 strict 探测、`FeatureFlags` 的返回值别名）。

### 2.4 ⚠️ 本轮新发现：「built-in 分析可回落」是**假叙事**（P0，建议独立排期）

Lead 问「`dsh-codegraph` 被跳过时我们的数据源是否回落到 builtin」。如实回答：**没有**。

| 证据 | 位置 | 事实 |
|---|---|---|
| `builtin: true` 是硬编码 | `src/host/prerequisites.ts:67`（`checkPrerequisites`） | 与 `codegraph`/`lens` 的真实探测结果无关，恒为 `true` |
| `auto` 模式只打日志 | `src/tools.ts:132-134` | `if (source === 'auto' && merged.nodes.length === 0) log.info('… built-in analysis always available')` —— **只 log，不产出任何节点** |
| `healthy` 因此恒真 | `src/host/routes/statusRoutes.ts:42` | `status.codegraph || status.lens || status.builtin` 恒 `true` |
| 客户端同样把缺省当 `true` | `src/client/api/index.ts:232,234,235`、`src/client/components/EmptyState.tsx:58`、`src/client/store/slices/sessionSlice.ts:15` | `builtin ?? true` |

⇒ 在本机当前状态（`codegraph:false, lens:false`）下，全量扫描得到的是**空图**，
而状态接口仍然宣称「内置分析可用」。这正是本仓 CLAUDE.md 反复记录的
「虚假兼容性叙事 + 永不执行的分支」形态。

**边界澄清（避免误伤）**：`builtin` 并非**全部**虚假 —— 基于 TreeSitter 的 AST/大纲能力
（`/ast`、`/symbols/:id/ast`、`/files/:id/outline`）确实不依赖上游，`builtin: true` 对**那一层**
是诚实的；不成立的是「因此也能产出一张图」。所以正确的修法不是把 `builtin` 翻成 `false`，
而是把**「图数据源」**与**「AST 分析源」**拆成两个能力位。这需要同时改 `src/tools.ts`
（不在 T4 写域）+ 状态契约 + 客户端文案，故本轮**只登记不修**（§11 C2）。

---

## 3. 变更面 #0（**最高优先级**）：`engines.dsh` 是强制门，且优先于 `peerDependencies`

### 3.1 ⚠️ 推翻旧结论

本仓长期口径（`docs/agents/05-DSH官方规范检索证据.md` §2.2/§2.5、`docs/research/dsh-多代API规范差异与兼容矩阵.md` §6.1，以及 `src/shared/dshGeneration.ts` 原第 12-13 行）是：

> 「`engines.dsh` 与 `dsh.manifestVersion` 是**纯声明**，没有任何读取方；真正的兼容门只在 `peerDependencies`。」

**该口径是错的。** 正确事实（两条独立来源 + 一条源码行号，由 Lead 提供）：

1. **官方文档**（本地 KB，`master@687f282e`）：
   `kb/site/develop/basic/publish.md:69` 逐字：
   > 使用 `engines.dsh` SemVer 范围声明组合包支持的 DSH 版本……**安装和 profile 启动会拒绝当前运行的 DSH 不满足该范围的组合包；没有 `engines.dsh` 时，改为检查其 `@deepseek-ai/dsh*` peer 依赖范围。**
2. **官方变更指南**（`kb/extra/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md:12`）逐字：
   > 在 v0.2.1-alpha.3 中，安装和 profile 启动只依据……`peerDependencies`……忽略 `engines.dsh`。**下一版本中，包自身的 `engines.dsh` 范围单独决定结果，并忽略这些 peer；只有缺少 `engines.dsh` 时才使用 peer 规则。**`workspace:` 值只在 peer 中有效；出现在 `engines.dsh` 中时视为不兼容。
   同文件 `:14` 记录拒绝记录的字段 **`peers` → `requirements` 重命名**（键为 `engines.dsh` 或 peer 包名）。
3. **宿主源码**（Lead 提供行号）：`@deepseek-ai/dsh-app-boot` 的 `unmetRequirements()` 读
   `engines.dsh`，源码注释逐字 *"An own `engines.dsh` range decides alone and peerDependencies
   are ignored"*；`dshmarket/lib/verify.js:217-235` 复刻同一规则。
   ⚠️ 本轮**无法独立复核**这两处源码：它们在 `app.asar` 内，且 profile 的符号链接已悬空
   （§1）。本文按「Lead 提供 + 官方文档同义」处理，标记为**未独立复核的源码级证据**。
4. 旁证（本轮实测，§2.2）：`dsh-codegraph@0.1.3` **没有** `engines.dsh` ⇒ 走 peer 回退 ⇒
   被 `0.2.1-rc.3` 拒绝。若规则仍是「只读 peer」，同样的拒绝也会发生，因此这条**不区分**两种
   规则；真正区分的是我们自己的包（有 `engines.dsh`）在 `0.2.1-rc.3` 上**加载成功**（见 §3.3）。

### 3.2 缺陷：上界 `<0.4.0` 会放行 gen4 的**预发布**

`semver@7.8.5`（本仓 `node_modules/.pnpm/semver@7.8.5`）实算，`{ includePrerelease: true }`：

| 版本 | `>=0.2.0-rc.2 <0.4.0`（旧） | `>=0.2.0-rc.2 <0.4.0-0`（新） |
|---|---|---|
| `0.2.0-rc.2` | PASS | PASS |
| `0.2.1-rc.3`（**本机运行**） | PASS | PASS |
| `0.3.0-rc.1` / `0.3.0-rc.2` | PASS | **PASS**（必须保留） |
| `0.3.0` | PASS | PASS |
| `0.4.0-0` | **PASS ← 洞** | **REF** |
| `0.4.0-alpha.1` | **PASS ← 洞** | **REF** |
| `0.4.0-rc.1` | **PASS ← 洞** | **REF** |
| `0.4.0` | REF | REF |
| `1.0.0` | REF | REF |

复现命令：

```bash
cd D:/Projects/TraeProjects/dsh-codegraph-visualizer
S=$(ls -d node_modules/.pnpm/semver@7.8.5/node_modules/semver | head -1)
node -e "const s=require('./$S');for(const v of ['0.3.0-rc.2','0.4.0-rc.1','0.4.0'])
  console.log(v, s.satisfies(v,'>=0.2.0-rc.2 <0.4.0',{includePrerelease:true}),
               s.satisfies(v,'>=0.2.0-rc.2 <0.4.0-0',{includePrerelease:true}))"
```

⇒ 旧上界把「gen4 的预发布」放进了受支持窗口。一旦 `engines.dsh` 是强制门（§3.1），
这意味着**安装门会允许一个我们从未验证过的下一代预发布宿主加载本插件**。

### 3.3 顺带确认：运行宿主的求值用 `includePrerelease: true`

`0.2.1-rc.3` 是一个**预发布**，在 `includePrerelease: false` 下 `>=0.2.0-rc.2 <0.4.0` 与
`^0.2.0-rc.2 || ^0.3.0-rc.2` **都拒绝**它（实算：两者均 `false`）。而本插件在
`0.2.1-rc.3` 上**加载成功**（Lead 日志：`codegraph:db:repository`、`codegraph:mcp-server started`）。

⇒ **无论当前生效的是 engines 规则还是 peer 规则，求值一定带了 `includePrerelease: true`。**
这条否证了一个担心的假设：「引擎求值不带 prerelease 会让所有 -rc 宿主装不上」。它同时说明
**下限 `>=0.2.0-rc.2` 的写法在 prerelease 语义下是有效的**（不需要改写成 `-0` 之类的形式）。

### 3.4 本轮改动（已完成）

| 文件 | 改动 | 备注 |
|---|---|---|
| `src/shared/dshGeneration.ts` | `DSH_SUPPORTED_RANGE` → `'>=0.2.0-rc.2 <0.4.0-0'` | **下限不变**（用户硬要求） |
| 同上 | `DSH_UNSUPPORTED_PROBE` → `'0.4.0-rc.1'`；新增 `DSH_UNSUPPORTED_PROBES = ['0.4.0-rc.1','0.4.0','1.0.0']` | 旧探针 `0.4.0` 在旧上界下本来就 REF，对「上界太宽」不敏感 |
| 同上 | 文件头整段改写：engines 是强制门、有 engines 则 peer 被忽略、`peers → requirements` | 附 KB 路径行号；asar 内行号标为「未独立复核」 |
| `tests/unit/manifest.test.ts` | 上界探针**成对**：`0.4.0-rc.1`/`0.4.0-alpha.1`/`0.4.0`/`1.0.0` 必须 false；`0.3.0-rc.1`/`0.3.0-rc.2`/`0.3.0`/`0.3.7` 必须 true | 只测「排除」测不出改宽，只测「覆盖」测不出改窄 |
| `tests/unit/dshGeneration.test.ts` | 同上两向探针 + `0.2.x`/`0.1.x` 各一组 | 另加「0.2.1-rc.3 归 gen2」的发布线澄清用例 |
| `package.json` | `engines.dsh` 同步为同一字符串 | **由 deps-quality 执行**（T4 不动该文件）；本轮验证时已一致 |

**变异探针（证明用例不是假绿）**：把 `DSH_SUPPORTED_RANGE` 改回 `'>=0.2.0-rc.2 <0.4.0'`
后 `tests/unit/dshGeneration.test.ts` 立刻 2 条红（`agrees with the manifest window` +
`excludes every gen4 probe`），恢复后 24/24 绿。

### 3.5 结论：代际模型不能当作兼容性判据

`0.2.1-alpha.3 → 0.2.1-rc.3` **同属 gen2**，却包含 §3.1 这条破坏性变更。
⇒ 「按代际分支」只能决定**保守基线的起点**；任何具体能力都必须现探现用
（`ctx.get(key, false)` / `ctx.inject` / 工具在场性）。这是本轮适配器「探测 + 降级」原则的
**直接依据**，不是风格偏好。

---

## 4. 变更面 #1：客户端平台 —— 仍然只有 `web`，桌面端靠 DOM 标记

| 断言 | 证据 | 置信度 |
|---|---|---|
| `dsh.client.platform` 只有 `'web'` 会被加载 | KB `site/reference/subsystems/client-modules.md:98`：「包……声明 `dsh.client`（`platform: 'web'`……），并在 `exports["./client"]` 导出构建好的 bundle」；旧记录另引 asar `dsh-client-modules/lib/index.js:713-719` 的 `decl.platform !== "web" → null` | CONFIRMED（文档 + 上轮源码） |
| 桌面端与网页端**共用同一个** web 半 | 同上（没有 `'desktop'` 这个取值存在） | CONFIRMED |
| 桌面端唯一可观测差异 = `<html data-platform="darwin">` / `data-windows-titlebar` + `--dsh-frame-*` CSS 变量 | 上轮 asar 取证（`dsh-client-ui-primitives/lib/types/darwin-desktop.d.ts` JSDoc）；本轮复核本仓实现 `src/client/compat/PlatformProbe.ts:72,114` 仍是**惰性读 DOM + MutationObserver** | CONFIRMED（沿用上轮源码，本轮未重跑 asar 扫描） |
| `process.versions.electron` 无命中 | 上轮全树 grep | 沿用上轮，本轮未复核 |
| `engines`/`browser`/`os` 等清单字段能判桌面 | **NOT FOUND**：客户端清单只有 `platform` / `inject` / `immediately` / `external` | 与 §1 的 client-modules 文档一致 |

**本轮代码判定：不受影响。** `PlatformProbe` 已经是正确形状（每次调用重读、MutationObserver
重算、`safeCheck` 包裹），本轮未改其语义。桌面端页面兼容性见 §9（**未真机验证**）。

---

## 5. 变更面 #2：工具注册与 presenter —— 轨迹里「看得见」的两件事

### 5.1 官方契约（本轮复核，KB `site/reference/subsystems/tools.md`）

| 位置 | 原文要点 |
|---|---|
| `:15` | `ToolDefinition` = `ToolSchema`（模型可见） + 规范输出声明 + `execute` + 宿主侧调度元数据 + 可选 `finalizeContent` + **可选 UI 展示函数**；注册表 `schemas()` 用**显式允许列表**构建模型请求，`output`/`execute`/`projectContent`/`finalizeContent`/`timeoutMs`/`isConcurrencySafe`/`presentCall`/`presentResult` **绝不能泄漏到模型请求** |
| `:98` | `presentCall?(args): ToolCallView \| undefined` —— 返回 `undefined` 或省略方法 ⇒ 回退到通用展示（**title = 工具名，原始参数作输入**）。JSDoc 逐字：「Pure and side-effect-free: a UI may call it during live streaming **AND a session-log replay**, so it must depend only on `args`」 |
| `:106` | `presentResult?(args, result): ToolResultView \| undefined` —— 同上，回退时保留 pending 标题并渲染原始结果 |
| `:163` | `defineTool` 把参数推导/校验与 `execute`/`render`/`presentationMeta` 绑定；参数不匹配抛 `ToolArgsError`（`INVALID_ARGS`） |
| `:491` | 展示词汇：`ToolCallView` = `{card:'generic'|'terminal'|'diff', …}`；`ToolResultView` 另有 `search`/`read`/`web` 卡片；`ToolCallKind` = `read|edit|delete|move|search|execute|fetch|other` |
| `:526` | `ctx.tools.register(definition)` 返回**精确的 disposer**；「duplicates within one layer and the **reserved `run_code` name** fail」 |

### 5.2 关键推论：presenter **不决定**「轨迹里有没有这次调用」

模型在轨迹里看到一次 tool call，前提是**模型真的调用了这个工具**（即它已注册、名字与
schema 在模型请求里出现）。presenter 只决定**卡片长什么样**：

- presenter 缺席/返回 `undefined` → 调用**仍然出现**，只是通用卡片（title = 工具名 + 原始参数）；
- 未注册 → 调用**根本不存在**（模型看不见 schema），而且**不报错**（`register` 的返回值
  是个 disposer，漏调用一次没有副作用可观察）。

### 5.2.1 轨迹可见性的**最小充分条件**（P1-4 验收判据）

> 这一节是给门禁照抄的：**满足 (1)-(3) 就一定会在轨迹里看到这次调用**，三条都无关 presenter。

1. **注册到「调用方 agent 所在的 scope」**：`ctx.tools.register(definition)`（`tools.md:526`）。
   注册表用**显式允许列表**把 `ToolSchema`（`name`/`description`/`parameters`）织进模型请求
   （`tools.md:15` 逐字：`output`/`execute`/`presentCall`/`presentResult` 等**绝不能**泄漏）。
   - **不需要**任何 manifest 字段（`package.json` 的 `dsh.*` 里没有 tools 声明位）；
   - **不需要**在什么「tool catalog」里额外登记。`site/reference/tool-catalog.md` 是**内置工具的
     生成式文档**，不是加载路径；本插件的「catalog」= 代码里的定义集合。
   - 反例（本仓真实发生过）：工厂造出工具但入口没注册 ⇒ 模型看不见、轨迹里没有、**零报错**
     （CLAUDE.md「A tool factory returning a tool is NOT registering it」）。
2. **没有被 scope 过滤掉**：`ctx.tools.restrict({ deny })` 会隐藏工具；`register` 在
   **调用方 scope 内**注册的会 shadow 全局（`tools.md` 的 `ctx.tools` 目录）。本插件注册在全局
   层，未被任何 `restrict` 覆盖 ⇒ 满足。
3. **呈现模式把工具暴露为直接调用**：`native` 把可见工具暴露为**直接函数调用**（模型轨迹里
   就是 `graph_*` 这一行）；`ptc` 暴露的是 `run_code`，我们的工具只在程序内部作为**嵌套调用**出现。
   - 证据：`kb/extra/upgrade-guide/v0.2.1-alpha.1/tool-presentation-mode/guide.zh.md:14` 逐字：
     「`native` 将可见工具公开为直接函数调用。`ptc` 公开 `run_code`，程序通过生成的 SDK 调用
     可见工具。同一应用中的不同 agent preset 仍可使用不同模式。」
   - ⚠️ **未验证**：本机 profile 的 `cordis.patch.yml` 里**没有**显式 `mode` 字段，即走部署默认值，
     而默认值本轮无法从 asar 读取。判定方法写进 A1：若模型工具列表里直接出现 `graph_*` ⇒ `native`；
     若只有 `run_code` ⇒ `ptc`（此时轨迹里是 `run_code`，我们的工具是嵌套调用，**同样是"有调用"**，
     只是层级不同）。这一条不影响 (1)(2) 的结论，只影响「在哪一层看」。
4. **模型以合法 schema 调用**：参数非法时 `execute` 抛 `ToolArgsError`（`INVALID_ARGS`）——
   调用**仍会出现**，只是标记为失败；不出现在轨迹只会是「模型没调用」，不是 presenter 的问题。

**因此 presenter 是「第 4 层」（纯度/回放/卡片）而不是必要条件**：
`presentCall`/`presentResult` 缺失 ⇒ 调用可见但卡片退化为通用形态；`presentCall` 抛异常或返回
非法 `card` ⇒ 才是潜在可见性风险（本轮的契约用例正是拦这一类）。

### 5.2.2 P1-4 验收清单（真机 + 用例各一半）

| # | 判据 | 手段 | 状态 |
|---|---|---|---|
| A1 | 模型请求里出现本插件的 10 个 `graph_*` schema（同时判定呈现模式：有 `graph_*` ⇒ `native`；只有 `run_code` ⇒ `ptc`） | 真机读会话 system-prompt / 工具列表快照 | 未验证（真机项） |
| A2 | 模型调用后，轨迹里出现**真实 tool call 行**（不是只在内核日志里） | 真机截图 | 未验证（真机项） |
| A3 | 该行卡片标题是**我们的标题**（"Fetch code graph" 等），不是原始参数回退 | 同上 | 未验证（真机项） |
| A4 | 合法规格下 presenter 返回合法 `ToolCallView`/`ToolResultView`；非法规格下短路 | `tests/unit/hostCompat/toolPresenterContract.test.ts`（11 例） | ✅ 已验证 |
| A5 | 短路 ≠ 回调没执行（互补用例区分两者） | 同上「短路证明」用例（`presentResult({}, null)` 不抛 / `(validArgs, null)` 抛） | ✅ 已验证 |
| A6 | 名字集合 = 入口注册集合（防「工厂造了但没注册」） | `tests/unit/tools.test.ts` 的集合相等守卫（P0-5） | ✅ 已验证 |

**结论一句话**：轨迹可见性 = **注册到调用方 scope + 未被 restrict + 呈现在哪一层（native 直接行 /
ptc 嵌套调用）+ 模型真的调用**；presenter 只决定「长什么样」，不决定「有没有」。A1-A3 必须真机，
A4-A6 已由用例钉死。

### 5.3 历史陷阱（必须用"互补用例"证明，不能靠读代码）

`@deepseek-ai/dsh-tools/lib/index.js:838-887` 的 `defineTool` 把**两个** presenter 都包进
参数校验门：

```js
if (userPresentCall) tool.presentCall = (args) => {
  if (validate(args).length > 0) return void 0;
  return userPresentCall(args);
};
```

⇒ 「非法参数下拿到 `undefined`」有两种解释：**门拦下了**，或**我们的回调自己返回了 undefined**。
只断言返回值分不清，而分不清的后果是「测试全绿但 presenter 从未执行」（本仓 CLAUDE.md 已记录
一次真实事故）。

### 5.4 本轮交付的契约用例（`tests/unit/hostCompat/toolPresenterContract.test.ts`，11 例全绿）

| 用例组 | 断言 |
|---|---|
| 名字/catalog | 入口注册的 10 个名字一个都不少；工厂返回的每个工具**都必须**在 `VALID_ARGS` 里有样本（否则报错，防止未来新增工具漏覆盖）；名字 `snake_case`、唯一、不占用保留名 `run_code` |
| 注册形状 | 每个返回项都有 `name`/`description`/`execute`（`dispose` 函数必须被显式排除——函数自带 `name` 属性，是本文件踩过的坑） |
| `presentCall` | 10 个工具用**合法**参数均返回 `card` ∈ `{generic,terminal,diff}`、`title` 非空、`kind` ∈ `ToolCallKind`、**可 JSON 序列化**（回放要求） |
| `presentCall` 短路 | `presentCall({})` 与类型错误参数一律 `undefined`（每个工具都有必填项） |
| 纯度 | 同参两次调用**深相等**，且不改写入参（"session-log replay" 契约） |
| `presentResult` | 成功/失败都返回合法 `ToolResultView`，且**两者标题必须不同**（相同等于把失败渲染成成功） |
| **短路 vs 执行（核心）** | `presentResult({}, null)` **不抛**且返回 `undefined`（门在触碰 `result` 前返回）；`presentResult(validArgs, null)` **抛 TypeError**（证明用户回调真的执行了，它在读 `result.isError`） |
| schema 卫生 | `parameters` 是 object 根 schema，`required` 与 `properties` 一致，每个属性带 `type`；且序列化后**不含**任何宿主侧字段名 |

**结果**：`11 passed`。核心证据对同时成立 ⇒ 既证明「门在短路」，又证明「合法时回调真跑」。

**给 Lead 的可见性结论**：本插件的 10 个工具在**代码层面**已满足「模型可调用 + 卡片可渲染」；
**真机轨迹截图**仍属未验证项（本轮无法启动桌面端，见 §9.3）。

---

## 6. 变更面 #3：Cordis 生命周期与 effect

| 契约 | 证据 | 本轮判定 |
|---|---|---|
| `ctx.get(name, strict = true)` 只返回**提供者 fiber 当前活跃**的实现 | context7 命中 `docs/cordis-api/context.md`（`get<K>(name, strict?)` JSDoc 逐字）；KB `site/reference/cordis-api/context.md:242-260` 同义；上轮 asar `cordis/lib/index.js:763-772` | 与上轮一致。**本轮新增源码守卫**（§8.1） |
| 存在性探测必须 `ctx.get(key, false)` | 同上（语义）+ 本仓 cycle-83 真机事故 | 与上轮一致 |
| `ctx.inject(deps, cb)` = `ctx.plugin({inject, apply})` 简写；**每当某个必需服务发生变化，回调被卸载并重跑** | KB `site/reference/cordis-api/registry.md:13`（逐字） | 这是「提供者后 apply」那一半的唯一兜底 |
| `ctx.effect(execute, label?)` 立即执行，disposer 在**逆序**卸载或显式调用时跑；fiber 已销毁时抛 `INACTIVE_EFFECT`；`execute` 返回非法形状抛 `TypeError` | context7 命中 `docs/cordis-api/fiber.md`；KB `site/reference/cordis-api/fiber.md:13,29` | 本仓所有副作用都走 `ctx.effect`（`src/index.ts` 8 处、`routes.ts` 3 处），形状正确 |
| `register` / `effect` / 路由注册全部返回 disposer | 同上 + `tools.md:526` | 与上轮一致 |
| 工具 `mode` 只接受 `native` / `ptc`，`both` 被拒 | `kb/extra/upgrade-guide/v0.2.1-alpha.1/tool-presentation-mode/guide.zh.md:12,18-20` | **本仓不受影响**：`grep -rn "mode: *both\|presentAs\|DSH_TOOLS_MODE" src cordis.patch.yml package.json` = 0 命中（`graph_data` 的 `source:'both'` 是**我们自己的参数枚举**，与工具呈现模式无关） |
| 嵌套 PTC 调用现在也会跑 `output.presentationMeta`，投影抛异常会让该次嵌套调用以 `ToolOutputError` 失败 | `kb/extra/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.zh.md` | **本仓不受影响**：`grep presentationMeta src/` = 0 命中（我们只用 `presentCall`/`presentResult`/`output.render`） |

---

## 7. 其它 0.2.x 线内破坏性变更（"不影响"的判定也要留证据）

| 变更（版本） | 来源 | 本仓判定 |
|---|---|---|
| 子路径插件不再读 `<子路径>/package.json`，改用 locale meta + `<子路径>/icon`（0.2.0-rc.2 → 下版） | `kb/extra/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.zh.md` | **不受影响**：本包不导出子路径清单（`exports` 只有 `./client` 等），也没有子路径 `package.json` |
| 移除 loop 的 `{{cwd}}` 提示词变量、ACP/SDK 子代理的 `cwd` 配置键（0.2.1 线） | `kb/extra/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.zh.md` | **不受影响**：本插件不写提示词模板、不配置子代理 provider |
| `IncompatiblePlugin` / `PluginCompatibility` 的 `peers` 字段改名 `requirements` | `kb/extra/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md:14` | **不受影响**：本仓不读该记录（`grep -rn "IncompatiblePlugin\|PluginCompatibility" src/` = 0） |
| 市场索引入口/字段（`engines.dsh` 缺省表示任意版本、`compatibility` 字段） | `kb/site/guide/plugin-market.md:138,140`；`kb/extra/subsystems/boot.zh.md:27` | **不受影响**（P1-2 由其它成员处理市场索引，本轮 T4 未触碰） |
| 桌面端字号快捷键 / 账号身份等 | `kb/extra/upgrade-guide/v0.2.1-alpha.2/*` | **不受影响**（与本插件面无关） |

---

## 8. 多代适配器：两向证据与本轮修复

### 8.1 两向证据（静态 `provide(` 扫描 + 真实 `ctx.get` 调用点）

| 服务键 | 静态 `provide(` 命中 | 本仓真实 `ctx.get` 调用点 | 结论 |
|---|---|---|---|
| `betterSidebar` | ✅ `dsh-better-sidebar@0.28.1/lib/client-registry.js`、`lib/client.js` | `src/client/integrations/BetterSidebarIntegration.ts:65`（`ctx.get('betterSidebar', false)`） | 键真实存在；**但提供者可能 pending**（本机实测）⇒ 必须有降级通道 |
| `workspaceRegistry` | ⚠️ 本轮无法复核（asar） | `src/host/prerequisites.ts` 的 `getWorkspaceRegistry()` | 真实存在（上轮 asar 记录）；**本轮修了 strict 缺失**（§8.2） |
| `commandUi` | ⚠️ 静态扫描看不到（经 `Service` 基类注册，上轮已记录） | `src/client/integrations/CommandUiIntegration.ts:57`（`ctx.inject(['commandUi'], …)`） | 走响应式注入，正确 |
| `sidebarRightTabs` | ⚠️ 本轮无法复核（asar） | `SidebarRightTabsIntegration.ts:45`（`ctx.inject`） | 走响应式注入，**但 `:30` 仍有一处快照早退**（§11 C1） |
| `pluginNavigation` / `userQuestionPanels` | 上轮：仅 gen2 有 `provide` | 仅用于 client 定代（`ClientVersionDetector`） | 仍是唯一可靠的 gen2 独有标记 |
| `remoteWebUI` / `spotlight` / `desktopProfiles` | 上轮：三树零命中 | 无（已删） | 幻影裁决不变 |

**方法论警示**：本轮发现 profile 的符号链接已悬空、运行时真身在 `app.asar` 内 ——
「静态 `provide(` 扫描」在这台机器上**已不可复现**。后续若要用它做定代证据，必须先解决
asar 读取（或用 `cordis_inspect_list` 之类的运行期面），否则只能沿用上轮记录。这本身就是一条
需要写进方法论的结论（**证据的可复现性会随环境漂移**）。

### 8.2 本轮修掉的两个真实缺陷（都在 T4 写域内，都由新守卫发现）

1. **`src/host/prerequisites.ts` 的 `ctx.get('workspaceRegistry')` 缺 `strict = false`**
   （原第 93 行）。该函数被 `resolveWorkspaceRoots()` 在**每个请求**里调用，而它第一次运行
   发生在 `apply()` 同一步 —— 此时注册表提供者很可能还在 loading。用默认 strict 会把
   「稍后可用」判成「不存在」，工作区根只剩 sessions/cwd 两个回退分支。
   **为什么以前没红**：回退路径同样能解析出根目录；只有「注册表里有、sessions 里没有」的
   工作区会被静默丢掉。
2. **`src/host/compat/FeatureFlags.ts` 的返回值别名**：`resolveFeatureFlags(info)`（无探针）
   曾直接 `return { flags: base }`，把 `FEATURE_FLAGS_BY_GENERATION` 里的**同一个对象**交给
   调用方。任何一处对 flags 的写入都会永久改坏该代的默认值（同进程后续所有解析都被污染），
   「快照可重算」也随之失效。改为返回 `{ ...base }` 副本。

两处都是「守卫先红、再修」：`tests/unit/generation/serviceProbeContract.test.ts` 在修前
分别报出 `prerequisites.ts:93` 违规与「两次解析拿到同一对象」。

### 8.3 新增的结构性守卫（`tests/unit/generation/serviceProbeContract.test.ts`，10 例）

| 守卫 | 内容 |
|---|---|
| `ctx.get` 必须显式传 `false` | 扫 `src/**/*.ts(x)`（**先剥注释、保留换行**），每个 `ctx.get(` 的参数必须以 `, false` 结尾；违规按 `file:line` 报出 |
| 反向自检 | 合成样本 `ctx.get('x')` 与 `ctx.get(key, true)` 必须被识别（1 条违规），`ctx.get('x', false)` / `ctx.get( key,  false )` 必须放行 —— 防止「正则写错导致永久绿」 |
| 注释豁免 | 注释里引用错误写法不得算违规（本仓已有多次「guard 匹配到自己」的事故） |
| 反空扫 | 文件数 > 50、`ctx.get(` 出现次数 ≥ 3，否则遍历失败会被误读成零违规 |
| `ctx.inject` 存在性 | 至少一处 `ctx.inject([...])`（提供者后 apply 的那一半） |
| 能力快照纯函数 | 无探针 = 代际默认值；探针 `false` 永不关能力；探针 `true` 只升格未授予项并记录 `probedUpgrades`；探针抛异常 = 无证据不崩溃；**两次解析是互相独立的对象**（无记忆化）；`createFeatureFlags` 与 `resolveFeatureFlags` 语义一致 |

**变异探针**：把 `const minRetainRatio = options.minRetainRatio ?? 0` 改为 `0`（关掉阈值）
后 guard 用例 9 条红；恢复后全绿。

---

## 9. 桌面端：判定依据与「已验证 / 未验证」

### 9.1 判定依据（全部可核验）

1. **不存在独立桌面平台**：`dsh.client.platform` 只有 `'web'` 被加载（§4）⇒ 桌面端跑的就是
   同一个 web 半，插件代码不需要（也无法）分叉。
2. **唯一可观测差异是 DOM 标记**：`<html data-platform="darwin">`（macOS Electron preload
   写入）/ `<html data-windows-titlebar>`（Windows 标题栏），且**可能晚到 DOMContentLoaded**。
   本仓 `src/client/compat/PlatformProbe.ts:72` 每次调用重读 `root.dataset.platform` /
   `hasAttribute('data-windows-titlebar')`，`:114` 用 `MutationObserver`（`attributeFilter`
   正好是这两个属性）在标记晚到时重算。
3. **CSS 变量**：`html[data-platform=darwin]{--dsh-frame-top-clearance:48px}`、
   `html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);…}`
   （上轮 asar `dsh-client-ui-layout/lib/client.js:73`）。它们是**唯一**可用于版面适配的
   宿主变量；本插件没有硬编码标题栏高度，因此不需要随平台分叉。
4. **禁用项**：`process.versions.electron`（上轮全树零命中，本轮未复核）；
   `ctx.get('desktopProfiles')`（不是 cordis 服务，幻影）。

### 9.2 状态标注

| 项 | 状态 |
|---|---|
| 桌面端 **web 半加载路径**（`platform:'web'` 唯一取值、共用同一 bundle） | ✅ **已验证**（官方文档 + 上轮 asar 源码） |
| `PlatformProbe` 惰性读 DOM + MutationObserver 重算 | ✅ **已验证**（源码 + 单测 `tests/unit/PlatformProbe.test.ts`） |
| 桌面端**真机**渲染 / 标题栏避让 / 拖拽区不遮挡 | ❌ **未验证**（本轮无法启动桌面端：审批提示禁用、且不得另起服务） |
| 桌面端 + 远程窄屏（`body.dsh-remote-portrait`）组合 | ❌ **未验证** |

### 9.3 真机验证步骤（交 Lead）

1. 启动桌面端（`D:\DSH\DeepSeek Harness\resources\runtime\cli`），打开本插件。
2. CDP 里读 `document.documentElement.dataset.platform` 与
   `document.documentElement.hasAttribute('data-windows-titlebar')`，与本插件日志
   `[codegraph:client] platform …` 对齐（`PlatformProbe` 的判定值必须与 DOM 一致）。
3. 在插件面板顶部测量到窗口内容区顶边的距离，确认未被 Windows 标题栏遮挡
   （期望 > 0；`--dsh-frame-top-clearance` 生效时为标题栏高度）。
4. `MutationObserver` 路径：在 DevTools 里**手动删除** `data-windows-titlebar` 再重新加上，
   确认插件重算（日志出现第二次 platform 判定），而不是永久停在第一次的结果。

---

## 10. 兼容矩阵增量（关键：区分「声明覆盖」与「真机验证」）

| DSH 版本 | 发布线序号（Lead 口径） | 本仓代际 | `engines.dsh` 覆盖？ | peer 覆盖？ | **真机验证** |
|---|---|---|---|---|---|
| `0.1.7-rc.1` | 第 1 代 | gen1（容忍不承诺） | ❌ | ❌ | 未安装（VS Code 扩展树，不可安装） |
| `0.1.7-rc.2` | 第 1 代 | gen1 | ❌ | ❌ | 未安装 |
| `0.2.0-rc.2` | 第 2 代 | gen2 | ✅ | ✅ | ✅ J0 通过（cycle-92） |
| **`0.2.1-rc.3`** | **第 3 条发布线** | **gen2** | ✅ | ✅ | ✅ **本轮**（插件加载成功：`codegraph:db:repository` / `codegraph:mcp-server started {tools:4}`） |
| `0.3.0-rc.2` | — | gen3 | ✅ | ✅ | ❌ 未发布 |
| `0.4.0-rc.1` | — | gen3（模型） | ❌（新上界起） | ❌ | ❌ |
| `0.4.0` / `1.0.0` | — | gen3（模型） | ❌ | ❌ | ❌ |

**读法（必须同时读三列）**：
- 「`engines.dsh` 覆盖」= 安装门会不会放行；**不等于**验证过；
- 「本仓代际」= 如果真的加载了，适配器按哪代保守基线工作；0.4/1.x 落 gen3 是**建模**而非承诺；
- 「真机验证」才是用户可依赖的那一列。本表里 ✅ 只有三格。

---

## 11. Carry-over 与移交（写清归属，不在自己写域外动手）

| ID | 事项 | 归属 | 依据 |
|---|---|---|---|
| **C1** | `src/client/integrations/` 三处快照早退（`BetterSidebarIntegration.ts:55`、`ConversationViewIntegration.ts:48`、`SidebarRightTabsIntegration.ts:30`）应改为「无快照门，交给 `ctx.inject` 决定」 | **T3 / Lead**（不在 T4 写域） | §2.3 本机 `better-sidebar pending` 实测 + `CommandUiIntegration.ts:50` 的既成修法 |
| **C2** | 「built-in 图回落」是假叙事（`prerequisites.ts:67` 硬编码 `builtin:true` + `src/tools.ts:132-134` 只 log）；需把「图数据源」与「AST 分析源」拆成两个能力位 | **只登记不修，Lead 裁定流转 cycle-111**（改 `/status` 形状 = host API 破坏性变更，需前端消费方 + 5 份文档同步） | §2.4 |
| **C3** | 桌面端真机验证（§9.3 四步） | **Lead**（真机） | §9.2 未验证项 |
| **C4** | 真机轨迹截图（本插件工具调用出现在会话轨迹里） | **Lead**（真机） | §5；代码侧契约已绿 |
| **C5** | `asar` 静态扫描能力已失效（符号链接悬空），定代证据的「可复现性」需重建 | **Lead 决策**（读 asar 或改用 `cordis_inspect_*`） | §8.1 方法论警示 |
| **C6** | `docs/agents/05`、`docs/需求分析.md`、`CLAUDE.md` 里「engines.dsh 无读取方 / peer 才是真承诺」的口径需要同步纠正 | **docs-agents / Lead**（明确不归 T4） | §3.1 |

---

## 12. 本轮代码改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/shared/dshGeneration.ts` | 改 | 上界 `-0`；探针换 `0.4.0-rc.1` + 新增探针数组；文件头事实更正（engines 是强制门）；代际≠兼容性判据 |
| `src/host/compat/FeatureFlags.ts` | 改 | 无探针时返回副本（修别名缺陷） |
| `src/host/compat/snapshotShrinkGuard.ts` | 新增 | 快照防缩水纯判定 + 两次确认状态机（阈值全部复用 `GRAPH_DELTA_SHRINK`） |
| `src/host/compat/index.ts` | 改 | 导出守卫 |
| `src/host/routes/shared.ts` | 改 | `saveSnapshot` 调用点接线（拒绝只跳过落盘，"快照不决定永远"） |
| `src/host/routes.ts` | 改 | `ctx.effect` 里重置守卫状态（随插件卸载） |
| `src/host/prerequisites.ts` | 改 | `workspaceRegistry` 探测补 `strict = false` |
| `tests/unit/hostCompat/snapshotShrinkGuard.test.ts` | 新增 | 21 例（纯判定 12 + 状态机 3 + 真实 repo 6） |
| `tests/unit/hostCompat/toolPresenterContract.test.ts` | 新增 | 11 例（轨迹可见性契约） |
| `tests/unit/generation/serviceProbeContract.test.ts` | 新增 | 10 例（源码形状守卫 + 快照纯度） |
| `tests/unit/manifest.test.ts` | 改 | 上界两向探针 |
| `tests/unit/dshGeneration.test.ts` | 改 | 上界两向探针 + 运行宿主分类澄清 |

**未触碰**：`package.json`（deps-quality）、`docs/agents/**`（docs-agents）、
`docs/需求分析.md`、`CLAUDE.md`、`src/client/integrations/**`（T3）、`src/tools.ts`、
`vitest.config.ts`。
