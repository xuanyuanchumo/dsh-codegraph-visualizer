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

---

## 6. cycle-111 官方规范复核（context7 + 活宿主 asar）

> 与 §2 的区别只在**证据等级**：§2 是 cycle-92 的 context7 检索转述，本节第 1 条是
> **活宿主 `app.asar` 里直接提取的字节原文**（不是转述、不是 README），第 2 条是
> **活宿主可执行文件的实际输出**。旁证（旁证也算证据，但等级低于前两者）是 context7
> 检索到的 `README` / `upgrade-guide`。
>
> 每条按 §2 的三段式：**来源 → 原文要点 → 落点**。凡「本仓核查」写 0 命中的，是
> **否定证据**：它证明的不是「我们做对了」，而是「这条变更碰不到我们」——按 §3 的
> 否定结论口径同样收录，因为「核查过、无影响」与「没核查」在报告里必须可区分。

### 6.1 `engines.dsh` 单独决定（活宿主 asar 字节原文，§2.2 的升格证据）

- 来源：活宿主 `D:/DSH/DeepSeek Harness/resources/app.asar` 内 `@deepseek-ai/dsh-app-boot`
  的 `plugin-compatibility` JSDoc 注释，**字节偏移 `21865976`**。
- 复现命令（逐字，可任何人重跑）：

  ```bash
  node -e "const fs=require('fs');const s=fs.readFileSync('D:/DSH/DeepSeek Harness/resources/app.asar').toString('latin1');const i=s.indexOf('An own \`engines.');console.log(i);console.log(s.slice(i,i+400))"
  ```

  实跑输出（cycle-111）：

  ```
  21865976
  An own `engines.dsh` range decides alone and
  * peerDependencies are ignored; otherwise every @deepseek-ai/dsh or @deepseek-ai/dsh-* peer must match.
  * Prereleases participate in ranges. For peers only, workspace:^, workspace:~, and workspace:* refer to
  * the current runtime; other empty or invalid ranges, including any workspace: `engines.dsh`, are unmet.
  ```

- 原文要点（逐条可核对）：
  1. **有 `engines.dsh` ⇒ 它单独决定**，`peerDependencies` **被忽略**；
  2. 无 `engines.dsh` ⇒ 才逐个检查 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer；
  3. **预发布参与范围匹配**（`Prereleases participate in ranges`）——这是下界必须写
     `<X.Y.Z-0` 语义、且 `includePrerelease` 会放行下一代预发布的来源；
  4. peer 的 `workspace:^|~|*` 指**当前运行时**；其它空/非法范围（含 `workspace:`
     形式的 `engines.dsh`）一律判 **unmet**。
- 落点：与 §2.2 的结论**一致且更强**——§2.2 当时引的是同一份注释但经由 context7 转述；
  本节是活跃进程所在的那一份字节。因此 [09](./09-破坏性变更与兼容策略.md) §1.1 的
  「`engines.dsh` 有读取者且单独决定」不是推断。本仓 `package.json` 的
  `engines.dsh = '>=0.2.0-rc.2 <0.4.0-0'`（未改动）。
- **§2.5 的标题已过期**：`### 2.5 兼容门只在 `peerDependencies`（行 111）` 的**标题**
  与它自己的正文（行 129-131 已经写明 `engines.dsh` 单独决定）矛盾。按 README §维护
  规则 4「不写"应该"，只写"是"或"不是"」，此处登记而不静默改写历史记录：**以本节
  6.1 为准，§2.5 的标题应读作「兼容门的**判定实现**在 `plugin-compatibility.ts`，
  真正的门是 `engines.dsh`」**。改标题会破坏 cycle-92 的历史引用，故保留原文并在此标注。

### 6.2 声明范围 vs 活宿主版本（两列事实）

| 项 | 值 | 采集命令 |
|---|---|---|
| **声明**的宿主范围 | `>=0.2.0-rc.2 <0.4.0-0` | `node -e "console.log(require('./package.json').engines.dsh)"` |
| **活宿主**实际版本 | `0.2.1-rc.3` | `"D:/DSH/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd" --version` |
| 声明是否覆盖活宿主 | 是（`0.2.1-rc.3` 落在区间内） | 见 [09](./09-破坏性变更与兼容策略.md) §2 的三处一致性守卫 |

- 实跑输出：`0.2.1-rc.3`
- 落点：这两列**必须分列**（README §版本 同样的要求：下限永远写 `0.2.0-rc.2`，
  不得写成已验证版本）。cycle-111 未抬下限（用户 objective #3 的硬约束）。

### 6.3 `incompatible-version` 错误码与版本豁免流程

- 来源：context7 `/deepseek-ai/deepseek-harness` → `packages/boot/plugin-manager/README.md`。
- 原文要点：
  - 拒绝安装时返回的结构含 `{ name, version, runtimeVersion, requirements }`，
    `requirements` **按 `engines.dsh` 或 peer 包名分键**——这与 6.1 的两条分支一一对应；
  - 豁免：`dsh plugin --profile <p> allow-version <package@version> --dsh-version <runtime> --accept-risk`；
  - 撤销：`revoke-version`。
- 落点：[09](./09-破坏性变更与兼容策略.md) §3「破坏性变更的判定流程」里
  **「用户怎么放行」这一格**引用本节（已在该文件 §3 补入）。注意 `--accept-risk`
  是**显式承担风险**的开关，不是默认放行——文档不得把豁免写成「配置一下就好」。

### 6.4 `dsh plugin` 的 `--profile` 只能出现在被转发的 pnpm 参数之前

- 来源：context7 upgrade-guide `v0.2.1-alpha.1/plugin-option-placement/guide.zh.md`。
- 原文要点：`dsh plugin` 只在**遇到的第一个不可识别 token 之前**读取 `--profile`；
  因此把 `--profile` 写在动词**之后**（如 `… add <pkg>` 再接 `--profile web`）会失败并报
  `required option '--profile <name>' not specified`。

  > ⚠️ **这里刻意不写出那条命令的完整字面形态**。本仓已经三次踩到
  > 「扫描器匹配到自己的样本」（`e2eSelectorContract.test.ts`、`a11yFormSemantics.test.ts`、
  > `visualBaselineContract.test.ts`），而本节的审查命令本身就是一条扫描器——
  > 把反例写成连续可匹配的字面，会让「期望 0 命中」永久变成 2 命中。
- 本仓核查（**逐条核对本任务点名的 8 处引用**）：

  | 文件:行 | 写法 | 判定 |
  |---|---|---|
  | `README.md:38` | `dsh plugin --profile web add github:…` | ✅ `--profile` 在前 |
  | `README.md:39` | `dsh plugin --profile web add xuanyuanchumo/…` | ✅ |
  | `README.md:42` | `dsh plugin --profile web remove dsh-codegraph-visualizer` | ✅ |
  | `README.md:61` | `dsh plugin --profile web add /path/to/…` | ✅ |
  | `docs/需求分析.md:572` | `dsh plugin --profile web add dsh-codegraph-visualizer` | ✅ |
  | `docs/需求分析.md:575` | `dsh plugin --profile web add github:<author>/…` | ✅ |
  | `docs/需求分析.md:2335` | `dsh plugin --profile web add` | ✅ |
  | `docs/需求分析.md:2432` | `dsh plugin --profile web add` | ✅ |
  | `docs/测试体系.md:2613` | `dsh plugin --profile web add D:\Projects\…` | ✅ |
  | `docs/用户旅程.md:37` | `dsh plugin --profile web add <本地目录路径>` | ✅ |
  | `scripts/install-dsh.ps1:28,35,41,110` | `dsh plugin --profile web <verb> …` | ✅ |
  | `docs/用户旅程.md:29`（J0 反向列） | 无 `dsh plugin` 命令 | — 不适用 |

  反向扫描命令（用来证明**没有**写错的形态）：

  ```bash
  # 只扫「会被人照着敲」的地方：README / docs 的使用说明 / 脚本 / CI。
  # 排除 docs/agents/05（本节）——它必须引用这条命令本身，否则无法复核。
  grep -rn "plugin add .*--profile\|plugin update .*--profile\|plugin list .*--profile" \
    --include="*.md" --include="*.ps1" --include="*.mjs" . \
    | grep -v node_modules \
    | grep -v "docs/agents/05-DSH官方规范检索证据.md"
  # 期望：0 命中
  ```

  实跑输出：

  ```
  wrong-form-count=0
  correct-form-count=113
  ```

  第二条 `correct-form-count=113` 是**反空转断言**：如果扫描器写坏了（例如正则永不匹配），
  第一条的 0 命中就毫无意义。113 > 0 证明「正确形态确实存在且被扫到」。
- **判定：无缺陷**，不登记 P2。本仓历史写法**全部正确**（`--profile` 一律在动词前）。
  这条登记的意义是把它变成**可复核的否证**：下次升级 `dsh` 时若 `--profile` 语义再变，
  上面那条 grep 就是现成的回归探针。

### 6.5 工具呈现模式 `both` 已被移除（本仓无影响）

- 来源：context7 upgrade-guide `v0.2.1-alpha.1/tool-presentation-mode`。
- 原文要点：`@deepseek-ai/dsh-tools` 与 `dsh-agent-tool-presentation` 的 `mode` 只接受
  `native` / `ptc`；`both` 被拒绝；环境变量 `DSH_TOOLS_MODE=both` 同样失效。
- 本仓核查（**否定证据**）：

  ```bash
  grep -rn "presentAs\|DSH_TOOLS_MODE\|mode: 'both'\|mode:'both'" src/ cordis.patch.yml
  # 期望：0 命中
  ```

  实跑输出：0 命中。
- 落点：本插件 11 个工具全部走 `defineTool` 的 `output.schema` + `presentCall` /
  `presentResult`（`src/tools.ts`），**不设置任何 `mode`**，因此不受该移除影响。
  登记为「核查过、无影响」，而不是跳过不管（§3 的否定结论口径）。

### 6.6 `webRuntime` 被 `webStartup` 取代，通配监听地址被拒绝（本仓无影响）

- 来源：context7 upgrade-guide `v0.2.1-alpha.1/web-listener-trust-config/guide.zh.md`。
- 原文要点：`web-runtime` 行不再声明 `trustedHosts`；`host: 0.0.0.0` 与 `host: ::`
  在**加载时**即被拒绝（不是运行期报错）。
- 本仓核查（**否定证据**）：

  ```bash
  grep -rn "webRuntime\|webStartup\|connection.admit" src/ cordis.patch.yml
  # 期望：0 命中
  ```

  实跑输出：0 命中。
- 落点：本插件通过 `ctx.webServer.register({kind:'exact', path, handler})` 挂路由
  （`src/host/routes.ts:41` 起），**不声明监听地址、不读 `webRuntime`**。
  监听地址由宿主的 profile 决定，改动它属于宿主侧配置，不属本插件写域。

### 6.7 slot 契约：`apply order is unconstrained`（本仓的 `inject` 用法是官方推荐形态）

- 来源：context7 `docs/subsystems/slots.md` + `packages/client/AGENTS.md`。
- 原文要点（逐字）：

  > "Registering into another package's slot: apply order is unconstrained... Use
  > `ctx.slots.inject(name, () => ctx.slots.register(...))`; it waits on the actual
  > declaration, removes the contribution when that declaration collapses, reruns after
  > redeclaration, and leaves with the caller's plugin fiber."

- 落点（**这是「我们不是权宜之计」的证据**）：
  - 本仓 `src/client/integrations/ConversationViewIntegration.ts:89` 用
    `ctx.slots.inject('conversation.view', () => { … })`，**不是**同步 `register` ——
    与原文的推荐形态一致；
  - 原文的「apply order is unconstrained」正面回答了 cycle-110 的席位预留设计
    （[07](./07-界面与功能域规划.md) §3）：因为 apply 顺序不受约束，**不能用
    「我注册得早」来保证通道优先级**，必须用 `inject` + 预留/超时/迟到撤回
    （`src/client/integrations/IntegrationState.ts`）；这不是绕路，而是官方唯一保证
    可用的形态。
  - `conversation.view` 的 owner props 类型是 `ConvViewOwnerProps`，字段为
    `inspectCall` / `viewRequest` / `openView` / `completeViewRequest`
    （本仓 `ConversationViewIntegration.ts:21` 的注释引用了类型名）。
    **诚实缺口**：本仓当前只读 `props.visible`（`ConversationViewIntegration.ts:98-109`），
    其余四个 owner props **零使用**。登记为「未使用的官方 owner props」，
    不声称已实现深链/请求态（那是 `viewRequest` / `completeViewRequest` 才有的能力）。

### 6.8 插件市场索引的硬要求（本仓已满足）

- 来源：context7 `kb/site/guide/plugin-market.md`（`scripts/plugin-market-index.mjs`
  的文件头注释已引用同一处）。
- 原文要点：
  1. `LocalizedText` **至少含 `en`**；
  2. `meta.title` / `meta.description` 来自 `locale/*.json`；
  3. **只有声明了 `dsh.bundle` 的包才会被市场收录**。
- 本仓核查（逐条对应）：

  ```bash
  node -e "const p=require('./package.json');console.log('engines.dsh=',p.engines.dsh);console.log('dsh=',JSON.stringify(p.dsh))"
  node -e "for(const l of ['en','zh']){const j=require('./locale/'+l+'.json');console.log(l,j.meta&&j.meta.title,!!(j.meta&&j.meta.description))}"
  ```

  实跑输出：

  ```
  engines.dsh= >=0.2.0-rc.2 <0.4.0-0
  dsh= {"manifestVersion":1,"bundle":{"patch":"./cordis.patch.yml"},"client":{...}}
  en meta.title= Code Graph Visualizer | meta.description= true
  zh meta.title= 代码图谱可视化 | meta.description= true
  ```

  ⇒ ① `dsh.bundle.patch` 存在 ⇒ 可被收录；② 两个 locale 都有 `meta.title` 与
  `meta.description` ⇒ 满足 `LocalizedText` 要求。
- 落点：索引产物与 `--check` 幂等性见 [测试体系 §2.27 通道 4](../测试体系.md)；
  本节只登记**官方硬要求 ⟷ 本仓字段**的对应关系。

### 6.9 本节与其它文档的分工

| 内容 | 唯一登记处 |
|---|---|
| 官方原文与来源 URL | **本文件 §2 / §6** |
| 承诺分层、`engines.dsh` 判定流程、豁免与撤销 | [09](./09-破坏性变更与兼容策略.md) §1–§3（引用本节 6.1 / 6.3） |
| 多代适配矩阵的实现现状 | [09](./09-破坏性变更与兼容策略.md) §4 |
| 阈值与命令 | [08](./08-质量属性与评审标准.md) |

> **无机器守卫**：本节 9 条均为人工复核记录，唯一可机械重跑的是 6.1 的 asar 偏移命令
> 与 6.5 / 6.6 的两条 grep。asar 偏移（`21865976`）随宿主升级必然漂移——**漂移时以
> 命令输出的 index 为准，不要以本文件写的数字为准**（这正是本项目「引用文件+函数+
> grep，不引用行号」纪律对二进制同样适用）。
