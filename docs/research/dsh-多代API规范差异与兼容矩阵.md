# DSH 多代 API 规范差异与兼容矩阵（cycle-83 取证，cycle-92 抬窗更新）

> **cycle-92 更新（本文件 §6 与 §1 第 7 条）**：用户 objective #3 要求「确保 DSH 宿主下限版本
> 定为 dsh-v0.2.0」，故承诺窗口由 `>=0.1.7-rc.2 <0.4.0` **抬高到** `>=0.2.0-rc.2 <0.4.0`，
> peer 范围同步去掉 `^0.1.7-rc.2`。gen1 降为「容忍但不承诺」（见 §6.4）。
> 其余章节（§2 服务面、§3 代际判别、§4 conversation.view、§5 平台、§9/§10 契约）**未受影响**，
> 因为它们是关于「运行时行为」的证据，与「承诺哪些版本」是两回事。

> 本文只记录**在本机真实安装面上逐行核验过**的结论。每条结论都带证据锚点
> （相对路径 + 行号 + 短引用）并标注置信度：
> **CONFIRMED** = 有源码行或可执行探针直接支撑；**INFERRED** = 由多条 CONFIRMED 推出；
> **NOT FOUND** = 穷尽搜索后确认不存在（这本身也是结论，且往往是最重要的一类）。
>
> 证据树：
> - `<A>` = `C:\Users\86156\.dsh\profiles\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai`（**gen2 / 0.2.0-rc.2**，244 包）
> - `<V>` = `C:\Users\86156\.vscode\extensions\zwb8926.deepseekharness-for-vscode-2026.9.24\node_modules\@deepseek-ai`（**gen1 / 0.1.7-rc.1**）
> - `<W>` = `C:\Users\86156\.dsh\profiles\web\node_modules`（web profile 已装第三方插件）
> - `<C>` = `C:\Users\86156\.dsh\profiles\node_modules\@deepseek-ai\cordis`（cordis 4.0.4）
> - 本机运行版本真源：`C:\Users\86156\.dsh\profiles\node_modules\@deepseek-ai\dsh\package.json` 的 `version` = `0.2.0-rc.2`

---

## 1. 结论速览

| # | 结论 | 置信度 | 对项目的影响 |
|---|---|---|---|
| 1 | `remoteWebUI` / `spotlight` / `desktopProfiles` 三个服务键**在全机三棵树中不存在** | CONFIRMED NEGATIVE | 三条集成分支是死代码，cycle-83 已删除 |
| 2 | `@deepseek-ai/dsh-client-ui-slots` 的 `lib/index.js` 在 gen1 与 gen2 **逐字节相同** | CONFIRMED | slot 注册语义跨代通用，无需分代实现 |
| 3 | 只有 `pluginNavigation` / `userQuestionPanels` 能区分 gen1/gen2；`slots`/`sidebarRightTabs`/`documentPreviews` 两代都有 | CONFIRMED | 旧代码把 `sidebarRightTabs` 当 gen2 标记是**错的**，cycle-83 已修 |
| 4 | DSH **不存在桌面客户端平台**：`dsh.client.platform` 只有 `'web'` 会被加载 | CONFIRMED | 「兼容桌面端」= 兼容同一个 web 半 + 读 Electron 写入的 DOM 标记 |
| 5 | 桌面端唯一判别 = `<html data-platform="darwin">` / `<html data-windows-titlebar>`，且必须**惰性求值** | CONFIRMED | cycle-83 新增 `PlatformProbe` |
| 6 | `process.versions.electron` 在全部 `@deepseek-ai/**/*.js` 中**零命中** | CONFIRMED NEGATIVE | 不得用 Electron 全局判桌面 |
| 7 | 版本门**只有一条**：`peerDependencies` 上的 `@deepseek-ai/dsh*`；`engines.dsh` 与 `dsh.manifestVersion` 是纯声明 | CONFIRMED | cycle-92 起 peer 与 `engines.dsh` 下限同为 `0.2.0-rc.2`，两侧一致（见 §6） |
| 8 | DSH 不向插件 context 暴露任何版本串（4 个 context 候选 + 3 个 env 候选全 miss） | CONFIRMED NEGATIVE | 客户端只能按**服务面**定代，宿主要么按工具面、要么降级 `unknown` |
| 9 | `window.__DSH_BOOT__` 不携带版本 | CONFIRMED NEGATIVE | 不能从 boot 全局读版本 |
| 10 | `ctx.commandUi` 是两代都真实存在的命令贡献面，可替代 `spotlight` | CONFIRMED | cycle-83 新增 `CommandUiIntegration` |
| 11 | `conversation.view` 是 `list` 型 slot，多个注册项**并排**成多个标签 | CONFIRMED | 顶层「代码图谱」标签机制正确 |
| 12 | `sidebarRightTabs` 的 `SidebarRightTabDefinition` **无 `order` 字段**；`title` 必填且收 `address` 形参 | CONFIRMED | 旧代码多传 `order`、少写形参，cycle-83 已修 |

---

## 2. 服务面全表（本机三棵树静态核验）

### 2.1 `@deepseek-ai/*`（asar 树 `<A>`）真实 `reflect.provide` 键 = 13 个

`documentPreviews`、`layout`、`loader`、`modules`、`pluginNavigation`、`resources`、
`sessions`、`sidebarRight`、`sidebarRightTabs`、`uiRenderer`、`userQuestionPanels`
（+ 宿主侧 `betterSidebar`、`workspaceRegistry`）。

### 2.2 第三方插件树（`<W>` + `<D>`）真实 `reflect.provide` 键 = 2 个

- `betterSidebar` — `<W>\dsh-better-sidebar\lib\client-registry.js:23111`
  `ctx.provide("betterSidebar", service);`
- `market` — `<W>\dshmarket\client\client.js:13943`

### 2.3 幻影裁决（CONFIRMED NEGATIVE）

| 键 | 搜索范围 | 结果 |
|---|---|---|
| `remoteWebUI` | `<A>` / `<V>` / `<W>` 三树 | **零 `provide`、零 `ctx.get`** |
| `spotlight` | 同上 | 仅命中 SVG 白名单字符串 `"feSpotLight"` 与内部函数名 `registerCommandConversationNode` |
| `desktopProfiles` | 同上 | 仅 `dshmarket` 命中，且 `dshmarket\lib\index.js:34` 自带注释「no flag, no `desktopProfiles` service either」 |

**真实的相关名字是 `remoteWebUiPairing`（host 侧配对鉴权服务）**，出现在
`@linxin666/dsh-remote-web-ui\lib\index.js:697`
`const REMOTE_WEB_UI_PAIRING = "remoteWebUiPairing";`（注释「Named lookup key sibling plugins pass to ctx.get.」）。
它**没有** `registerPanel` / `openPanel` / `subscribeState` / `getSnapshot` 面。

> **教训（已写入 CLAUDE.md）**：一个服务键是否存在，必须用 `provide(` 的静态扫描
> **加上**真实 `ctx.get` 调用点双向确认；只凭「某个插件 README 提到过」或
> 「按命名规律应该有」就写进适配层，会造出永不执行的分支和虚假兼容性叙事。

---

## 3. 代际判别：唯一可靠信号

对 `<A>` 与 `<V>` 的 `*\lib\*.js` 跑 `provide\(\s*["']<key>["']` 计数：

| 服务键 | gen2 | gen1 | 可定代？ |
|---|---|---|---|
| `pluginNavigation` | 1 | **0** | ✅ 是 |
| `userQuestionPanels` | 1 | **0** | ✅ 是 |
| `sidebarRightTabs` | 1 | 1 | ❌ 否 |
| `documentPreviews` | 1 | 1 | ❌ 否 |
| `commandUi` | 0 | 0 | ❌ 否（经 `Service` 基类注册，静态扫描看不到） |
| `uiSession` | 0 | 0 | ❌ 否（同上） |

提供点：
- `pluginNavigation` — `<A>\dsh-client-ui-plugin-manager\lib\client.js`
  `ctx.reflect.provide("pluginNavigation", { openBundle: (packageName) => { ctx.layout.selectPanel(PANEL_ID); instance.actions.setView({ kind: "list" }); …`
- `userQuestionPanels` — `<A>\dsh-client-ui-user-questions\lib\client.js`
  `ctx.reflect.provide("userQuestionPanels", { reveal: (sessionId, callId) => …, review: (sessionId, callId, record) => … })`

**注意**：`dsh-client-ui-plugin-manager` 这个**包**两代都存在（gen1 `package.json` version = `0.1.7-rc.1`），
但 `pluginNavigation` 的 provide **只在 gen2** 出现。⇒ **定代必须用服务键，不能用「包是否存在」。**

### 3.1 跨代一致性：slot 注册核心

`dsh-client-ui-slots\lib\index.js` 在 `<A>` 与 `<V>` **逐字节相同**：
SHA256 `57E1314E31A2015F30231E1E7596DA658F1BB5CB64C103C4CF13381647412C99`，均 23,461 B。
差异只在类型：gen1 **不发布** `lib/types/`。

⇒ `ctx.slots.inject(key, cb)` / `ctx.slots.register(options, component)` 的语义在两代完全一致。

---

## 4. `conversation.view`：顶层标签栏席位（objective #4 的权威依据）

### 4.1 声明

`<A>\dsh-client-ui-conversation\lib\types\client\contract\slots.d.ts:183-188`：
```ts
/** Registered Conversation target Views, rendered one at a time. */
'conversation.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps; }
```
`kind: 'list'` ⇒ **可叠加**：多个注册项并排成为多个标签，而不是互相遮蔽。
（对比 `single` 型的 `'root'`，其 JSDoc 明确警告注册会**顶掉整个 AppFrame**。）

### 4.2 投影

`<A>\dsh-client-ui-conversation\lib\types\client\contract\views.d.ts`：
```ts
interface ViewTab { id: string; label: string }
// "One conversation view tab, projected from a 'conversation.view' slot entry's
//  registration options (label falls back to the entry id)."
```

### 4.3 同席位的既有注册者（本插件的邻居）

- `<A>\dsh-client-ui-chat\lib\client.js:12390-12392` → `id: "chat"` → 「对话」
- `<A>\dsh-client-ui-trajectory\lib\client.js:8736-8744` → `id: "trajectory"` → 「轨迹」

两者都用 `ctx.slots.inject("conversation.view", () => ctx.slots.register({ name: "conversation.view", id, order, locale, label, children }, component))`。

### 4.4 声明者与生命周期

`<A>\dsh-client-ui-conversation\lib\client.js:17843-17847`：`conversation.view` 由
`name: "conversation.session"` 条目**声明**（`children: { "conversation.view": { kind: "list", scope: "session" } }`），
因此只在会话面板挂载时存在。`ctx.slots.inject` 的回调会在声明就绪后运行，**无需自己重试**。

### 4.5 gen1 的并行旧路径（本项目不采用）

`<V>\dsh-client-ui-trajectory\lib\client.js:1617-1618` 用
`ctx.uiConversation.views.register(trajectoryViewDefinition)`（注意 gen1 用 `definition.target` 而非 `id`）。
但 `<V>\dsh-client-ui-conversation\lib\client.js:17692-17701` 生成标签时读的是
`slots.entries("conversation.view")` ⇒ **slot 才是投影真源**，`uiConversation.views.register` 是并行的旧入口。

⇒ **本项目只用 slot 路径，两代通用。**

---

## 5. 网页端 vs 桌面端

### 5.1 不存在桌面客户端平台（CONFIRMED）

`<A>\dsh-client-modules\lib\index.js:713-719`：
```js
const decl = parseDshClient(packageName, dsh !== null && typeof dsh === "object" ? dsh.client : void 0);
if (decl === void 0 || decl.platform !== "web") { this.pkgMeta.set(sourceKey, null); return null; }
const clientRel = clientExportOf(packageName, pkg.exports);
if (clientRel === void 0) throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`);
```
⇒ **只有 `dsh.client.platform === 'web'` 的客户端半会被加载**。桌面端与网页端**共用同一个 web 半**。

### 5.2 桌面端判别 = DOM 属性（唯一权威）

`<A>\dsh-client-ui-primitives\lib\types\darwin-desktop.d.ts`（8 行）JSDoc 逐字：
> Whether the client runs in the macOS desktop shell: the Electron preload marks `<html>` with
> `data-platform="darwin"`; plain web never sets it. **Read at render time — the mark may arrive
> as late as DOMContentLoaded.** @returns true only inside the macOS Electron shell.

实现 `<A>\dsh-client-ui-primitives\lib\index.js:8070-8072`：
```js
function isDarwinDesktop() { return document.documentElement.dataset.platform === "darwin"; }
```

官方消费点（证明这是 DSH 内部约定，不是本项目发明）：
- `<A>\dsh-client-ui-layout\lib\client.js:240` `const darwin = document.documentElement.dataset.platform === "darwin";`
- `<A>\dsh-client-ui-layout\lib\client.js:241` `const collapsedWidth = darwin || document.documentElement.hasAttribute("data-windows-titlebar") ? 0 : 56;`
- `<A>\dsh-client-ui-layout\lib\client.js:319`、`<A>\dsh-client-ui-sidebar\lib\client.js:224`、`<A>\dsh-client-shortcuts\lib\client.js:721`

CSS 变量（`<A>\dsh-client-ui-layout\lib\client.js:73`）：
```css
html[data-platform=darwin]{--dsh-frame-top-clearance:48px}
html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);--dsh-frame-chrome-top:var(--dsh-windows-titlebar-height)}
```

**写入者是 Electron preload，不在 asar 的 `@deepseek-ai` 树内**（全树 grep 只命中读取点与 CSS）。
`process.versions.electron` **全树零命中**。

⇒ 本项目 `src/client/compat/PlatformProbe.ts` 的 `detectHostPlatform()` **每次调用重读 DOM**，
并由 `observeHostPlatform()` 用 `MutationObserver` 在标记晚到时通知重算。

### 5.3 `remote-web-ui` 幻影的真实替代

`@linxin666/dsh-remote-web-ui` v0.4.4
（`C:\Users\86156\.dsh\profiles\desktop\node_modules\@linxin666\dsh-remote-web-ui\`）**不提供任何 panel/tab API**：
- `lib\client.js:5552` `ctx.slots.inject("sidebar.footer.action", …)` + `:5556` `ctx.slots.register(...)`
  ⇒ 与本项目 `SlotsFallback.ts` 抢同一席位（`list` 型，两者并排出现，非冲突）。
- 可探测的 DOM 标记：`:4155 ACTIVE_CLASS = "dsh-remote-portrait"`、`:4168 STYLE_SELECTOR = \`style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]\``。
- 移动判定 `:4217 isMobilePortrait()` = `matchMedia("(orientation: portrait)").matches && matchMedia("(pointer: coarse)").matches && window.innerWidth < 1100`。

⇒ 「远程窄屏」是**版面适配维度**（`PlatformProbe.isRemoteNarrow`），不是一条独立集成通道。
本项目已在 `responsive.css` 用 `body.dsh-remote-portrait` 三条规则适配。

---

## 6. 版本门与兼容矩阵

### 6.1 声明式 vs 强制门（CONFIRMED）

| 机制 | 谁读 | 是否强制 |
|---|---|---|
| `dsh.manifestVersion` | 无人 | ❌ 纯声明 |
| `engines.dsh` | **无人**（`<A>` 全树 grep `engines?.dsh`/`engines.dsh`/`dshApiVersion` **零命中**） | ❌ 纯声明 |
| `peerDependencies` 上的 `@deepseek-ai/dsh*` | `dsh-app-boot\lib\index.js:252-322 evaluatePluginCompatibility()` | ✅ **唯一强制门** |

`<A>\dsh-package-manifest\README.md:93` 逐字：
> **Compatibility is declarative.** 当前安装器与加载器都不强制 `dsh.manifestVersion` 或 `engines.dsh`；
> 声明 range 既不会拒绝不兼容宿主，也不校验 SemVer 语法。

`<A>\dsh-app-boot\README.md:52` 逐字：
> DSH 把插件 `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` 的 `peerDependencies` 与
> `getDshRuntimeVersion()` 返回的**单一**运行时版本比对。每个声明的 range 都必须匹配；
> 预发布参与匹配。**缺失 DSH peer 不施加约束；非法 range 视为不兼容。
> 这些检查用 peer 声明，不用 `engines.dsh`**，且不是针对恶意包代码的沙箱。

`evaluatePluginCompatibility` 关键行（`dsh-app-boot\lib\index.js`）：
```js
if (!Object.hasOwn(fields, "peerDependencies")) return void 0;
if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
const requirement = ["workspace:^","workspace:~","workspace:*"].includes(range) ? runtimeVersion : range;
if (requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range;
```

精确版本豁免在 profile 的 `compatibility.json`（`<A>\dsh-app-boot\README.md:56`）：
> 把精确 `package-name@version` 键映射到精确 DSH 运行时版本列表；插件升级与 DSH 升级都不继承许可。

本机实况：`C:\Users\86156\.dsh\profiles\desktop\compatibility.json` = `{ "dsh-codearts-auth@0.5.0": [ "0.2.0-rc.2" ] }`；
`C:\Users\86156\.dsh\profiles\web\compatibility.json` 含
`"dsh-codegraph-visualizer@0.2.0": ["0.2.0-rc.2"]` 与 `"dsh-codegraph-visualizer@2.1.0": ["0.2.0-rc.2"]`。

### 6.2 本项目 peer 范围实测（用 DSH 自带 semver，`includePrerelease: true`）

范围 = `^0.2.0-rc.2 || ^0.3.0-rc.2`（`@deepseek-ai/dsh-llm` 与 `dsh-tools` 各一条）：

> **cycle-92 裁定**：下限由 `>=0.1.7-rc.2` 抬高到 `>=0.2.0-rc.2`，peer 同步去掉 `^0.1.7-rc.2`。
> 下表是**抬高后**的实测结果；抬高前的历史结果见 §6.5。

| 探测版本 | 结果 | 说明 |
|---|---|---|
| `0.1.7-rc.1` | **REFUSED** | **VS Code 扩展那套 gen1 树全为 `0.1.7-rc.1`** ⇒ 本插件在其中会被 peer 门拒绝 |
| `0.1.7-rc.2` | **REFUSED** | cycle-92 抬窗后不再承诺 gen1 |
| `0.2.0-rc.2` | PASS | 本机运行版本 |
| `0.3.0-rc.2` | PASS | |
| `0.4.0` | **REFUSED** | |
| `1.0.0` | **REFUSED** | |

`validRange('^0.2.0-rc.2')` = `>=0.2.0-rc.2 <0.3.0-0`；
`validRange('^0.3.0-rc.2')` = `>=0.3.0-rc.2 <0.4.0-0`。

**为什么下限是 `rc.2` 而不是 `0.2.0` 正式版**：DSH 目前只发布 `0.2.0-rc.x`，
`^0.2.0-rc.2` 在 semver `includePrerelease` 语义下同时覆盖 `0.2.0-rc.2` 与将来的 `0.2.0` 正式版。
写 `>=0.2.0` 会**当场拒绝本机正在运行的那个版本**。

### 6.3 兼容矩阵（本项目立场）

| DSH 版本 | 代 | peer 门 | 适配器建模 | 本项目实测 |
|---|---|---|---|---|
| `0.1.7-rc.1` | gen1 | ❌ REFUSED | gen1 | 未安装验证（VS Code 扩展树） |
| `0.1.7-rc.2` | gen1 | ❌ REFUSED | gen1（容忍，不承诺） | 未安装验证 |
| `0.2.0-rc.2` | gen2 | ✅ PASS | gen2 | ✅ **J0 真机验证通过**（顶层第三标签渲染） |
| `0.3.0-rc.2` | gen3 | ✅ PASS | gen3（= gen2 超集） | 未发布，不可验证 |
| `0.4.0+` / `1.x` | 适配器归 gen3 | ❌ REFUSED | gen3 | 未发布 |

**语义漂移（如实记录）**：`src/shared/dshGeneration.ts` 的 `generationOfVersion` 把 `0.4.x`/`1.x`
刻意归为 `gen3`（建模为 gen2 的前向兼容超集），但 peer 门**拒绝**它们。
⇒ **peer 门比适配器模型更保守**。这不是 bug：适配器模型是「如果能加载，我按哪代语义工作」，
peer 门是「我承诺验证过哪些版本」。两者回答的是不同问题，因此**不强行对齐**，
但必须在文档里写明，避免把「模型支持 gen3」误读为「已声明支持 0.4」。

### 6.4 是否把 peer 扩到 `^0.1.7-rc.1`？

**决定：不扩。** 理由：
1. `0.1.7-rc.1` 只出现在 VS Code 扩展的内嵌树里，**不是**用户可安装的 DSH 运行时；
2. 扩范围意味着承诺在该版本上可用，而本机**没有任何** `0.1.7-rc.1` 真机环境可验证；
3. DSH 的兼容声明哲学就是「声明 = 已验证」，无证据的扩范围与该哲学冲突。

`engines.dsh`（`>=0.2.0-rc.2 <0.4.0`）保持与 `DSH_SUPPORTED_RANGE` 逐字相等（由测试钉死），
其语义是「适配器建模的窗口」，**不是**安装许可——后者只由 peer 门决定。

### 6.5 cycle-92 抬窗（历史留痕）

抬高前的实测（peer = `^0.1.7-rc.2 || ^0.2.0-rc.2 || ^0.3.0-rc.2`）：
`0.1.7-rc.1` REFUSED、`0.1.7-rc.2` PASS、`0.2.0-rc.2` PASS、`0.3.0-rc.2` PASS、
`0.4.0` REFUSED、`1.0.0` REFUSED。

抬高的**唯一依据**是用户 objective #3 的明确措辞；工程上并非必需（gen1 的 `0.1.7-rc.2` 是真实可安装的
DSH 运行时）。裁定记录：`ask_user_question` 超时未获答复（审批提示已禁用）⇒ 按 L4 自主权裁定并留痕。

**代价（如实记录）**：gen1（0.1.x）宿主上本插件将被 peer 门拒绝安装。适配器代码与
`generationOfVersion` 的 `minor === 1 → 'gen1'` 分支**刻意保留**，因为「能识别」与「被承诺」是两件事，
把可识别宿主报成 `unknown` 会让能力探针失去保守基线依据（`src/shared/dshGeneration.ts:58-60` 已注释）。

---

## 7. 清单与入口契约（要点）

| 字段 | 读取点 | 约束 |
|---|---|---|
| `main` | `<A>\dsh-app-boot\lib\index.js:1335-1336` | 必须 string 且解析到同一文件 |
| `exports["./client"]` | `<A>\dsh-client-modules\lib\index.js:170-181` | string 或含 string `default`；缺失则抛 `` declares dsh.client but exports no "./client" bundle `` |
| `dsh.bundle.patch` | `<A>\dsh-app-boot\lib\index.js:497` | 必须 string 或 string[]，否则抛 `dsh.bundle.patch must be a file path or a list of file paths` |
| `dsh.client.platform` | `<A>\dsh-client-modules\lib\index.js:65` | 必须 string；只有 `'web'` 会被加载 |
| `dsh.client.inject` | 同上 `:720-728` | **仅用于激活排序**，不是 cordis 服务注入（`dsh-package-manifest` 的 JSDoc 逐字：「Informational package-name dependencies, not Cordis service injection.」） |
| `icon` | `<A>\dsh-app-boot\lib\index.js:1850-1891` | ≤ 256 KiB；仅 `.svg/.png/.jpg/.jpeg/.webp`；拒绝绝对路径/URL、realpath 逃逸 |
| `dsh.profile.bundles` | `<A>\dsh-app-boot\lib\index.js:468/473/574/896/958` | 仅 profile 字段，有序 |

**NOT FOUND**：无 `contributes` 字段、无 `dshApiVersion`。

`ctx.effect` / `ctx.slots.*` / `ctx.webServer.register` / `ctx.tools.register` 四类 API **全部返回 disposer**
（`<C>\lib\types\fiber.d.ts:415-418`、`dsh-cordis-client-runner\lib\client.js:1367-1368`/`:1384-1394`、
`<A>\dsh-host-webserver\lib\index.js:171-184`、`<A>\dsh-tools\lib\index.js:2872-2887`）。

**关键契约（`dsh-client-runtime\lib\types\client\slots.d.ts`）**：
`SlotRegistry.register` **必须保持原型方法，绝不能改成实例箭头属性** ——
cordis service proxy 在调用时把 `this.ctx` 绑定到调用者 context，这才把 effect 与卸载级联
路由进调用者的 fiber；箭头属性会把 `this` 冻结到 service 自己的 root ctx 并**静默破坏 per-plugin disposal**。

---

## 8. cycle-83 落地清单（与本文一一对应）

| 改动 | 对应结论 |
|---|---|
| 删 `RemoteWebUiIntegration.ts` + `ClientCompatLayer` 的 `'remote-web-ui'` 模式/标志 + `IntegrationState` 四个成员 + `src/types/index.ts` 的 `Context['remoteWebUI']` 声明 + `constants.ts`/`responsive.css`/`HostCapabilityProbe`/`FeatureFlags` 的相关条目 | §2.3 |
| 删 `SpotlightIntegration.ts` + `spotlight` 标志/探测/声明；新增 `CommandUiIntegration.ts`（`ctx.commandUi.register`，5 条 `kind:'action'` 命令） | §2.3 + §1#10 |
| 删 `desktopPlatform` 的服务探针；新增 `PlatformProbe.ts`（`detectHostPlatform` / `observeHostPlatform`，惰性重读 DOM） | §5.1 / §5.2 |
| `ClientVersionDetector.detectFromApiShape` 改用 `pluginNavigation`/`userQuestionPanels` 定 gen2；`sidebarRightTabs`/`documentPreviews` 只作「身处客户端」的下界证据 | §3 |
| `SidebarRightTabsIntegration`：删 `order`、补 `keepMounted: true`、`title` 补 `address` 形参 | §4 + §9 |
| `SpotlightBridge.ts` → `PanelEventBridge.ts`（纯 DOM 桥，不依赖任何幻影服务） | §2.3 |
| 全部 compat 层与集成层文件注释改中文 | objective #3 |

---

## 9. 补充：`sidebarRightTabs` 真实契约（`dsh-client-ui-sidebar-right`）

`<A>\dsh-client-ui-sidebar-right\lib\types\client\tab-registry.d.ts:75-120` 的
`SidebarRightTabDefinition`：
- `readonly id: string` — 「unique across every registration (a package name is the natural value)…
  **it is the key its body and title register under in the `sidebar.right.pane.tab` and
  `sidebar.right.pane.tab.title` seats**」
- `readonly kind: string` — 「what `openTab` names」
- `readonly multiple?: boolean` — 「Each open by kind creates independent content; omission keeps one page per kind in each pane」
- `readonly keepMounted?: boolean` — 「Lazily keep a visited body mounted through hiding, Session changes and docking; default false」
- `readonly patterns?: readonly string[]`
- `readonly priority?: SidebarRightTabPriority` — 「Defaults to `extension`」
- `readonly canOpen?: (address: string) => boolean`
- **`readonly title: (address: string) => string`（必填，收 address 形参）**
- `readonly guide?: readonly SidebarRightGuideEntry[]`
- **无 `order` 字段。**

`RANKS` 精确值（`<A>\dsh-client-ui-sidebar-right\lib\client.js:8618-8625`）：
```js
/** Rank of each band, highest first. */
const RANKS = { extension: 3, builtin: 2, fallback: 1 };
/** The band a definition that names none is in. */
const DEFAULT_BAND = "extension";
```
`coexists(slot, band)`（`:8630`）= `band !== "fallback" && slot.inForce.band !== "fallback" && slot.inForce.band !== band && slot.shadowed === void 0`
⇒ 同 band 二次注册抛错；`extension` 可接管 `builtin`。

`keepMounted` 的真实消费点：`:5522 const retained = seat === "sidebar.right.pane.tab" && definition?.keepMounted === true;`

---

## 10. `dsh-better-sidebar` 真实契约（第三方，本机 v0.24.1）

`<W>\dsh-better-sidebar\lib\types\client\service.d.ts`：
- `SIDEBAR_SERVICE_VERSION = "0.24.1"`
- `SIDEBAR_FEATURES = ["badge","tabLifecycle","updateTab","openFile","targetedOpen","stateSubscription","tabMeta","pluginSettings","urlTarget","settingSelect","fileIcons"]`
  （11 项；**v0.19.0 已移除 `floatWindows`**）
- `registerTab(descriptor: TabDescriptor): () => void`
- `OpenTabSeed = { type: string; title?; path?; diff?; id?; url?; meta?; target?: 'right' | 'bottom' | 'side' }`
  （`'right'` 默认，落 DSH 原生右侧栏；`'bottom'` 是插件自有底部工作台；`'side'` 也指右侧栏但落第二 pane）
- `TabDescriptor.order?: number`（**默认 100**）、`single?`、`dedupeKey?`、`badge?`、`onOpen/onActivate/onClose?`、`component`
- 提供点：`<W>\dsh-better-sidebar\lib\client-registry.js:23111` `ctx.provide("betterSidebar", service);`

**能力协商原则**：本项目只在 `badge` / `tabLifecycle` / `stateSubscription` 三个能力上报时才挂对应钩子。

---

## 11. 研究方法与可复现命令

```powershell
# 服务面静态扫描（判定某个键是否存在）
$a = "C:\Users\86156\.dsh\profiles\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai"
$v = "C:\Users\86156\.vscode\extensions\zwb8926.deepseekharness-for-vscode-2026.9.24\node_modules\@deepseek-ai"
foreach ($key in @('pluginNavigation','userQuestionPanels','sidebarRightTabs','documentPreviews')) {
  $g2 = (Get-ChildItem $a -Recurse -Filter *.js -File | Select-String -Pattern "provide\(\s*[`"']$key[`"']" | Measure-Object).Count
  $g1 = (Get-ChildItem $v -Recurse -Filter *.js -File | Select-String -Pattern "provide\(\s*[`"']$key[`"']" | Measure-Object).Count
  "$key gen2=$g2 gen1=$g1"
}
```

```javascript
// peer 范围实测（必须用 DSH 自带的 semver，本项目 node_modules 无顶层 semver）
const semver = await import('file:///C:/Users/86156/.dsh/profiles/node_modules/@deepseek-ai/dsh/node_modules/semver/index.js');
const range = '^0.2.0-rc.2 || ^0.3.0-rc.2';   // cycle-92 抬窗后的实际声明
for (const v of ['0.1.7-rc.1','0.1.7-rc.2','0.2.0-rc.2','0.3.0-rc.2','0.4.0','1.0.0'])
  console.log(v, semver.default.satisfies(v, range, { includePrerelease: true }) ? 'PASS' : 'REFUSED');
```

**不可用的工具**：`cordis-api` skill 与 `dsh-plugin-dev-kb` skill **都不存在**。
等价物是随包发布的 `<A>\dsh-agent-preset\skills\`（4 个：`agent-experience`、
`cordis-composition-reference`、`cordis-plugin-development`（含 `references\host-plugin.md`、
`ui-plugin.md`、`verification.md` 等）、`editing-cordis-compositions`）。
