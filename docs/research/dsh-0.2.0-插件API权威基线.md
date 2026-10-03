# DSH 0.2.0-rc.2 插件 API 权威基线（本项目对齐依据）

> 采集方式：解包 `D:\DSH\DeepSeek Harness\resources\app.asar`（DSH 桌面端实际运行时归档），
> 直接读取 `@deepseek-ai/*` 官方包源码与 README。**非推测**，每条附证据路径。
> 采集工具：`.cycles/tmp-asar.mjs`（asar 只读扫描/提取，临时脚本）。
> 运行时版本：`@deepseek-ai/dsh@0.2.0-rc.2`，`@deepseek-ai/cordis@4.0.4`。

## 1. 主入口：`conversation.view` 槽位（本项目最高优先级需求）

### 1.1 槽位真实存在，且是顶部标签栏的唯一权威来源

| 事实 | 证据（asar 内路径:行） |
|---|---|
| `conversation.view` 由 `conversation.session` 条目**声明**为 `list` / `scope: session` | `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:18209-18214` → `name:"conversation.session"`, `children: { "conversation.view": { kind: "list", scope: "session" } }` |
| 顶级客户端 runner 明确记载「`conversation.view` 由 client-ui-chat 的条目声明」 | `@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2538` |
| 「对话」标签 = `id:"chat"`, `order:0` | `@deepseek-ai/dsh-client-ui-chat/lib/client.js:12390-12400` |
| 「轨迹」标签 = `id:"trajectory"`, `order:10`, 带 `locale` 与 `children` | `@deepseek-ai/dsh-client-ui-trajectory/lib/client.js:8736-8769` |
| 顶层 shell 通过 `slots.entries("conversation.view")` **枚举**条目构建标签栏 | `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:17972-17984` |

### 1.2 官方给出的注册范式（逐字，与本项目实现一致）

`@deepseek-ai/dsh-cordis-client-runner/lib/client.js:3772` 内的官方示例字符串：

```js
return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('conversation.view', () => ctx.slots.register(
      { name: 'conversation.view', id: 'my-entry', order: 100, label: 'My entry' },
      () => React.createElement('div', null, 'hello'),
    ))
  },
}
```

**结论**：本项目 `src/client/integrations/ConversationViewIntegration.ts:19-47` 的写法
（`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name, id, order, label }, component))`）
**与 DSH 官方范式完全一致**，槽位名正确、API 形状正确。

### 1.3 标签栏构建的硬性规则（决定条目是否可见）

来自 `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:17972-17984`：

1. **无 `id` 的条目被静默跳过** — `if (entry.options.id === void 0) continue;`
2. **标签文案** = `resolveSlotLabel(entry.options.label) ?? entry.options.id`（函数或字符串均可）
3. **开发者工具门控**：`if (!ctx.configForms.developerTools.enabled.getSnapshot() && entry.options.id === "trajectory") continue;`
   → **「轨迹」标签默认可能不显示**（需开启开发者工具）。验证 J0 时不能假定「对话+轨迹」两个标签同时存在。
4. `refreshViews` 订阅 `slots.subscribe("conversation.view", …)`，注册/注销都会刷新标签栏并 `restoreView`。

### 1.4 `ctx.slots.register` 的加载期校验（违反即 throw）

来自 `@deepseek-ai/dsh-client-ui-slots/lib/index.js:163-200`：

| 校验 | 抛错信息 |
|---|---|
| 槽位未声明 | `slot "${name}" is not declared (a parent entry's children table must declare it)` |
| `list` 缺 `id` | `list slot "${name}" requires options.id` |
| `list` id 重复 | `list slot "${name}" already has an entry with id "${id}"` |
| `single` 已占用 | `single slot "${name}" already has a registration` |
| `keyed` 缺 `key` / 重复 | `keyed slot "${name}" requires options.key` |

**推论**：本项目在 `ConversationViewIntegration.ts:50-52` 用 `try/catch + log.warn` 包住注册。
若槽位名错误或 `id` 冲突，会**静默降级为"没有标签页"**——必须靠运行时证据（J0）确认，不能靠单测。

### 1.5 四种槽位 kind

`single`（单占用）/ `list`（有序，本项目所用）/ `keyed`（按 key 分发）/ `chain`（条目自选举，需 `select`）。
声明纪律：声明即独占渲染权；未声明就注册、重复声明子槽位、chain 无 `select` 均在**加载期**抛错。
（来源：`@deepseek-ai/dsh-client-ui-slots/README.md:28-46`）

## 2. 包清单（manifest）权威字段

来源：`@deepseek-ai/dsh-package-manifest/README.md`（DSH 官方 manifest 类型包）。

### 2.1 合法字段

```ts
const manifest: DshPackageManifest = {
  name: 'example-dsh-plugin',
  version: '1.0.0',
  engines: { node: '>=24', dsh: '0.1.5-alpha.1' },   // ← 兼容性声明的权威位置
  dsh: {
    manifestVersion: 1,                               // ← manifest 格式版本，独立于包版本
    bundle: { patch: './cordis.patch.yml' },          // ← 可为单个路径或有序数组
    client,                                           // ← DshClientManifest
  },
}
```

- **客户端清单**：`DshClientManifest = { platform: 'web', inject: [...] }`。
  DSH 自家客户端插件（如 `@deepseek-ai/dsh-client-ui-chat/package.json:28-45`、
  `@deepseek-ai/dsh-client-ui-trajectory/package.json:28-39`）**一律** `client.platform = "web"`。
  → 桌面端与网页端共用同一 web 客户端，`platform:"web"` **不是**"仅网页端"的缺陷，而是 DSH 规范值。
- `dsh.bundle.patch` 支持**有序数组**，launcher 按序应用为一个 bundle layer。

### 2.2 关键限制（直接影响"多代适配"策略选型）

> "**Compatibility is declarative.** Current installers and loaders **do not enforce**
> `dsh.manifestVersion` or `engines.dsh`; declaring a range does not reject incompatible hosts
> or validate SemVer syntax." — `dsh-package-manifest/README.md:93`

**这是本项目架构选型的决定性依据**：DSH **不会**因为清单里声明了版本范围就拒绝加载。
因此"兼容 DSH 多版本 / 预留未来破坏性更新"**必须靠运行时能力探测**，
即本项目 `src/client/compat/ClientCompatLayer.ts` + `src/host/compat/ApiCompatLayer.ts` 的
`safeCheck` 能力探测路线是**正确且唯一可行**的；静态清单只承担"文档 + 元数据"职责。

### 2.3 本项目清单的实测偏差（已完成整改）

判定依据来自 **asar 内的真实读取器**，而非 README 的措辞：

| 项 | 整改前 | 权威读取器与行为 | 整改后 |
|---|---|---|---|
| `dsh.client.platform` | `"web"` | `dsh-client-modules/lib/index.js:714`：非 `"web"` 即视为**没有客户端半边** | ✅ 保持 `"web"` |
| `dsh.client.inject` | 6 项（含 `dsh-better-sidebar`、`dsh-remote-web-ui` 两个第三方） | `client.js:61-75` 仅接受 `platform/inject/external/immediately`；`inject` 成为**模块图边**（`:724`） | ✅ 收敛为 3 个官方包（`dsh-client-ui-conversation`/`-renderer`/`-sidebar-right`） |
| `dsh.hostVersion` | `">=0.1.1-rc.2 <0.4.0"` | DSH 全部 `.js` 零读取 | ✅ 删除，职责交 `engines.dsh` |
| `engines.dsh` | **缺失** | `dsh-package-manifest` 声明的权威兼容位置（不强制） | ✅ `">=0.1.7-rc.2 <0.4.0"`（覆盖三代） |
| `dsh.manifestVersion` | **缺失** | 同上（不强制） | ✅ `1` |
| `dsh.client.entry` | `"./dist/client.js"` | `index.js:718-719` `clientExportOf(packageName, pkg.exports)` → **`exports["./client"]` 唯一权威**；`clientEntry`/`client.entry` 全库 **0 命中** | ✅ 删除 |
| `dsh.displayName`/`dsh.description`/`dsh.category` | 有 | `dsh[?]?\.(displayName\|category\|optionalPlugins\|permissions\|hostVersion\|manifestVersion)` 全库 **0 命中** | ✅ 删除，展示文案改由 `locale/*.json` 承担 |
| `dsh.permissions`/`dsh.optionalPlugins` | 有 | 同上 0 命中；第三方市场也不读（`dshmarket/lib/verify.js` 只读 `dsh.client`/`dsh.bundle`） | ✅ 删除，意图移入文档 + 运行时能力探测 |
| `files` | `["dist","cordis.patch.yml"]` | `app-boot` 需要从包内解析 `locale/` 与图标 | ✅ 增 `locale`、`assets`、`README.md` |
| `exports["./locale/*.json"]` | **缺失** | `app-boot/lib/index.js:1884-1895` 用 **Node ESM resolver** 解析 `${pkg}/locale/en.json`，`ERR_PACKAGE_PATH_NOT_EXPORTED` 被 `missingResource` 吞掉 → **元数据静默消失** | ✅ 补上 |
| `scripts.prepare` | **缺失** | `dist/` 被 `.gitignore` 忽略；`dshmarket/lib/verify.js:184-195` 对"源码检出且入口产物缺失"判定为下一个 boot 会失败 | ✅ 补 `pnpm run build` |

零命中的复验方式：`node .cycles/tmp-asar.mjs <asar> grep '[.]js$' '<pattern>' 10`。

### 2.4 展示元数据的权威契约（locale + icon）

`@deepseek-ai/dsh-app-boot/lib/index.js`：

- `:1969 readPluginMeta(specifier, parentURL)` → `:1972` 读 `${specifier}/locale/en.json`
  （**en.json 是锚点，缺失则所有语言都不读**）→ `:1976 title`、`:1977 description`、
  `:1984 icon = iconOf(manifest?.icon, manifestPath)`。
- `:1925 dictionariesOf()`：读取 en.json **同目录下的每一个 `.json`**，用**文件名（去扩展名）当 language id**，
  必须匹配 `:1850 LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u`；重复 locale 或跨目录即 throw。
  字典键是**小写化**后的文件名（`:1930 const language = entry.name.slice(0, -5);` → `:1932 const id = language.toLowerCase();`），
  因此 `zh.json` 与 `zh-CN.json` 是两个**不同**的键（`zh` / `zh-cn`）。
- **JSON 形状是 `{ "meta": { "title": ..., "description": ... } }`**（不是顶层 title/description）；
  字段存在时必须是非空字符串，否则 throw。
- `:1945 localizedText(field, dictionaries, fallback, finalFallback)` **返回的不是字符串而是语言映射**
  （`:1951-1954 return { en: fallback ?? finalFallback, ...Object.fromEntries(entries) }`），
  即 `{ "en": <manifest.name 或字典 en>, "zh": ..., "zh-cn": ... }`。
  消费端（如 `pluginManager/listBundles` 的 `meta`、设置面板列表）再按**当前界面语言 id 精确取键**：
  **键不存在时不回落 `en`，而是退回包名 + package.json 的 `description`**。
- **语言 id 用 `zh` 而不是 `zh-CN`**：asar 中带 locale 的 **10 个官方包全部只发 `en.json` + `zh.json`**
  （`node .cycles/tmp-asar.mjs <asar> find "node_modules/@deepseek-ai/[^/]+/locale/[^/]+\.json$"` → 10 个 `en.json`、10 个 `zh.json`、**零个 `zh-CN.json`**）。
  文件名与宿主实际索取的 id 不一致时**不报错**，只静默退化为包名（J0 实测教训）。
- `:1860 iconOf(value, manifestPath)`：图标取自 **package.json 顶层 `icon`**（相对路径），
  扩展名必须在 `:1853 ICON_MEDIA_TYPES`（`.svg`/`.png`/`.jpg`/`.jpeg`/`.webp`）内、
  必须留在 manifest 目录内、且 `:1852 MAX_ICON_BYTES = 256 * 1024` 以内；最终内联为 `data:<mime>;base64,...`。
- 容错差异很重要：`:1986-1990` 图标失败只返回 `{...text, error}`，**展示文本仍保留**；
  而 locale 不可解析（含未导出）则**静默退化为包名**。

本项目据此新增 `locale/en.json`、`locale/zh.json`（形状 `{"meta":{"title","description"}}`，
另保留 `locale/zh-CN.json` 作为地区标签别名）与 `assets/icon.svg`（1.1 KiB，相对路径），
并由 `tests/unit/manifest.test.ts` 的 **18 条**断言固化为回归测试。

### 2.5 元数据的解析锚点：安装目录优先（J0 实测的遮蔽陷阱）

`@deepseek-ai/dsh-app-boot/lib/index.js:889-907`：

```js
// Resolve one bundle package's directory: installation anchor first, then the
// profile directory. The installation-first order is the contract that
// `@deepseek-ai/dsh-base` (and every other in-box bundle) always comes from
// the same installation as the running dsh, never from a profile-local copy.
function resolveBundleDir(binName, packageName, installAnchor, profileDir) {
  for (const anchor of [installAnchor, join(profileDir, "package.json")]) { … }
}
```

`@deepseek-ai/dsh-plugin-manager/lib/index.js:1493` 用 `resolveBundleDir("dsh", name, profile.installAnchor, profile.dir)`
再交给 `readPluginMeta(...)`，`:1475 bundleManifest(...)` 也从同一目录取**版本**。

⇒ **若 DSH 安装目录自身的 `node_modules` 里存在本插件的同名副本，bundle 级 `version`/`meta`/`icon`
全部来自那个副本**，profile 里指向本仓库的 `link:` 只在 `rows[]` 与客户端半边生效。
J0 实测正是如此：`D:\JetBrains\nvm\node_global\node_modules\dsh-codegraph-visualizer@2.1.0`
（无 `locale/`、无 `exports["./locale/*.json"]`、无 `dist/client.js`）遮蔽了本体，
导致"已安装"列表显示包名而非 `locale` 标题、图标缺失、版本显示 2.1.0。
把该副本改名让路后（可逆），同一 RPC 立即返回
`version:"0.2.0"`、`meta.title:{en,zh,zh-cn}`、`iconLen:1494`，UI 随即渲染中文标题与图标。

**这不是清单缺陷**：清洁环境中插件只存在于 profile，解析自然命中本体。
但**自测/开发环境必须检查安装锚点是否残留同名旧副本**，否则会追错方向
（详见 `docs/用户旅程.md` 的 J0 前置检查）。

### 2.6 `dsh.client` 的真实语义

- `dsh-client-modules/lib/client.js:61-75 parseDshClient()` 只认 4 个键：`platform`（**必填 string**）、
  `inject`（string[]）、`external`（string[]）、`immediately`（boolean）；**其余键被静默丢弃**，类型不符即 throw。
- `inject` = 模块图边：官方客户端插件（`dsh-client-ui-chat/package.json:28-45`、
  `dsh-client-ui-sidebar-right/package.json:28-39` 等）**只列 `@deepseek-ai/*` 官方包**，
  从不列第三方插件 —— 本项目整改后与官方范式一致，第三方集成全部退回运行时能力探测。
- `external` 用于"我 require 但不打包进来"的模块（`:428` 禁止声明自身包名）。
- 官方客户端插件的 `peerDependencies` 统一为 `{ "@deepseek-ai/cordis": "~4.0.4" }`。

### 2.7 插件市场的发现路径：策展索引，不是关键词搜索

用户要求"支持在 dsh-market 等插件市场能搜到本项目"。查 `dshmarket@1.66.5` 源码后结论是：
**市场不按 npm 关键词搜索**，它读的是一份**策展索引**：

- `dshmarket/src/regions.ts:80`：`const CATALOG_OFFICIAL = 'https://awesome-dsh-plugin.com/plugins.json'`
  （注释写明用自定义域名而非仓库路径是刻意的：仓库改名/迁移后地址仍有效，且 Pages 前面有 CDN）。
- `dshmarket/src/regions.ts:82-92`：目录源有两种传输 —— `{kind:'url', url}` 与
  `{kind:'npm', registry, pkg}`；后者让目录**搭 npm 镜像的便车**并带上可回滚的版本号，
  中国区路由用的就是 npm 镜像那条（`:154`）。
- `:103-109`：目录是市场发出的**第一个请求**，每个区域的源列表最后都留一条"一直可用"的直连兜底。
- `dshmarket/lib/verify.js` 只读 `dsh.client` / `dsh.bundle`，并靠 `clientBundlePath(exports['./client'])`
  定位客户端产物（`lib/verify.js:303/320/416-418`）。

**推论**：`package.json` 的 `keywords`（本项目已有 18 个，含 `dsh`/`dsh-plugin`/`dsh-market`）
与 `repository` 字段**都不能让插件出现在市场里**；上架需要向该策展索引提交条目。
`repository`/`homepage`/`bugs` 的作用是让 npm 页面与索引条目能正确回链（已补齐，并由
`tests/unit/manifest.test.ts` 固化）。`docs/开发计划.md:203`、`docs/需求分析.md:587`
的"发布 npm + 上架市场"因此是**外部动作**，不在本仓库内可完成的范围。

## 3. 版本矩阵与偏斜

| 包 | DSH 运行时（asar） | 本项目 node_modules | 本项目声明 | 判定 |
|---|---|---|---|---|
| `@deepseek-ai/cordis` | `4.0.4` | `4.0.4` | devDep `^4.0.4`；peer `^4.0.1` | ✅ 构建期与运行时精确对齐 |
| `@deepseek-ai/dsh-client-connection` | `0.2.0-rc.2` | —（已移除） | **原仅 peer，现整条删除** | ✅ 偏斜随死声明一并消除 |
| `@deepseek-ai/dsh-llm` | `0.2.0-rc.2` | `0.2.0-rc.2` | devDep `0.2.0-rc.2` | ✅ |
| `@deepseek-ai/dsh-session` | `0.2.0-rc.2` | —（已移除） | **原 peer+devDep，现删除** | ✅ 全库零引用 |
| `@deepseek-ai/dsh-tools` | `0.2.0-rc.2` | `0.2.0-rc.2` | devDep `0.2.0-rc.2` | ✅ |

**偏斜的真实根因与更好的修法**：`dsh-client-connection` 的 `0.1.7-rc.2` 由传递依赖提升而来，
只因清单里有一条**从未被 import** 的 peer 声明才显得"偏高"。`src/**` 的实际导入面只有
`@deepseek-ai/cordis`（21 处）、`@deepseek-ai/dsh-llm`（1 处）、`@deepseek-ai/dsh-tools`（1 处）与
`react`/`react-dom`（83 个文件）；`dsh-session` 在 `src/`、`tests/`、`tsconfig*.json` 中**零命中**。
因此本轮采取的修法是**删除死声明**而非升级版本号：`pnpm install` 后 `node_modules/@deepseek-ai/`
只剩 `cordis@4.0.4`、`dsh-llm@0.2.0-rc.2`、`dsh-tools@0.2.0-rc.2` 三个包，锁文件同步收缩。

**`peerDependencies` 故意保留 `^4.0.1`（而非官方的 `~4.0.4`）**：本项目是**跨代发布的第三方插件**，
gen1（0.1.7-rc.2）宿主可能携带更早的 cordis 4.x；而 devDep 取 `^4.0.4` 保证 `tsc` 面向当前运行时 API 校验。
这是"宽 peer / 严 devDep"的有意分歧，不是为了对齐官方而收窄兼容面。

## 4. DSH 运行时同时提供的、与本项目相关的能力包

- `@deepseek-ai/dsh-client-ui-slots`（槽位注册纯核心，React-free）
- `@deepseek-ai/dsh-client-ui-renderer`（React 槽位渲染器 + `ctx.slots.inject` 事件桥）
- `@deepseek-ai/dsh-client-ui-conversation`（声明 `conversation.view` / `conversation.content`）
- `@deepseek-ai/dsh-client-ui-layout`、`dsh-client-ui-primitives`
- `@deepseek-ai/dsh-desktop-host`（桌面端宿主 → 对应本项目 `desktopPlatform` 探测）
- `@deepseek-ai/dsh-client-ui-sidebar-right`（`sidebar.right.pane.tab` 槽位 —— 本插件其他入口）
- `@deepseek-ai/dsh-typert-{protocol,loader,registry}`（类型协议层）
- `@deepseek-ai/dsh-plugin-manager`、`dsh-host-plugin-inventory`（插件管理已内建）

**`dsh-better-sidebar` / `dsh-remote-web-ui` / `dsh-codegraph` / `dshmarket` 不在 DSH 官方包内**
→ 均为第三方市场插件，本项目对其集成必须保持**可选 + 能力探测**（现状正确）。

## 5. 实测环境事实（J0 前置）

- 真实 profile：`C:\Users\<user>\.dsh\profiles\web\`
  - `package.json` 已含 `dsh-codegraph-visualizer": "link:D:/Projects/TraeProjects/dsh-codegraph-visualizer"`
  - `dsh.profile.bundles` 已含 `dsh-codegraph-visualizer`
  - `cordis.patch.yml` 末行 `- id: codegraph-visualizer, name: dsh-codegraph-visualizer`
  - `node_modules/dsh-codegraph-visualizer` 是 **Junction**（指向项目根）
  - `node_modules/.ignored_dsh-codegraph-visualizer` 存在残留目录（历史隔离痕迹，待评估）
  - `compatibility.json` 记录 `dsh-codegraph-visualizer@0.2.0 → 0.2.0-rc.2`
- 同 profile 并存第三方插件：`dsh-better-sidebar@0.24.1`、`dsh-codegraph@0.1.3`、
  `dshmarket@1.66.5`、`dsh-plugin-hub@0.2.0`、`dsh-plugin-diraud`、`dsh-freeroute`、`@loveebb/dsh-plugin-manager`
  → **插件共存场景是真实存在的**（对应用户旅程"多插件共存"）。
- `@deepseek-ai/dsh-client-ui-slots` **未安装进任何 profile 的 node_modules**——它由 asar 运行时提供。

## 6. 对后续开发的门禁结论

1. **主入口正确**：`conversation.view` 槽位名与注册范式经官方源码逐字确认，无需改槽位名。
2. **唯一可信验收 = 运行时**：槽位注册失败会在加载期抛错并被本项目 try/catch 吞掉，
   因此 **J0 必须在真实 DSH + Chrome DevTools MCP 下验证标签实际渲染**（单测无法证伪）。
3. **多代适配走运行时探测**：DSH 明确不强制静态兼容声明，本项目能力探测路线正确；
   应补 `engines.dsh` / `dsh.manifestVersion` 作为规范化元数据，并移除/保留 `hostVersion` 需决策。
4. **版本偏斜需修**：补 `@deepseek-ai/dsh-client-connection@0.2.0-rc.2` 到 devDependencies。
