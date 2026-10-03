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

### 2.3 本项目清单的实测偏差

| 项 | 本项目现状 | DSH 规范 | 判定 |
|---|---|---|---|
| `dsh.client.platform` | `"web"` | `"web"`（官方同值） | ✅ 正确 |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` | 支持 | ✅ 正确 |
| `dsh.client.inject` | 6 项（含 3 个第三方/官方包） | 官方亦用 `inject` 数组 | ✅ 形状正确（内容待核） |
| `dsh.hostVersion` | `">=0.1.1-rc.2 <0.4.0"` | **DSH 全部 `.js` 内 `hostVersion` 零命中** | ⚠️ 非规范字段（no-op） |
| `engines.dsh` | **缺失** | 权威兼容声明位置 | ❌ 应补 |
| `dsh.manifestVersion` | **缺失** | 推荐为 `1` | ❌ 应补 |
| `dsh.client.entry` | `"./dist/client.js"` | 官方靠 `exports["./client"]` 发现 | ⚠️ 待运行时验证是否被读取 |

`hostVersion` 全库零命中的验证方式：
`node .cycles/tmp-asar.mjs <asar> grep '[.]js$' 'hostVersion' 10` → `files with hits: 0`
（同法 `manifestVersion` 亦 0 命中，与 2.2 的"不强制"表述自洽）。

## 3. 版本矩阵与偏斜

| 包 | DSH 运行时（asar） | 本项目 node_modules | 本项目声明 | 判定 |
|---|---|---|---|---|
| `@deepseek-ai/cordis` | `4.0.4` | `4.0.1` | peer `^4.0.1` | ✅ 可满足（4.0.4 在 ^4.0.1 内） |
| `@deepseek-ai/dsh-client-connection` | `0.2.0-rc.2` | **`0.1.7-rc.2`** | 仅 peer，无 devDep | ⚠️ **偏斜** |
| `@deepseek-ai/dsh-llm` | `0.2.0-rc.2` | `0.2.0-rc.2` | devDep `0.2.0-rc.2` | ✅ |
| `@deepseek-ai/dsh-session` | `0.2.0-rc.2` | `0.2.0-rc.2` | devDep `0.2.0-rc.2` | ✅ |
| `@deepseek-ai/dsh-tools` | `0.2.0-rc.2` | `0.2.0-rc.2` | devDep `0.2.0-rc.2` | ✅ |

`dsh-client-connection` 偏斜根因：`package.json` 的 `devDependencies` **未声明**该包，
`0.1.7-rc.2` 由传递依赖提升而来。`src/**` 中**没有任何文件 import 它**
（grep `dsh-client-connection` 于 `src/` 仅命中 `package.json` 的 inject 列表），
故当前**无编译期实际损害**，但清单与锁文件不一致，属应修的技术债。

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
