# 05 —— DSH 官方规范检索证据（context7 MCP）

> 本文件回答一个问题：**我们对 DSH 宿主契约的每一条断言，依据是什么？**
> 依据只接受两种：① 带来源 URL 的官方原文（context7 MCP 检索所得）；② 本机实装
> 代码的行级证据（`node_modules/@deepseek-ai/**`）。**不接受**"命名约定看起来是这样"、
> "README 提到过"、训练数据记忆。这条纪律的代价在本仓库已经被支付过两次：
> `remoteWebUI` 幻影键（零 `provide(` 命中，见 `src/client/compat/ClientCompatLayer.ts:9-17`）
> 与 `ctx.llm` 一度被当作幻影（双向证据补齐后才判定 GO）。

## 1. 检索元信息

| 项 | 值 |
|---|---|
| 检索工具 | `context7 MCP`（`resolve-library-id` → `query-docs`） |
| 库 ID | `/deepseek-ai/deepseek-harness`（Code Snippets 9739、Source Reputation High、Benchmark 80.36） |
| 检索轮次 | cycle-92 共 5 次 `query-docs`（主题见下表） |
| 未采用的候选 | `/cordiverse/cordis`（仅 2 snippets，无实用价值）；`/acryldev/cordis-meta-framework-spatiotemporal-composability`（3878 snippets，第三方镜像，内容与官方重叠且版本滞后） |

| # | 查询主题 | 结论落点 |
|---|---|---|
| 1 | 插件开发 / manifest / cordis 服务 / 客户端平台 / 破坏性变更 | §2.1、§2.2 |
| 2 | 服务提供者、`ctx.get` 可选依赖、`inject` 必需依赖、`ctx.effect` 生命周期 | §2.3 |
| 3 | `conversation.view` 顶层标签注册、客户端 bundle 加载、peer 兼容门 | §2.4、§2.5 |
| 4 | `development.zh.md` / `architecture.zh.md` / `AGENTS.md` 正文 | §3（**否定结论**） |
| 5 | 插件实现工作流（`plugin_manager`）与组合检查 | §2.6 |

## 2. 已取得的官方原文与落点

### 2.1 bundle manifest 与 patch overlay

- 来源：`docs/user/develop/basic/publish.md`
  （https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md）
- 原文要点：`hello-plugin/package.json` 用 `dsh.bundle.patch` 指向 `./cordis.patch.yml`；
  `files` 列 `[index.js, cordis.patch.yml]`；入口是 `export const name = 'hello-plugin'` +
  `export function apply() { … }`；patch 内容为 `- insert:` 下挂 `id: hello` / `name: dsh-hello-plugin`。
- 落点：本项目 `package.json` 的 `dsh.bundle.patch = './cordis.patch.yml'` 与 `files` 列表
  （`package.json:113-119`、`:132-145`）与该原文同形；`cordis.patch.yml` 是 bundle layer 而非
  `dsh.manifestVersion` 的替代品。

### 2.2 `DshPackageManifest`

- 来源：`packages/util/package-manifest/README.md`
  （https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/package-manifest/README.md）
- 原文示例：

  ```ts
  import type { DshClientManifest, DshPackageManifest } from '@deepseek-ai/dsh-package-manifest';
  const client: DshClientManifest = { platform: 'web' };
  const manifest: DshPackageManifest = {
    name, version,
    engines: { node: '>=24', dsh: '0.1.5-alpha.1' },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' }, client },
  };
  ```

- **原文明确**：*"The types are erased at compile time and do not perform runtime JSON validation
  or file generation."*
- 落点（**cycle-110 纠偏**）：本条**只对「类型不做运行时 JSON 校验」成立**，不能推出「`engines.dsh`
  没有读取者」。实测否证：宿主 `@deepseek-ai/dsh-app-boot` 的 `unmetRequirements()` **读 `engines.dsh`**
  且**单独决定**——有 `engines.dsh` 时 `peerDependencies` 被完全忽略（源码注释原文
  *"An own `engines.dsh` range decides alone and peerDependencies are ignored"*）；
  `dshmarket/lib/verify.js:217-235` 用同一条规则。`dsh-package-manifest` 的 README 仍写
  *"Current installers and loaders do not enforce `dsh.manifestVersion` or `engines.dsh`"*，
  **该 README 落后于随包发布的代码**。因此本插件真正的兼容门是 `engines.dsh`，`peerDependencies`
  只是历史声明；承诺矩阵与破坏性变更判定见
  [09-破坏性变更与兼容策略.md](./09-破坏性变更与兼容策略.md) §1–§3 与
  [`docs/research/dsh-round110-规范与破坏性变更.md`](../research/dsh-round110-规范与破坏性变更.md)。

### 2.3 cordis 服务注入：必需 vs 可选

- 必需依赖（来源：`docs/user/develop/framework/index.md`）：
  `export const inject = ['tools', 'llm']`；原文 *"Wait for required services to become ready
  before executing plugin logic. If a required service becomes unavailable, the plugin unloads
  automatically and reloads once the service returns."*
- 可选依赖（来源：`docs/cordis-tutorial/03-services.md`）：`const greeter = ctx.get('greeter')`；
  原文 *"undefined when no provider is loaded; the plugin still runs"*。
- 生命周期（来源：`docs/cordis-tutorial/02-lifecycle-and-effects.md`）：
  `ctx.effect(() => { const timer = setInterval(...); return () => clearInterval(timer) })`；
  `const fiber = ctx.plugin(heartbeat)` 可用 `fiber.dispose()` 卸载。
- 官方 system prompt 快照（来源：`snapshots/web/cordis-tool-round/system-prompt.expected.md`）
  明文：*"Declare hard dependencies in `inject` before accessing them as `ctx` properties,
  and use `ctx.get()` with an undefined check for optional services. **Never access an
  undeclared service directly as a property on `ctx`.**"*
- 落点：`src/index.ts:30` 只声明 `['tools','webServer','sessions']`（三个必需服务），
  `workspaceRegistry` 等 gen2-only 服务走 `src/host/prerequisites.ts` 的 `ctx.get()` 可选探测；
  `src/client/index.ts:44` 只声明 `['slots']`，`betterSidebar` / `commandUi` 走动态探测。
  这条纪律还有一个**运行时陷阱**：`ctx.get(name)` 默认 `strict = true`，含义是
  "提供者 fiber 当前活跃"而非"服务存在"（`cordis/lib/index.js:763-772`、`reflect.d.ts:16`），
  所以探测必须用 `ctx.get(key, false)`——否则同步 `apply()` 里的一次探测会永久杀死所有
  当时仍处于 loading 态的服务（cycle-83 的 5 个 slash command 全部未注册就是这么来的）。

### 2.4 客户端 bundle 与 `conversation.view` 顶层标签

- 客户端 bundle 注册机制（来源：`packages/client/tsdown.client.ts`）：tsdown 预设产出
  closure-factory 产物，entry chunk 调用 `window.__ModuleLoader__.load({ id, factory })`，
  动态 chunk 调用 `load({ id, chunk, factory })`。原文注释：*"resolves externals through the
  injected require (loader module table — cordis DI entities, no globals, no import map).
  CSS is compiled by lightningcss inside the bundle"*。
- 模块声明（来源：`packages/client/modules/README.md`）：*"A browser plugin package declares
  `dsh.client` in its package.json with `platform: 'web'`, exports a `./client` bundle, and
  lists any non-baseline module requests under `dsh.client.external`. The host half turns each
  declaration into a served bundle under `/plugins`"*。
- 槽位系统（来源：`docs/subsystems/slots.md`）：*"Slots are the Web Client's typed React
  composition system... A feature plugin contributes UI through `ctx.slots.register()` and
  **never imports another feature plugin's component**."*
- 落点：本插件 `package.json` 的 `dsh.client.platform = 'web'`、`exports["./client"]`、
  `dsh.client.inject` 三条官方边与该原文一致；`conversation.view` 顶层标签由
  `src/client/integrations/ConversationViewIntegration.ts` 通过 `ctx.slots.inject` 注册，
  真机验证见 §4。

### 2.5 兼容门只在 `peerDependencies`

- 来源：`packages/boot/app-boot/src/plugin-compatibility.ts`
  （https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/src/plugin-compatibility.ts）
- 原文签名：

  ```ts
  export function evaluatePluginCompatibility(
    manifest,
    exemptions = {},
    runtimeVersion = getDshRuntimeVersion(),
  ): PluginCompatibility | undefined
  ```

  实现只看 `peerDependencies` 中名字等于 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的项；
  `workspace:^|~|*` 解析为当前运行时版本；`semver.satisfies(runtimeVersion, requirement,
  { includePrerelease: true })`；返回 `{ name, version, runtimeVersion, peers, exempted }`
  或 `undefined`（全部满足）。
- 落点：这是"抬高宿主下限必须改 `peerDependencies`，只改 `engines.dsh` 等于什么都没做"的
  源码证据，也是 cycle-92 抬窗（`^0.1.7-rc.2` → `^0.2.0-rc.2`）的落点。见
  [01-插件开发规范.md](./01-插件开发规范.md) §2。

### 2.6 插件实现工作流（不要手改 profile）

- 来源：`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md`
- 原文要点：*"For implementation, use ordinary workspace files to author a bundle, then
  `plugin_manager` with `action: install_bundle` and the absolute package directory as
  `target` to install it in the current profile."* 以及 *"Do not write the profile's
  `package.json` or `cordis.patch.yml`, create packages under `$DSH_HOME`, or run pnpm in
  the profile directory"*。
- 来源：`packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md` —— 查看已挂载
  插件的 Config schema 用 `cordis_inspect_list` / `cordis_inspect_query`（不触发 Remote 方法）。
- 落点：本仓库的 J0 真机安装**刻意走 profile 的 `link:` 依赖 + `dsh.profile.bundles`**
  （`scripts/start-dsh-test.mjs`），因为被测对象是"本地开发的 link 包"而不是"从市场安装的包"；
  这与上面"不要手改 profile"并不冲突——那条规则约束的是**代理替用户安装**的场景，本项目的
  profile 是测试夹具。该差异在 [01-插件开发规范.md](./01-插件开发规范.md) §3 显式记录。

## 3. 否定结论：`development.zh.md` / `architecture.zh.md` / `AGENTS.md`

`docs/评估评审研究开发体系.md` §九 第 1 项原写作：

> `docs/development.zh.md`、`docs/architecture.zh.md`、`AGENTS.md` 正文 — 通过 `context7 MCP` 获取。 `[待执行]`

cycle-92 已执行该检索（`query-docs` 以这三个文件名为关键词，并附
`0.2.0 / 0.3.0 breaking change` 限定），**结论是否定的**：context7 索引中**不存在**
这三个文件的正文。检索返回的是相邻内容：插件实现工作流（§2.6）、组合检查 skill、
以及大量 `docs/persistence-changes/releases/dsh-vX.Y.Z.md` 会话格式迁移清单
（与插件 API 无关）。

**因此本条不作为"未完成项"继续挂着，而是改判为"已检索、无该资源"，并以本目录 01-04 四份
文档 + `docs/research/dsh-多代API规范差异与兼容矩阵.md` 作为等价交付。** 这是"响亮失败"而非
"假装有依据"：任何后续读者都能复现这个否定结论，而不会以为我们读过那三份文件。

## 4. 真机验证（契约不是纸面的）

上面每一条都只证明"官方这么说"。要证明"本插件真的这么跑"，需要真机证据：

- 启动：`node ./scripts/start-dsh-test.mjs start 120000` → DSH Web `http://127.0.0.1:3080`、
  Chrome DevTools `http://127.0.0.1:9222`（认证 URL 只能从 stdout 解析，见
  `docs/用户旅程.md` J0 §1）。
- 控制台证据：`[codegraph:client] conversation.view slot registration succeeded` 与
  `[codegraph:client] commandUi contributions registered`。
- 顶部标签栏证据：accessibility 快照中 `tab "对话"` / `tab "轨迹"` / `tab "代码图谱"`
  **同级并排**；点击后 `[data-cg-conversation-view]` 的 `data-cg-visible="true"`。
- 条件请求证据：`GET /api/v1/codegraph/bootstrap?workspace=…` 首次 200、随后两次 304。

## 5. 本文件的机器守卫

- `docs/agents` 的存在性与四份文档的交叉引用：无自动守卫（`fact-base-verify` 只扫
  `.cycles/cycles/*/项目评估报告.md` 里的反引号路径）。**无机器守卫**。
- `engines.dsh` / `peerDependencies` 与 `DSH_SUPPORTED_RANGE` 三者一致：
  `tests/unit/dshGeneration.test.ts`、`tests/unit/manifest.test.ts` 双向钉死。
- 引用行号真实性：本文件所有行号在 cycle-92 写就时逐条 `grep` 验证过；重构会使其漂移，
  漂移时以 `grep` 结果为准（这也是 README §"事实基座自检"给出命令的原因）。
