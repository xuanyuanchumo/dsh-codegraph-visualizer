# M0-② spike · 宿主 LLM 服务面：双向证据与 ANIC 接入形态

> 文档族：`docs/anic/`（导航见 [README.md](../README.md)）· 类型：spike 报告 · 2026-10-13
> 前置：[07-DSH开发规范与破坏性变更适配](../07-DSH开发规范与破坏性变更适配.md) 判定"宿主 LLM 服务面为幻影"（本项目 `src/` 中唯一接触是 `import { ToolCallId } from '@deepseek-ai/dsh-llm'`，无任何调用点）——本 spike 推翻该判定。
> 消费方：[09-结构优化与逻辑重构设计](../09-结构优化与逻辑重构设计.md) §6.1（Tier-2 模型评审）、[03](../03-架构设计草案.md)（端口层）、[04](../04-开发计划与里程碑.md)（M4 条件项）。

---

## 0. 结论先行

**判定：GO。宿主 LLM 服务真实存在、在当前安装中实际挂载、且有可复制的官方消费范式。**

这不是"文档里提到过"。按 [CLAUDE.md](../../../CLAUDE.md) 要求的**双向证据**取证——静态 `provide` 声明 + 真实 `ctx.get`/调用点，两者都拿到了：

| 方向 | 证据 | 位置 |
|---|---|---|
| **提供侧（静态）** | `constructor(ctx) { super(ctx, "llm") }` | `@deepseek-ai/dsh-llm/lib/index.js:1800-1802`（另 `lib/types/index.js:234`、应用主包 `lib/main.js:5255`） |
| **提供侧（装配）** | `- id: llm` / `name: '@deepseek-ai/dsh-llm'` 是 base bundle 的一行；provider 适配器同 bundle 挂载 | asar `@deepseek-ai/dsh-base/cordis.patch.yml:34-35`（适配器 `:525-529`、retry `:91-92`、pi-ai `:127-128`） |
| **消费侧（真实调用）** | `for await (const chunk of ctx.llm.stream(options))` | `@deepseek-ai/dsh-session-title-llm/lib/index.js:226` |
| | `for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);` | `@deepseek-ai/dsh-compaction-basic/lib/index.js:323` |
| | `return readDecision(ctx.llm.stream(options));` | `@deepseek-ai/dsh-experimental-auto-review/lib/index.js:415` |
| **消费侧（声明）** | `const inject = ["approval","llm","permissionPresets","sessions","tools"]` | `@deepseek-ai/dsh-experimental-auto-review/lib/index.js:45-51` |

全包扫描（`app.asar`，12967 条目 / 扫 8507 个代码文件 / 88.9 MB）：`ctx.llm` 命中 **50** 处、其中调用点/注入/服务键级 **11** 处，分布在 12 个官方包；第三方生态中大量插件把 `@deepseek-ai/dsh-llm` 写进 peerDependencies（`@nagi-ovo/dsh-visualize` `^0.1.0-rc.6`、`dsh-vault` `>=0.1.0-rc.6`、`dsh-draw`、`@kanadege/dsh-heartbeat`、`dsh-loop-continue` `^0.1.1-rc.2` 等）。

**三条对设计的直接影响**：

1. **09 §6.1 的 Tier-2 有真实落点**，且宿主**不提供** JSON 结构化输出的解码保证——官方范式是"提示词强制 JSON + 本地严格校验 + 失败即拒绝"（§3.1）。因此 `evidenceIds` 必须由 Tier-1 生成并注入提示词、由本地校验器比对，**不能把置信度当作可信输入**。
2. **`purpose` 是闭合枚举** `'compaction' | 'session-title'`（`types.d.ts:530`，且 `lib/index.js` 中 0 处引用），ANIC **不能**用 `purpose: 'anic-review'` 做归因——LLM 调用的归因必须落在 ANIC 自己的账本里。
3. **不要写进 `inject` 硬数组**：本项目 `inject: ['tools','webServer','sessions']` 是"缺它整个插件不激活"的强约束，而 ANIC 的评审必须在无模型时降级运行。正确形态是**可选能力**（`ctx.get('llm', false)` 探测 + `ctx.inject(['llm'], cb)` 增量接入），与 CLAUDE.md 既有纪律一致。

---

## 1. 取证方法（可复现）

```bash
# ① 本机包就在（0.2.0-rc.2，与 peer 范围一致）
node -e "console.log(require('./node_modules/@deepseek-ai/dsh-llm/package.json').version)"
# ② 静态提供侧
grep -n 'super(ctx, "llm")' node_modules/@deepseek-ai/dsh-llm/lib/index.js
# ③ asar 全包扫描（本 spike 自建，零依赖，只读 asar 头 pickle + 按需读文本）
node .anic-skill-evo/spike/asar-scan-llm.mjs "D:\DSH\DeepSeek Harness\resources\app.asar" .anic-skill-evo/spike/asar-llm-scan.json
# ④ 抽取真实消费包（22 文件 → .anic-skill-evo/spike/dsh-asar/）
node .anic-skill-evo/spike/asar-extract.mjs "D:\DSH\DeepSeek Harness\resources\app.asar" .anic-skill-evo/spike/dsh-asar \
  dsh/node_modules/@deepseek-ai/dsh-experimental-auto-review/ \
  dsh/node_modules/@deepseek-ai/dsh-session-title-llm/ \
  dsh/node_modules/@deepseek-ai/dsh-compaction-basic/
# ⑤ 装配侧：活动 profile 的 bundle 列表 → base bundle 的 llm 行
cat "$USERPROFILE/.dsh/profiles/web/package.json"          # dsh.profile.bundles 含 @deepseek-ai/dsh-base
grep -n 'llm' .anic-skill-evo/spike/dsh-asar/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml
```

扫描器与抽取器是本 spike 的产物（`.anic-skill-evo/spike/asar-scan-llm.mjs`、`asar-extract.mjs`），不写入技能、不改动 asar。

---

## 2. 服务契约（可直接编码的那一版）

### 2.1 服务键与类型

| 项 | 值 | 证据 |
|---|---|---|
| 服务键 | `llm`（`ctx.llm`） | `lib/index.js:1801`；类型侧 `declare module '@deepseek-ai/cordis' { interface Context { llm: LlmRuntime } }`（`lib/types/index.d.ts:28-31`） |
| 实现类 | `abstract LlmRuntime extends TypertRemoteService`（默认导出同名） | `lib/types/index.d.ts:236` |
| 注入声明 | `inject: ['llm', …]`（官方 auto-review 的写法） | `dsh-experimental-auto-review/lib/index.js:45-51` |
| peer 声明 | `"@deepseek-ai/dsh-llm": "0.2.0-rc.2"` | 三个消费包的 package.json 一致 |

### 2.2 公共方法面（`LlmRuntime`）

| 方法 | 签名 | 用途 | 行 |
|---|---|---|---|
| `stream` | `(options: GenerateOptions) => AsyncIterable<StreamChunk>` | 唯一调用入口 | `:412` |
| `listProviders` | `() => LlmProviderInfo[]` | **同步、廉价**，适合能力探测 | `:272` |
| `listModels` | `(provider) => Promise<LlmModelInfo[]>` | 列模型（GUI 需要在册） | `:350` |
| `resolveModelInfo` | `(provider, model, signal?) => Promise<LlmResolvedModelInfo>` | 上下文窗口/输出默认/推理档位/输入模态 | `:360` |
| `listConfigurableProviders` | `() => LlmConfigurableProvider[]` | 可配置 provider | `:286` |
| `discoverModels` | `(settingsNs, request, signal?) => Promise<LlmDiscoveredModel[]>` | 探测端点模型 | `:308` |

另有 **waterfall 事件 `llm/stream`**（`this.ctx.waterfall(this, 'llm/stream', options, () => adapterStream(...))`，`lib/index.js:2371`；类型 `lib/types/index.d.ts:45`）——可被拦截或短路，属于宿主预留的横切面；ANIC **不应**注册它（会改变别人的模型调用语义）。

### 2.3 请求形状 `GenerateOptions`（`lib/types/types.d.ts:489-530`）

| 字段 | 必填 | 说明 |
|---|---|---|
| `provider` | ✅ | 路由名，如 `deepseek-official` |
| `model` | ✅ | 模型 id |
| `messages` | ✅ | `RequestMessage[]`；`content` 是**块数组**（`[{type:'text',text}]`），不是字符串 |
| `system` | — | 一次性调用者的系统提示 |
| `tools` / `temperature` / `maxTokens` / `stop` / `signal` / `reasoningEffort` | — | `signal: AbortSignal` 是取消与超时的载体 |
| `sessionId` | — | `Branded<'SessionId'>` |
| `purpose` | — | **闭合枚举 `'compaction' \| 'session-title'`**，`lib/index.js` 零引用 |

### 2.4 流与装配

流是**token 级**的，且**总是以一个终止 `finish` 块结束**（`README.md:47`）。官方统一用 `BlockAssembler` 收块：

```js
const assembler = new BlockAssembler();
for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);
const blocks = assembler.blocks();   // 终块 reason.kind ∈ stop | error | aborted
```

`finish.reason.kind === 'error' | 'aborted'` 时 `reason.failure` 带 `{code, message}`——**必须显式处理**，否则错误会被当成"模型没有输出"。

### 2.5 错误码（`lib/types/error.d.ts` + 运行时）

| 码 | 常量 | 对 ANIC 的含义 |
|---|---|---|
| `NO_ADAPTER` | 运行时 `lib/index.js:2238` | 无适配器 → **降级启发式**（不是评审失败） |
| `INVALID_CREDENTIAL` | `error.d.ts:40` | 凭据无效 → 降级 + 运维可见 |
| `ACCOUNT_QUOTA` / `QUOTA` | `:22` / `:20` | 配额/余额 → 降级 + 报告（不得当作"评审通过"） |
| `CONTEXT_WINDOW_EXCEEDED` | `:18` | 证据过大 → 缩证据重试一次，再降级 |
| `EMPTY_RESPONSE` | `:32` | **评审失败**（`doubt`），绝不 `pass` |
| `IMAGE_OFFLOAD_REQUIRED` | `:82` | 与 ANIC 无关（图片场景） |

---

## 3. 三个官方消费范式（ANIC 三种需求各有一个样板）

### 3.1 严格决策协议 —— 对应 ANIC 的 Tier-2 评审（fail-closed）

`@deepseek-ai/dsh-experimental-auto-review`（"Per-tool LLM authorization review"，官方实验包）用 LLM 替代人类审批，是**与 ANIC 最同构的形态**：

- **提示词即协议**（`lib/index.js:20-41` `REVIEW_POLICY`）：要求"只返回一个 JSON 对象"，并**逐个列出唯一合法形状**：
  ```
  {"risk":"low","decision":"allow"} / {"risk":"medium","decision":"allow"}
  {"risk":"medium","decision":"deny"} / {…,"reason":"…"} / {"risk":"high","decision":"deny"}
  不许 low+deny、不许 high+allow、不许 allow 带 reason
  ```
- **本地严格校验**（`:353-375` `parseDecision`）：解析后再查 (a) 顶层是对象非数组；(b) `topLevelMemberCount(text) !== keys.length` 即"重复成员"→ 拒绝（`:334-351` 去字符串后数字面 `:` 数成员）；(c) 只接受枚举组合。任一条不满足 → throw。
- **块结构校验**（`:377-397` `readDecision`）：终止后再来数据 → throw；`reason.kind` 非 `stop` → throw；最终块必须是**恰好一个 text**、之前只允许 `reasoning`。
- **失败即拒绝**（`:448-454` `failed()`）：任何异常都变成 `deny`（"其主体未执行"）——**fail-closed**。
- 请求参数（`:401-414`）：`deepFreeze({provider, model, system, messages:[{role:'user',content:[{type:'text',text}]}], temperature: 0, signal})`；`provider/model` 取自 `session.requestHeader().config`（`:219`，取不到就 throw → 拒绝）。
- 装配声明（`package.json`）：`dsh.bundle.patch` + peer `dsh-llm`；**无 `dsh.client`**（纯宿主面插件）。

**给 ANIC 的直接结论**：Tier-2 要的形态就是这一套——闭合 JSON 协议 + 本地校验 + 失败保守 + `temperature: 0`。09 §6.1 的返回结构 `{verdict, confidence, evidenceIds, counterexamples}` 必须再加两条本地规则：**`evidenceIds` 中任何 id 不在 Tier-1 注入集合内 ⇒ `doubt`**；**Tier-2 返回非法结构 ⇒ `doubt`（不是 fail、更不是 pass）**。

### 3.2 超时 + 留痕 + 路由解析 —— 对应 ANIC 的一次性辅助调用

`@deepseek-ai/dsh-session-title-llm`（250 行）展示了"非关键路径 LLM 调用"的完整纪律：

- **超时**：`deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE)`（`:205`，来自 `@deepseek-ai/dsh-timeout`），且 `timeoutMs` 在 schema 里 `.required()` + `.max(MAX_TIMER_DELAY_MS)`（`:78`）——**没有库默认值**（`:72` 注释 "Shared Loader field schemas with no library defaults"）。
- **调用前留痕**：`request.session.append("session/title-llm-request", {titleProvider, messageSeqs, route, system, messages, maxTokens})`（`:216-223`）——**把确切请求先落盘再调用**；README 明说"记录自己确切请求的调用者必须使用 durable messages"（`README.md:61`）。
- **路由解析**（`:139-146` `resolveRoute`）：配置里 provider 与 model **同时**给出才用配置，否则回落到请求自带 route，两者都没有 → throw。**成对或全无**。
- **输入上限**：`maxInputBytes` 超限直接 throw（`:195`）——对应 08 的证据外置预算。
- **输出校验**：`finish` 错误码提取（`:231-232`）、出现 tool-call 块 → throw（`:234`）、标题为空 → throw（`:236`）。

**给 ANIC 的直接结论**：Tier-2 调用必须 (a) 有超时（ANIC 侧用 `AbortSignal` + 自己的 deadline，不依赖宿主默认）；(b) **调用前把 `{provider, model, promptDigest, evidenceIds}` 写进账本**，返回后再写 `{verdict, confidence, rawDigest}`——这正是 09 原则 7「效果即记录 Post-Verify」的宿主原生样板；(c) provider/model **成对**配置，缺一即整体回落到会话路由。

### 3.3 装配式摘要 —— 对应 ANIC 的"证据压缩"

`@deepseek-ai/dsh-compaction-basic`（`lib/index.js:323`）在同一模式上多给一条：**复用自己的 system 前缀做缓存复用**（`:282`、`:891` 注释"cache-reusing"），即长证据的稳定前缀能吃到 KV cache。

**给 ANIC 的直接结论**：评审请求应把**稳定规则文本放 `system`**、**可变证据放 user 消息**，这样同一 cycle 内多次评审（各维度一次）能复用前缀；这也与 08 的"证据外置 + 摘要"互补——送进模型的是摘要与 id，不是全量文本。

---

## 4. 与本项目的接口形态（建议）

### 4.1 清单：已经有的、要加的、绝不能加的

| 项 | 现状 | 动作 |
|---|---|---|
| peer 声明 `@deepseek-ai/dsh-llm` | **实测为无**（cycle-92 核对：`dsh-anic/package.json` 不含 peerDependencies 字段）⇒ 此前的「已有」记载不成立，本行是规划残留 | 不动（无声明即无承诺，兼容门必过） |
| 宿主服务注入 | `inject: ['tools','webServer','sessions']`（`src/index.ts:30`） | **不动**——加 `'llm'` 会让"无适配器的宿主"整个插件不激活 |
| 评审子系统接入 | 无 | `ctx.get('llm', false)` 判存在；`ctx.inject(['llm'], cb)` 做**增量**接入（CLAUDE.md：异步 inject 只用于**附加**、非互斥的贡献面） |
| 能力探测 | `src/shared/dshGeneration.ts` 只开不关 | 复用之；`llm` 探测结果只用于**开关评审功能**，不参与图能力判定 |
| 归因 | 无 | **不能用 `purpose`**；写 ANIC 账本事件（`provider`/`model`/`promptDigest`/`evidenceIds`） |
| 降级 | 无 | 按 §2.5 错误码分派：不可用类 → 启发式；产出异常类 → `doubt` |

### 4.2 为什么必须可选而非必需（结构性理由）

ANIC 的评审是**增益**，图能力是**主体**。硬依赖 `llm` 会在以下任一情形把整个插件变成死插件：宿主未挂任何 provider（`NO_ADAPTER`）、profile 只在配置后激活 provider、企业环境禁用外呼。技能侧同构的教训已经写进 09 原则 1（单一事实来源）与 S-1（`gate-check` 因一个文件名不一致而整套门禁不可运行）——**"缺一个外部件就整体不可运行"正是 S-1 的放大版**。

### 4.3 降级矩阵（写进 03 端口层与 05 不变量）

| 情形 | Tier-1 | Tier-2 | 账本 | 门禁 |
|---|---|---|---|---|
| `llm` 服务不存在 | 正常 | 不执行 | `source:'heuristic'`，`reason:'llm-absent'` | 只能达 L2/L3；L4 关闭 |
| `NO_ADAPTER` / `INVALID_CREDENTIAL` / `QUOTA*` | 正常 | 降级 | `reason:'llm-unavailable:<code>'` | 同上 |
| `CONTEXT_WINDOW_EXCEEDED` | 正常 | 缩证据重试 1 次 → 仍失败则降级 | 记录两次尝试 | 同上 |
| `EMPTY_RESPONSE` / 结构非法 / 终止异常 | 正常 | **`doubt`** | 记录原始码与 rawDigest | **门禁不通过**（不得用"模型没说不行"当通过） |
| 正常返回但 `evidenceIds` 越界 | 正常 | **`doubt`** | 记录越界 id | 门禁不通过 |

**贯穿规则**：`source: 'llm'` 的裁决只有在**证据 id 与 Tier-1 注入集合一致**时才具效力；`confidence` 单独存在时视为无效（09 §6.1 与 INV-14 已如此规定，本 spike 给出其宿主依据）。

---

## 5. 对文档族的修订

| 文档 | 修订 |
|---|---|
| 01 可行性研究 | 07 的"LLM 服务面为幻影"结论**推翻**；GAP-4 由"宿主无模型面"改为"宿主有模型面，形态需按 §3.1 收敛"；GO 裁决不变 |
| 02 需求分析 | F5（语义评审）由"条件项、需宿主能力"升级为**"条件项、宿主能力已证实（M0-②）"**，并补 F39 归因与降级要求（`purpose` 不可扩展、错误码分派、`doubt` 语义） |
| 03 架构设计 | `llm/` 端口补真实契约：`port.stream(options: GenerateOptions)`、`listProviders` 探测、`AbortSignal` 超时、`BlockAssembler` 装配；明确**不进 `inject` 硬数组** |
| 04 里程碑 | M0-② 标完成（交付本篇）；M4 的前置由"待验证宿主面"改为"已证实，实现级风险仅剩提示词与降级" |
| 05 数据结构与算法 | 新增 **INV-23**：`source:'llm'` 的裁决必须携带非空且**在注入集合内**的 `evidenceIds`，否则记为 `doubt`；**INV-24**：LLM 不可用不得使整体能力不可用（评审降级而插件存活） |
| 07 开发规范 | §能力清单修订：`llm` 是 `provide`+真实调用点双向成立的**可用**服务（附本篇 §0 证据），并记录"`purpose` 闭合、不可扩展"这条破坏性变更风险 |
| 09 结构优化 | §6.1 Tier-2 补"宿主不保证结构化输出 ⇒ 闭合协议 + 本地严格校验 + 失败保守"与 `doubt` 判据；§6.8 报告投影补"评审请求/响应摘要入账本" |
| 10 技能进化记录 | §9.11 记录 M0-②（技能侧无代码改动，仅诊断） |
| README | 文档地图 spike 行 + 版本 v1.10 |

---

## 6. 未验证项与风险

| # | 项 | 现状 | 影响 |
|---|---|---|---|
| U-1 | `llm` 服务键在 gen1（0.1.7-rc.2 线）是否同名 | 第三方 peer 范围回溯到 `^0.1.0-rc.6` 属**旁证**，未在真实 gen1 宿主上跑过 | 低：ANIC 的探测是"只开不关 + 调用点决策"，键不存在即降级 |
| U-2 | profile 是否**总是**挂 provider | 本机 `dsh-base/cordis.patch.yml:34-35` 挂 llm，`:525-529` 挂 deepseek 适配器；企业/离线 profile 可能只有 llm 无适配器 | 已由降级矩阵覆盖 |
| U-3 | 评审调用的成本与延迟上界 | 未测（无实现） | 中：需要 per-cycle 调用预算（并入 08 的预算族） |
| U-4 | 提示词注入面（工件内容进提示词） | 官方 auto-review 同样把会话内容送进模型，以"闭合输出协议 + 本地校验"为防线 | 中：ANIC 必须把 Tier-2 输出**只当建议**，裁决权仍在 Tier-1 + 人类门 |
| U-5 | `temperature: 0` 是否各适配器都尊重 | 官方 auto-review 采用，未逐适配器验证 | 低：不改变 fail-closed 设计 |
| R-26 | 把"模型没说话"当"通过" | 新风险 | 高：由 INV-23/INV-24 与 §4.3 表封堵 |
| R-27 | `purpose` 被误扩展 | 新风险 | 中：TS 会在编译期拒绝，但需在 07 记为破坏性变更项 |

---

## 7. 产物与复现

| 产物 | 路径 | 说明 |
|---|---|---|
| asar 扫描器 | `.anic-skill-evo/spike/asar-scan-llm.mjs` | 零依赖解析 asar 头 pickle，按模式分级（调用点/成员访问/注入/服务键） |
| 扫描结果 | `.anic-skill-evo/spike/asar-llm-scan.json` | 12967 条目 / 8507 文件 / 88.9 MB / 50 命中 / 11 调用点级 |
| asar 抽取器 | `.anic-skill-evo/spike/asar-extract.mjs` | 只读抽取指定包（22 文件） |
| 抽取结果 | `.anic-skill-evo/spike/dsh-asar/node_modules/@deepseek-ai/{dsh-experimental-auto-review,dsh-session-title-llm,dsh-compaction-basic,dsh-base}/` | 真实消费包与 base bundle patch |
| 本报告 | `docs/anic/spike/host-llm-service.md` | 交付物 |

**复现判据**：`asar-scan-llm.mjs` 输出中 `callSites >= 3` 且包含 `dsh-experimental-auto-review`（若该计数为 0，说明宿主换了实现，本文结论作废）。
