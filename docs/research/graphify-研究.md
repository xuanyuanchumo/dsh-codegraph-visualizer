# Graphify（Graphify-Labs/graphify）设计与实现研究

> 研究对象：<https://github.com/Graphify-Labs/graphify>
> 克隆方式：`git clone --depth 1`（成功），本地路径 `.cycles/tmp/graphify`
> **commit SHA：`0a8cd4e1e342235fe53e881fb5d591bf0460071f`**
> 抓取时间：2026-10-28（Asia/Shanghai）
> 版本：`0.9.97`（`pyproject.toml:8`）　许可证：Apache-2.0（`pyproject.toml:13`、`LICENSE:2`）
> 证据约定：本文件所有 `路径:行号` 均指 `.cycles/tmp/graphify/` 下的**仓库内相对路径**；本项目侧则指本仓库相对路径。凡未读到、未验证的内容统一汇总在 §14。

---

## 零、结论先行

| 问题 | 结论 | 证据 |
|---|---|---|
| 是不是空壳/营销仓库？ | **不是**。237,376 行 Python、1,118 个受版本控制的文件、7,055 个 `def test_` 函数、`worked/` 下有真实产出的 `graph.json` | `git ls-files`、`wc -l`、`grep -c`、`worked/httpx/graph.json` |
| 它的核心主张是什么？ | 用一个**确定性的代码图 + 自然语言检索**替代「grep/读文件」；不用 embedding、不用向量库 | `README.md:34-38`、`docs/how-it-works.md:26-31` |
| 最值得抄的一件事 | **每条边都带归因**（`EXTRACTED`/`INFERRED` + 关联位置），且冲突消解有确定优先级 | `ARCHITECTURE.md:79-85`、`build.py:1907-1924` |
| 第二值得抄 | **把"图查询"当成一等输出**：关键词→种子→BFS/DFS→token 预算内的文本子图，且截断必须显式 | `serve.py:1125-1313`、`serve.py:1418-1493` |
| 第三值得抄 | **写入侧防缩水守卫**：拒绝用更小的图覆盖已有图 | `export.py:292-336`、`build.py:2518-2544` |
| 我们能不能直接用它？ | **不能**。Python 3.10+ 工具链、tree-sitter 原生绑定、`uv`/`pipx` 分发，与 ESM+TS 插件形态正交 | `pyproject.toml:14-53` |
| 但我们能不能抄它的数据契约？ | **能**。我们的 `GraphEdge.properties` 是 `Record<string, unknown>`，归因字段可零侵入落地 | `src/types/index.ts:60-68` |

---

## 一、先证伪：这不是一个营销仓库

任务要求「若发现仓库是空壳/营销仓库必须直接说明」。核验项与结果：

| 核验项 | 方法 | 结果 |
|---|---|---|
| 源码体量 | `git ls-files '*.py' \| xargs wc -l` | 237,376 行 |
| 文件构成 | `git ls-files \| sed 's/.*\.//' \| sort \| uniq -c` | `.py 589`、`.md 369`、测试夹具含 `.cs/.pas/.cpp/.php/.swift/.rs/.xaml/.sql` 等 15+ 语言样本 |
| 最大模块 | `wc -l graphify/*.py` | `extract.py 11513`、`extractors/engine.py 10869`、`cli.py 5480`、`extractors/resolution.py 4321`、`llm.py 3910` |
| 测试密度 | `grep -rh "^def test_" tests/*.py \| wc -l` | 7,055 个测试函数，474 个测试文件 |
| 有没有真实产出 | `worked/` 目录 | `worked/httpx/graph.json` 142 KB、`worked/karpathy-repos/graph.json` 122 KB，含真实节点/边 |
| CI | `.github/workflows/` | `ci.yml`、`publish.yml`、`release-graph.yml`、`pr-management.yml` |
| 文档自洽性 | `tests/test_architecture_doc.py` | `ARCHITECTURE.md:15` 明确写入「本表的每个符号都被 `tests/test_architecture_doc.py` import，所以这张表不会与代码漂移」——**文档表被测试钉住**，这是我见过少见的做法 |

对 `worked/httpx/graph.json` 做了实际统计（用 Python 读，非引用文档）：

```
top keys: ['directed', 'multigraph', 'graph', 'nodes', 'links']
nodes: 144 links: 330
relation counts: uses 110, method 81, contains 53, calls 46, inherits 30, imports_from 10
confidence counts: EXTRACTED 174, INFERRED 156
edge keys: relation 330, confidence 330, source_file 330, source_location 330,
           weight 330, _src 330, _tgt 330, source 330, target 330
```

**330/330 的边都同时带 `confidence` 与 `source_location`**。这不是文档承诺，是产物事实，也是本报告 §6 的核心证据。

结论：仓库货真价实，且工程质量高于同类"知识图谱"项目（有 schema 校验、有冲突消解策略、有防缩水守卫、有缓存 schema 版本号）。可以放心借鉴。

---

## 二、它到底解决什么问题

一句话：**把「在代码库里找答案」从"读文件"改成"查图"**，并让这个图在多次会话之间持久化。

`README.md:34-38` 的三条主张，逐条对应实现：

| 主张（README 原文意译） | 实现落点 | 关键证据 |
|---|---|---|
| 代码用 tree-sitter 解析，确定性、无 LLM、不出本机 | `extract()` 的 per-file AST 阶段 + `extractors/` 40+ 语言模块 | `extract.py:9489-9537`、`detect.py:48` |
| 每条边都被解释：`EXTRACTED`（源码里明写）/ `INFERRED`（解析推断） | 边属性 `confidence` + `confidence_score` + `source_location` | `ARCHITECTURE.md:79-85`、`validate.py:5-6`、`worked/httpx/graph.json` |
| 不是向量索引：无 embedding、无向量库，是真的可遍历的图 | `cluster.py` 用 Leiden/Louvain 直接从边密度聚类；查询走 BFS/DFS + 关键词打分 | `docs/how-it-works.md:26-31`、`serve.py:1418-1493` |

它**不是**一个"代码可视化工具"，也不是一个 IDE 插件；它的产品形态是 **CLI + assistant skill + MCP server**，交付物是三个文件（`README.md:63-70`）：

```
graphify-out/
├── graph.html       交互式图
├── GRAPH_REPORT.md  上帝节点 / 社区 / 可疑连接
└── graph.json       完整图（可反复查询，无需重读源码）
```

---

## 三、解析流水线

### 3.1 三段式（Pass 1/2/3）与总链路

`ARCHITECTURE.md:8` 给出主链：

```
detect() → extract() → build() → cluster() → analyze helpers → report.generate() → export.to_*()
```

`docs/how-it-works.md:5-22` 把输入按「要不要花钱」切成三 Pass：

| Pass | 输入 | 是否用 LLM | 实现 |
|---|---|---|---|
| Pass 1 代码结构 | 代码文件 | 否，纯 tree-sitter | `extract.py` + `extractors/*` |
| Pass 2 音视频 | video/audio | 否，本地 faster-whisper | `transcribe.py` |
| Pass 3 文档/PDF/图 | docs/papers/images | 是（后端可配） | `llm.py` |

**关键设计**：`docs/how-it-works.md:10` 明确「代码文件在正常流水线里**不会**送给语义抽取器」；纯代码语料下 Pass 3 直接跳过。这解释了它为什么敢喊 "0 LLM credits 建图"（`README.md:138`）。

### 3.2 Pass 1 内部：实际是**两遍**扫描，不是一遍

这是最容易被 README 读漏的一点。`extract()` 的 docstring 自己写明（`extract.py:9499-9504`）：

```
Two-pass process:
1. Per-file structural extraction (classes, functions, imports)
2. Cross-file import resolution: turns file-level imports into
   class-level INFERRED edges (DigestAuth --uses--> Response)
```

更准确地说，是「per-file 抽取 → 收集 `raw_calls` → 全局索引 → 跨文件消解」：

| 阶段 | 做什么 | 证据 |
|---|---|---|
| per-file | 每个 extractor 返回 `{nodes, edges, raw_calls}`；`raw_calls` 里存**尚不能解析**的调用点 | `extract.py:4796-4801` 汇总 `all_raw_calls` |
| 索引 | 用**所有文件**的节点建 `label -> node_id` 索引后再消解 | `extract.py:10626-10631` 注释「Each extractor saved unresolved calls in raw_calls. Now that we have all nodes from all files, resolve any callee that exists in another file」 |
| 消解 | 命中即产出 `calls` 边；带 `context` / `confidence` / `confidence_score` / `source_location` | `extract.py:4851-4861` |
| 证据升级 | 若 caller 所在文件**确实 import** 了 callee，则把 `INFERRED` 提级为 `EXTRACTED` | `extract.py:10690-10700` 区段注释「Build evidence index from import edges so cross-file calls backed by imports get promoted INFERRED -> EXTRACTED」 |

这个「**有 import 证据才提级**」是整套归因的可信度基石：它不是"我觉得这条边对"，而是"我有一条可指认的证据链"。我们抄归因时必须一起抄这条升级规则，否则 `EXTRACTED` 会退化成随便贴的标签。

### 3.3 语言支持矩阵

不要信 README 的"~40 种"。以代码为准：

| 来源 | 事实 |
|---|---|
| `detect.py:48` `CODE_EXTENSIONS` | 单个集合，**114 个扩展名**（`.py .ts .tsx .mts .cts .js .jsx .mjs .cjs .ejs .ets .go .rs .vb .cbl .cob .cobol .cpy .java .groovy .gradle .cpp .cc .cxx .c .h .hpp .cu .cuh .metal .rb .rake .swift .kt .kts .cs .scala .php .lua .luau .toc .zig .ps1 .psm1 .psd1 .ex .exs .m .mm .ml .mli .jl .vue .svelte .astro .dart .v .sv .svh .vh .sql .r .f .F .f90 ... .pas .dfm .sh .bash .json .yaml .yml .tf .tfvars .hcl .dm .dme .sln .csproj .xaml .razor .cshtml .cls .trigger .lisp .asd .robot .sol .erl ...`） |
| `pyproject.toml:28-53` | 必装 tree-sitter 语法：python/js/ts/go/rust/java/groovy/c/cpp/ruby/c-sharp/kotlin/scala/php/swift/lua/zig/powershell/elixir/objc/julia/verilog/fortran/bash/json |
| `pyproject.toml:62-114` | **可选**语法（`[pdf] [office] [video] [neo4j] [leiden] [sql] [pascal] [ocaml] [commonlisp] [robot] [terraform] [dm] [chinese]` 等）：SQL/Pascal/OCaml/CommonLisp/Robot/Terraform/DreamMaker 缺失时**降级为正则抽取器** |
| `ARCHITECTURE.md:87-93` | 新增语言的标准 5 步：写 `extract_<lang>()` → 注册后缀（`extract()` 分派表 + `collect_files()` 两处）→ 加 `CODE_EXTENSIONS` 与 `watch._WATCHED_EXTENSIONS` → 加依赖 → 加夹具与 `tests/test_languages.py` |

值得注意的工程细节：`pyproject.toml:22-27` 有一段关于 `tree-sitter>=0.25` 下限的注释——0.23/0.24 只到 ABI 14，而语法包已是 ABI 15，所以解析器可能装出 `Incompatible Language version 15`。这是"把踩过的坑写进依赖注释"的正面案例。

### 3.4 抽取产物的 schema

`ARCHITECTURE.md:56-71` 定义、`validate.py:5-6` 强制：

```python
VALID_FILE_TYPES = {"code", "document", "paper", "image", "rationale", "concept"}
VALID_CONFIDENCES = {"EXTRACTED", "INFERRED", "AMBIGUOUS"}
REQUIRED_NODE_FIELDS = {"id", "label", "file_type", "source_file"}
REQUIRED_EDGE_FIELDS = {"source", "target", "relation", "confidence", "source_file"}
```

注意 `confidence` 是**边的必填字段**，不是可选装饰。`validate.py` 在 `build()` 之前跑，把 schema 错误收集成字符串列表返回（`validate_extraction`）或直接抛（`assert_valid`），见 `ARCHITECTURE.md:31`。

### 3.5 缓存与增量

| 机制 | 实现 | 证据 |
|---|---|---|
| 内容指纹 | 每个文件按内容 SHA256 做键，未变则整文件跳过 | `docs/how-it-works.md:77-79`、`cache.py:512` `file_hash()` |
| 缓存目录带版本 | `v{extractor_version}-s{schema}-g{grammar_fingerprint}` | `cache.py:1040` |
| schema 版本号 | `_AST_CACHE_SCHEMA = 29`，且**每版都写清为什么失效**（注释长约 40 行，逐版列出被修的语言与 issue 号） | `cache.py:41` |
| 语法指纹 | 语法包升级即换目录，避免旧缓存被新语法复用 | `cache.py:49` `_grammar_fingerprint()` |
| 统计签名索引 | `_stat_index_file()` / `_stat_sig_fresh()`：先比 stat 再比 hash，省一次读 | `cache.py:373-440` |
| 语言覆盖参与缓存键 | `.graphifyrc` 里 `language.inc=php` 改动后，同一文件不会命中旧语言的缓存 | `README.md:405` |

`_AST_CACHE_SCHEMA = 29` 那条注释（`cache.py:41`）本身就是一份"抽取器变更史"，这是很低成本、很高价值的工程习惯——**缓存版本号必须解释自己**，否则没人敢升、也没人知道该不该升。

---

## 四、架构图与模块表

### 4.1 文本架构图

```
                    ┌──────────────┐
   目录 / GitHub URL →│   detect()   │  文件分类、词数统计、警告
                    └──────┬───────┘
                           ↓  paths: list[Path]
                    ┌──────────────┐        ┌─────────────┐
                    │   extract()  │←──────→│  cache.py   │ SHA256 + AST cache v29
                    │  （两遍扫描） │        └─────────────┘
                    └──────┬───────┘
                           ↓  {nodes, edges, hyperedges}   ← validate.py 先校验
                    ┌──────────────┐
                    │   build()    │  NetworkX；冲突消解、去重、防缩水
                    └──────┬───────┘
                           ↓  nx.Graph
              ┌────────────┼─────────────┐
              ↓            ↓             ↓
        ┌──────────┐ ┌───────────┐ ┌──────────┐
        │cluster() │ │ analyze.* │ │dedup.py  │
        │Leiden    │ │god_nodes  │ │MinHash   │
        └────┬─────┘ │surprises  │ └────┬─────┘
             │       │cycles     │      │
             └───────┴─────┬─────┴──────┘
                           ↓
                 ┌──────────────────┐
                 │ report.generate()│ → GRAPH_REPORT.md
                 └────────┬─────────┘
                          ↓
        ┌─────────────────┼──────────────────┐
        ↓                 ↓                  ↓
  export.to_json    export.to_html     export.to_svg/graphml/
  graph.json        graph.html         obsidian/canvas/wiki
        │
        ├──→ serve.serve()        MCP stdio（10 个 tool）
        ├──→ serve.serve_http()   HTTP
        └──→ cli.py query/path/explain   终端文本
```

### 4.2 模块表（路径 → 职责 → 关键实现要点）

行数取自 `wc -l`。

| 路径 | 行数 | 职责 | 关键实现要点 |
|---|---|---|---|
| `graphify/detect.py` | 3,244 | 目录 → 扫描摘要 | `CODE_EXTENSIONS` 单一真源（`detect.py:48`）；二进制媒体**不解码**只按存在计入语料（`ARCHITECTURE.md:36-40`） |
| `graphify/extract.py` | 11,513 | 文件列表 → `{nodes, edges}` | 两遍扫描；per-file 抽取 + 全局索引消解；`_PARALLEL_THRESHOLD` 以上用 `ProcessPoolExecutor`（`docs/how-it-works.md:71-73`） |
| `graphify/extractors/` | 30,979 | 40+ 语言抽取器 | `engine.py` 10,869 行是共享遍历引擎；`resolution.py` 4,321 行是跨语言名字消解 |
| `graphify/build.py` | 3,008 | 抽取结果 → `nx.Graph` | 冲突消解（§6.3）、`_mint_external_stub`（悬空终点补叶节点）、`unverified_semantic_shrink` 标记 |
| `graphify/cluster.py` | 500+ | 社区检测 | Leiden（有 `leiden` extra）→ 无则 Louvain（`README.md:380`）；`remap_communities_to_previous()` 让社区编号跨次重建保持稳定（`cluster.py:434`） |
| `graphify/analyze.py` | 834 | 上帝节点/可疑连接/建议问题/环 | `god_nodes()`（`analyze.py:112`）、`surprising_connections()`（:151）、`find_import_cycles()`（:720） |
| `graphify/report.py` | — | 图 → `GRAPH_REPORT.md` | `generate(G, communities, cohesion_scores, community_labels, ...)`（`ARCHITECTURE.md:24`） |
| `graphify/export.py` | 1,455 | 图 → 多格式 | `to_json` 带**防缩水守卫**（§8.2）；`built_at_commit` 溯源戳 |
| `graphify/serve.py` | 3,136 | 查询引擎 + MCP + HTTP | 本报告 §7 的全部内容都在这个文件里 |
| `graphify/cache.py` | 1,943 | SHA256 / AST 缓存 | schema v29；stat 快路径 |
| `graphify/dedup.py` | 1,760 | 实体去重 | 管道：精确归一 → 熵门 → MinHash/LSH 分桶 → Jaro-Winkler 验证 → 同社区加权 → 并查集合并（`dedup.py:1-5`） |
| `graphify/_minhash.py` | — | MinHash + band-LSH | **自实现**以摆脱 `datasketch`→`scipy` 在 Windows/EDR 环境下 `cmd.exe` 卡死的依赖链（`_minhash.py:1-12`） |
| `graphify/watch.py` | 3,237 | 目录监听增量重建 | `watch(watch_path, debounce=3.0)`、`check_update()`（`ARCHITECTURE.md:33`） |
| `graphify/security.py` | — | 外部输入校验 | URL 协议白名单、禁 `file://` 重定向、抓取大小上限、`validate_graph_path` 限定在 `graphify-out/`、`sanitize_label` 去控制符（`ARCHITECTURE.md:95-104`） |
| `graphify/skills/<platform>/` | — | 14 个平台技能包 | 每个平台一份 `SKILL.md` + `references/`（按需加载的 sidecar） |
| `graphify/always_on/` | — | 常驻指令模板 | `claude-md.md`/`agents-md.md`/`gemini-md.md`/`vscode-instructions.md`/`kiro-steering.md`/`antigravity-rules.md` |
| `graphify/pi/index.ts` | — | Pi 原生扩展（TypeScript） | 唯一一处 TS 代码，用于在 Pi 里注册 `hook-guard`（`README.md:256`） |

### 4.3 一个反直觉的架构事实：文档表被测试钉住

`ARCHITECTURE.md:15` 原文：

> Signatures below are the real ones - `tests/test_architecture_doc.py` imports every symbol named here, so this table cannot drift from the code.

即：架构文档里列出的每个符号都被一个测试**真实 import**。文档写错符号名 → 测试红。这条做法对我们直接可用（本项目 `CLAUDE.md` 里那堆"文档与实现漂移"的教训，根因就是文档没人 import）。

---

## 五、关键设计决策（8 条）

每条按「决策 / 动机 / 代价 / 我们能抄什么」四段写。**代价**一栏是我读完代码后的判断，不是原作者的原话。

### 决策 1：置信度是边的**必填 schema 字段**，不是渲染装饰

- **决策**：`confidence ∈ {EXTRACTED, INFERRED, AMBIGUOUS}` 进入 `REQUIRED_EDGE_FIELDS`，`validate.py` 在 `build()` 前强制（`validate.py:6`、`ARCHITECTURE.md:71`）。
- **动机**：让"读到的"和"推出来的"永远可区分。下游（报告、查询、可视化）因此可以按可信度排序/过滤，而不是把所有边当成同等事实。
- **代价**：每个抽取点都必须给出置信度，抽取器代码量增加；`AMBIGUOUS` 需要人工复核流程（`GRAPH_REPORT.md` 里单列）。
- **我们能抄什么**：我们的 `GraphEdge` 没有这个字段，但 `properties: Record<string, unknown>`（`src/types/index.ts:67`）可以零签名变更承载它。**必须同时抄的**是「必填 + 校验」：只加可选字段等于永不生效（`GraphValidator.sanitizeTypedGraph` 才是校验落点）。

### 决策 2：有证据才提级 —— `INFERRED → EXTRACTED` 的升级由 import 边驱动

- **决策**：跨文件调用默认 `INFERRED`；若 caller 所在文件确实 import 了 callee 的符号/文件，则提为 `EXTRACTED`（`extract.py:10688-10690`）。
- **动机**：`EXTRACTED` 的含义必须是"源码里明写"。一条跨文件 `calls` 边本身是解析推断，但"这个文件 import 了那个文件"是源码事实；有了这条事实，推断就有了可指认的锚。
- **代价**：需要先建 import 证据索引（多一遍扫描）；且顺序敏感——注释明确写「必须在这里、不能放到更晚的 `run_language_resolvers`」（`extract.py:10688-10691`）。
- **我们能抄什么**：我们的 `mapEdgeKind` 无法知道上游是否"因为 import 才连上"。所以**只能抄到"有位置 = 有锚"这一层**（见 §6.5 与 P0-1）：有 `line` 的边与 `line === null` 的边必须分开，这是上游 schema 已经给的唯一可信信号。

### 决策 3：图是**有向事实 + 无向存储**，方向靠 `_src/_tgt` 显式保存

- **决策**：`graph.json` 写 `"directed": false`，但每条边额外带 `_src` / `_tgt`；读取时用 `paths.load_node_link_graph()` 还原（`ARCHITECTURE.md:73-77`）。
- **动机**：NetworkX 的无向图会按节点列表位置重排端点，方向丢失；而渲染"谁调谁"必须有方向。
- **代价**：每条边多两个字段；任何写出路径都必须先把标记弹回 arc 顺序（`export.to_json()` 负责）。
- **我们能抄什么**：我们已经有 `direction?: EdgeDirection`（`src/types/index.ts:65`）但只有 `forward|backward|bidirectional` 三值，且我们读的是 `source`/`target` 而非无序对，所以**这条不完全适用**。但它的教训适用：**任何派生字段都必须在写回时被显式处理**，否则同一份数据在两次读写后会漂移。我们的 `graphFingerprint.canonicalizeEdge` 把 `direction` 与 `weight` 都纳入哈希（`src/shared/graphFingerprint.ts:99-110`），这一点已经做对了。

### 决策 4：不用向量库 —— 用**图结构本身**当语义信号

- **决策**：无 embedding、无向量数据库；"语义相似"通过 LLM 抽出的 `semantically_similar_to` 边进入图，再让 Leiden 直接吃到社区形状里（`docs/how-it-works.md:26-31`）。
- **动机**：向量检索给的是"一批相似文本"，图检索给的是"一条可解释的路径"。任务要的是后者（`graphify path A B` 就是产品级卖点）。
- **代价**：召回完全依赖关键词/子串匹配 + 图遍历；`graphify/skills/*/references/query.md:23-59` 承认这一点，于是要求 agent **先**从图的实际词表里做「受限查询扩展」（只能用图里出现过的 token，不许编），并在输出里打印扩展结果以便审计。也就是说：**它用流程补了检索的词法短板**。
- **我们能抄什么**：这条对我们**最重要的一条负面结论**——不要为了"智能搜索"引入 embedding。我们的 `fuzzyMatch/fuzzyScore`（`src/shared/searchUtils.ts:48-62`）+ Trie 已经够用；缺的是「词表受限扩展」这个**流程约束**，而这个可以纯文本落地。

### 决策 5：查询的输出是**带 token 预算的文本**，不是 JSON

- **决策**：`query_graph` 返回 `NODE …/EDGE …` 行文本，按 `token_budget * 3` 字符截断；截断时在**顶部**插告示（`serve.py:1125-1313`）。
- **动机**：入口是 LLM，LLM 的稀缺资源是 context。JSON 会浪费 token 在括号和重复键上；且 JSON 被截断就是语法错误，文本被截断仍可读。
- **代价**：牺牲了结构化（脚本要用得自己 parse）；预算估算用 `len/3` 是粗糙近似（`serve.py:1131`、`:1285`）。
- **我们能抄什么**：**全部**。我们的工具输出是 `{ schema: { type: 'json' } }`（`src/tools.ts:344-345` 等），面向 LLM 时这是次优的；`graph_path_find` 已经在 `render` 里手写了一句人读文本（`src/tools.ts:346-353`），说明方向没错，只是没有预算与截断协议。

### 决策 6：截断必须**显式到不可能被误读**

- **决策**：一旦超预算，输出顶部加 `[!] TRUNCATED: showing N of M nodes …`，并给出「把 budget 提到多少才够」的精确数字；底部再加截断行与缩小建议（`serve.py:1295-1312`）。
- **动机**：注释写得很直白——`serve.py:1266-1279` 解释「静默截断会被读成"图里没有"」（`#2601`、`#BUG2`）。更狠的一段：如果所有 NODE 都装下了、只是边装不下，它**不下刀**，而是返回完整结果 + 一行"这已经是完整答案，加预算也不会变小"（`serve.py:1280-1294`）。
- **代价**：告示行本身超出预算（作者明说"两个有界包装行，故意放在预算之外"，`serve.py:1296-1299`）；逻辑分支变多。
- **我们能抄什么**：我们有 `API.DATA_RESPONSE_MAX_BYTES` 超限后 `slimGraphData` + `x-truncated: 1`（`src/host/routes/dataRoutes.ts:78-86`）。**我们已经做了一半**：标记有了，但没有"告诉调用方怎么才能拿全"这件事。而 `metadata.truncated` 这条链在本项目的 `CLAUDE.md` 里被反复记为缺陷来源（"a degraded default must decline, not promise"）。graphify 的写法给出了更强的形态：**给精确的下一步**。

### 决策 7：写入侧防缩水 —— 宁可拒绝写，也不静默变小

- **决策**：`to_json` 在覆盖已存在的 `graph.json` 前比较节点数；新图更小或旧文件读不出来时**拒绝写**，除非显式 `force=True`（`export.py:292-336`）。另外 `build_merge` 会对"重新抽取后语义节点变少"的源文件打 `_unverified_semantic_shrink` 标记（`build.py:2518-2544`）。
- **动机**：增量/局部重建的静默失败，表现为"图变小了但一切正常"，用户下次查询得到"没有这个东西"的**错误否定**。这是数据丢失里最难发现的一类。
- **代价**：误报时会挡住合法的小图重建（需要 force）；旧文件损坏时选择 fail-safe 而不是 fail-open（`export.py:323-336` 明确写了这个取舍）。
- **我们能抄什么**：**直接适用**。我们的 `applyGraphDelta` 只校验"被删/改的必须存在"与"新边两端必须存在"（`src/shared/graphDelta.ts:72-90`），**没有**"结果不能比现在小很多"这条。P0-3 就是它。

### 决策 8：缓存版本号必须解释自己

- **决策**：`_AST_CACHE_SCHEMA = 29`，注释逐版列出"这一版为什么必须让旧缓存失效、修了哪个语言的哪条抽取规则、对应 issue 号"（`cache.py:41`）。
- **动机**：抽取器一改，旧缓存就是错的答案，但错误表现是"符号缺失/边缺失"，不会报错。版本号不进就没法强制重算。
- **代价**：注释极长（单行 4,000+ 字符）；每次改抽取规则都要加一段。
- **我们能抄什么**：我们的 `FINGERPRINT.VERSION` 已经在内容哈希前缀里（`src/shared/graphFingerprint.ts:117`），但**没有** AST/解析器版本这一维；tree-sitter 语法升级后旧解析结果会被当新结果用。这是一条小而真实的缺口（见 P1-2）。

---

## 六、边归因（edge explanation）专章

这是本次研究的主目标。分四层：数据结构 → 生成时机 → 冲突消解 → 查询回放，最后一节落到我们的 `GraphEdge.properties` 兼容性。

### 6.1 数据结构：一条边到底带了什么

`ARCHITECTURE.md:64-67` 与 `docs/how-it-works.md:94-100` 的定义，用 `worked/httpx/graph.json` 的真实行验证：

```json
{
  "relation": "imports_from",
  "confidence": "EXTRACTED",
  "source_file": "worked/httpx/raw/client.py",
  "source_location": "L6",
  "weight": 1.0,
  "_src": "client",
  "_tgt": "models",
  "source": "client",
  "target": "models"
}
```

| 字段 | 语义 | 必填 | 真实分布（httpx 330 条边） |
|---|---|---|---|
| `relation` | 动词语义：`calls`/`imports`/`imports_from`/`uses`/`inherits`/`contains`/`method`/`references`… | 是 | `uses 110、method 81、contains 53、calls 46、inherits 30、imports_from 10` |
| `confidence` | 三值枚举 | 是 | `EXTRACTED 174、INFERRED 156`（INFERRED 占 **47%**） |
| `confidence_score` | INFERRED 的强度浮点 | 否（INFERRED 应有） | 抽取器实发 `1.0/0.95/0.85/0.75`；`export.py:197` 兜底 `INFERRED:0.55` |
| `source_file` | 这条**关系**被看到的位置所在文件 | 是 | 330/330 有 |
| `source_location` | 关系处的**行号**（不是 def 行） | 否，但实际全有 | 330/330 有 |
| `context` | 关系子类：`call`/`import`/`field`/`parameter_type`/`return_type`/`generic_arg`/`re-export`/`property_read`… | 否 | 在老版 `worked/httpx/graph.json` 里没有；源码里出现 13 种取值 |
| `_src`/`_tgt` | 真实方向（无向存储用） | 写出时自动打 | 330/330 有 |
| `weight` | 多源合并的权重 | 否 | 330/330 = 1.0 |

`context` 的完整取值（对 `graphify/` 全目录 `grep -oP '"context":\s*"\K[^"]+'` 统计）：

```
call 23, import 19, re-export 2, constructor 2, sourced_call 1, scip 1,
remote_call 1, property_read 1, partial_type_call 1, map 1,
import_guided_call 1, field 1, dependency 1, cargo_dependency 1
```

**这是"边归因"的第二维**：`confidence` 说"有多可信"，`context` 说"这条边是哪一类事实"。二者正交。查询时 `context` 变成可过滤维度——`_CONTEXT_HINTS`（`serve.py:913-920`）把用户问题里的词映射到 context：

| 用户问题里的词 | 映射到的 context |
|---|---|
| call / calls / caller / invoke | `call` |
| import / imports / module | `import` |
| field / member / property | `field` |
| parameter / param / argument | `parameter_type` |
| return / returns | `return_type` |
| generic / template | `generic_arg` |

还有一层别名表 `_CONTEXT_FILTER_ALIASES`（`serve.py:923-958`）把 `calls→call`、`properties→field`、`annotation→attribute` 等归并。也就是说：**归因字段不只是给人看的，它同时是查询的过滤维度**。这一点比字段本身更值钱。

### 6.2 生成时机：三个不同的时刻

| 时机 | 谁产出 | 产物 | 证据 |
|---|---|---|---|
| ① per-file 解析期 | 各语言 extractor | 确定性的 `imports`/`contains`/`inherits` 等边，带 `source_location` | `extract.py:816-820`、`extract.py:2913` |
| ② 跨文件消解期 | `extract()` 的第二遍 | `calls`/`references` 边，`INFERRED` 起步 | `extract.py:4851-4861` |
| ③ 证据提级期 | import 证据索引 | 把 ② 里的边按证据升为 `EXTRACTED` | `extract.py:10688-10690` |
| ④ 语义抽取期（可选，花钱） | LLM subagent | 文档/概念节点与 `semantically_similar_to`，`AMBIGUOUS` 可能出现在这里 | `docs/how-it-works.md:15-16`、`validate.py:6` |

②的代码值得单独看（`extract.py:4847-4861`）：

```python
# A type-qualified call (`Type.staticMethod()`) names the receiver type
# explicitly in source, so it is an exact reference — EXTRACTED, matching
# the Python qualified-class-method pass (#1533). An instance call whose
# receiver type came from local inference (`obj.method()`) stays INFERRED.
all_edges.append({
    "source": caller,
    "target": target,
    "relation": relation,          # 找到方法名 -> calls，只找到类型 -> references
    "context": "call",
    "confidence": "EXTRACTED" if type_qualified else "INFERRED",
    "confidence_score": 1.0 if type_qualified else 0.85,
    "source_file": rc.get("source_file", ""),
    "source_location": rc.get("source_location"),
    "weight": 1.0,
})
```

三件事同时发生：**relation 由"找到多深"决定**（方法名 → `calls`，只有类型 → `references`）、**confidence 由"源码是否明写接收者类型"决定**、**score 跟着 confidence 走**。归因不是一个独立步骤，它是解析结果的直接投影。

`serve.py:1237-1244` 还有一条容易抄漏的约定：

> The relation SITE (call/import/reference line in the source's file), not a def line — so "who calls X" cites a clickable call location, not the caller's def (#BUG1)

即**边的 `source_location` 指向调用点，不是调用者的定义行**。这是"可点击可回溯"的前提。

### 6.3 冲突消解：同一个节点对出现多条边时谁赢

这是归因体系里最容易被忽略、却决定"归因是否可信"的一节。`build.py:1860-1924` 是一段**分层裁决**，顺序固定：

| 顺序 | 规则 | 代码 |
|---|---|---|
| 1 | 无向图上同 relation 的反向重复边：**先见方向胜** | `build.py:1867-1873` |
| 2 | 反向且已存的是 `method`/`contains`、新来的是 `calls`：**成员关系胜** | `build.py:1881-1886`（`_STRUCTURAL_MEMBER_RELATIONS`，`build.py:190`） |
| 3 | 新来的是泛化关系（`references`/`uses`/`mentions`）而已存的是具体关系：**具体胜** | `build.py:1898-1906`（`_GENERIC_RELATIONS`，`build.py:180`） |
| 4 | 同 relation 时比置信度等级：**高等级胜**（`EXTRACTED 3 > INFERRED 2 > AMBIGUOUS 1`） | `build.py:1907-1913`（`_CONFIDENCE_RANK`，`build.py:191`） |
| 5 | 同等级时比"有没有位置"：**有 `source_location` 的胜** | `build.py:1914-1916` |
| 6 | 再比 `confidence_score`：**高者胜** | `build.py:1914-1924` |
| 7 | 都平：后写覆盖（顺序已由上方的确定性排序固定） | `build.py:1925` |

注释里有一段很有说服力的复盘（`build.py:1887-1897`）：原先纯靠"按 relation 名字排序后后者覆盖"，结果 `references` 排在 `calls` 之后，把该 corpus 上 **144 个同时含 `calls` 与 `references` 的节点对全改写成了 `references`**；而 callflow 的关系过滤器不含 `references`，于是这些调用点**整批从调用图里消失**。这正是"归因策略会把数据改坏"的现场。

### 6.4 查询回放：归因怎么出现在答案里

`serve.py:1125-1313` 的渲染格式（真实形态，省略中间行）：

```
NODE RequestValidationError [src=… community=2 attrs={…}]
EDGE APIRouter --uses [INFERRED context=call]--> RequestValidationError at=routing.py:L2210
```

逐字段对应：

| 输出位置 | 来源 | 代码 |
|---|---|---|
| `--<relation>` | `edge.relation` | `serve.py:1247` |
| `[<confidence><` `context=…`]` | `edge.confidence` + `edge.context` | `serve.py:1248`、`serve.py:1235-1236` |
| `at=<file>:<line>` | `edge.source_file` + `edge.source_location` | `serve.py:1240-1244` |
| 方向 | `_src`/`_tgt`，且用 `{src,tgt} != {u,v}` 做**篡改防御**，不匹配就退回遍历顺序 | `serve.py:1227-1234` |

`graph_stats` 则把归因聚合成一句体检（`serve.py:2571-2582`）：

```python
confs = [d.get("confidence", "EXTRACTED") for _, _, d in G.edges(data=True)]
f"EXTRACTED: {round(confs.count('EXTRACTED')/total*100)}%"
f"INFERRED:  {round(confs.count('INFERRED')/total*100)}%"
f"AMBIGUOUS: {round(confs.count('AMBIGUOUS')/total*100)}%"
```

注意默认值是 `EXTRACTED`：**缺字段按最可信处理**。这个默认与 `export.py:189-197` 的相反取向（缺 score 时给**最弱**的 0.55）形成一组有意的不对称——等级缺失时乐观，强度缺失时悲观。作者在 `export.py:193-196` 解释了理由：「缺失的 score 是"关于强度的证据缺失"，诚实的兜底是规则允许的最弱值，而不是读起来像抛硬币的中点」。

### 6.5 落到我们的 `GraphEdge.properties`：兼容性分析

先看我们有什么（本项目 `src/types/index.ts:60-68`）：

```ts
export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  type: 'call' | 'import' | 'extend' | 'implement' | 'dependency'
      | 'contains' | 'association' | 'aggregation' | 'composition';
  direction?: EdgeDirection;
  weight?: number;
  properties: Record<string, unknown>;   // ← 归因的落点
}
```

逐字段兼容性判断：

| graphify 字段 | 我们的现状 | 兼容性 | 落地判断 |
|---|---|---|---|
| `confidence` | 无 | **可加**（进 `properties`，无需改接口） | 可落地，但**值必须能从我们的数据源诚实推导**（见下） |
| `confidence_score` | 无 | 可加 | 与 `confidence` 同批 |
| `relation` 细分 | `type` 只有 9 个值（`src/types/index.ts:64`） | **半兼容** | 我们有 `type` 但没有 `imports_from`/`method`/`inherits` 这类细分。上游 `kind` 有更多值，但我们的 `EDGE_KIND_MAP`（`src/adapters/CodeGraphAdapter.ts:155-167`）把它们**压平**了。要保留细分就得在 `properties` 里存原始 `kind` |
| `source_location` | `properties.line`（仅当 `line !== null`） | **已兼容** | `mapRowsToGraphEdges` 已写入 `line`（`src/adapters/CodeGraphAdapter.ts:287-291`） |
| `context` | 无 | 可加 | 我们连 `line` 都在丢一半（`null` 时整个键不写），先解决"有没有位置"再谈"位置属于哪类事实" |
| `_src`/`_tgt` | `source`/`target` 本身有序 | **不需要** | 我们的存储不丢失方向 |

**关键的诚实性约束**：上游 `codegraph.db` 的边表 schema 是

```ts
// src/adapters/CodeGraphAdapter.ts:97-103
export interface DbEdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  line: number | null;
}
```

**没有 `confidence` 列**。所以我们**不能**凭空给 codegraph 边贴 `EXTRACTED`/`INFERRED`——那是编造证据，恰好违反本任务第 2 条纪律。

我们真正能证明的是什么？三条：

| 能证明的事实 | 依据 | 可派生的归因 |
|---|---|---|
| 这条边来自 AST 父子包含 | `TreeSitterAdapter` 只在 `graphType` 命中时按 `parentId` 造 `contains` 边（`src/adapters/TreeSitterAdapter.ts:412-433`） | `EXTRACTED`（语法结构，无一例外） |
| 这条边在上游索引里记了位置 | `DbEdgeRow.line !== null` | `located`：证据可回溯到具体行 |
| 这条边没有位置 | `DbEdgeRow.line === null` | `unlocated`：只能信其存在，不能回溯 |

因此 P0-1 的正确形态不是"抄 confidence 三值枚举"，而是**抄归因的骨架 + 只用我们证得出来的取值**：

```ts
// 建议形态（properties 内，不改接口）
properties: {
  line: e.line,                       // 已有
  __source: 'codegraph',              // 已有
  edgeOrigin: 'ast' | 'index' | 'manifest' | 'heuristic',   // 新：这条边由谁造出来
  edgeLocatable: boolean,             // 新：line != null
}
```

`ast` 的判定不需要猜：只有 `TreeSitterAdapter` 产 `contains` 边。`index`/`manifest`/`heuristic` 分别对应 `CodeGraphAdapter` / `DependencyAdapter` / `LensAdapter`——**四个 adapter 的产物互斥**，所以这个分类是**可证明的**，不是推断的。

这比"贴一个假 confidence"价值低一档，但它是真的；而真的是可以往上长的——等上游 `codegraph.db` 哪天真有 `confidence` 列，`edgeOrigin` 这套结构不用改。

---

## 七、检索与查询：不用向量库，那到底怎么查

全部实现在 `graphify/serve.py`（3,136 行）。查询链路：

```
问题文本
  → _query_terms()          分词 + 停用词
  → _score_query()          一次遍历：IDF 加权 + 分层加分 + trigram 预筛
  → _pick_seeds()           分数断层截断 + 每词保底一个种子
  → _traversal_view()       建无向遍历视图（保留 _src/_tgt）
  → _bfs()/_dfs()           深度受限遍历
  → _subgraph_to_text()     token 预算内的 NODE/EDGE 文本，显式截断
```

### 7.1 分词：`_` 是分隔符，不是单词字符

`_search_tokens()`（`serve.py:222-233`）的注释是一段真实 bug 复盘：

> `\w` counts underscore as a word character but not hyphen, so `graph_first_guard` stayed one token while the label `graph-first-guard.py` split into three — and the query matched nothing.

所以分词器用 `[^\W_]+`：**下划线与连字符等价**。查询侧与标签侧走同一个函数，所以两边永远一致。这条对我们直接有用——我们的 `fuzzyMatch`（`src/shared/searchUtils.ts:48`）是纯子串匹配，`getFileOutline`/`a.b.c` 这类标签与用户输入的 `a b c` 不会互相命中。

### 7.2 停用词：为"问题句"专门准备，且多语种

`_QUERY_STOPWORDS`（`serve.py:284-314`）不只是 the/a/is：

| 组 | 例子 | 为什么必须去掉（源自注释） |
|---|---|---|
| 英语疑问/助动 | how what why does is are can should would has have the and … | 「how does the frontier cache work」若不去掉，会种子到 `work`，而 `work` 会 100 倍地前缀命中散文标签 "Working Principles"，于是落进图的错误区域（`serve.py:258-264`） |
| 动词 filler | work/works/working、get/gets/got | 「how does X get authorized」里的 `get` 会精确命中 NestJS 的 `Get` 装饰器（`serve.py:265-268`） |
| 德语 | wie funktioniert der die das nicht … | 在英语语料里德语疑问词**极罕见** → IDF 极高 → 权重反而压倒真正的内容词（`serve.py:270-276`） |
| 法/西/葡/意 | pourquoi comment est como qué funciona qual … | 同上 |

而且作者为"误伤"做了显式取舍（`serve.py:277-283`）：`die`/`hat` 收进去（德语价值高），`war`/`bald` 故意不收（避免打死英语的 war/bald）；`comment`/`come`/`son`/`sin`/`con`/`pour`/`des` 也都不收。**这是一份带取舍说明的词表**，不是抄来的列表。

保底逻辑：`content or terms`（`serve.py:335-336`）——全是停用词时退回未过滤结果，保证「how does it work」这种问题仍然有种子。

### 7.3 打分：四档加分 + 覆盖率缩放

`serve.py:339-351` 的常量就是分数的全部梯度：

| 常量 | 值 | 含义 |
|---|---|---|
| `_EXACT_MATCH_BONUS` | 1000.0 | 查询词与标签完全相等 |
| `_PREFIX_MATCH_BONUS` | 100.0 | 标签前缀命中 |
| `_SUBSTRING_MATCH_BONUS` | 1.0 | 标签子串命中 |
| `_RATIONALE_MATCH_BONUS` | 0.75 | 命中节点的 `rationale`（"为什么这么设计"的散文） |
| `_ATTRIBUTE_MATCH_BONUS` | 0.75 | 命中节点 `attributes` 的键值 |
| `_SOURCE_MATCH_BONUS` | 0.5 | 命中 `source_file` 路径 |

注意 rationale/attribute 被刻意排在"标签子串"之下、"源码路径"之上（`serve.py:343-350` 的注释解释了理由：散文命中不该赢过"标签就叫这个名字"，但该赢过"路径里出现过这个词"）。而且它们**不计入词覆盖率**，所以只增加召回、不能凭空赢回一档它没挣到的等级。

IDF 加权（`serve.py:382-404`）：`log(1 + N/(1+df))`，`df` 用标签子串统计，缓存挂在 `G.graph['_idf_cache']` 上——**换图对象即自动失效**，不需要手动清缓存。

### 7.4 性能：trigram 预筛 + "永不更差"契约

`_get_trigram_index()`（`serve.py:475-496`）为每个节点把 `norm_label / label_tokens / nid / source_file / source_tokens / rationale / attributes` 用 `\x00` 拼接后做字符三元组倒排，`postings` 用 `array('i')` 存位置。

`_trigram_candidates()`（`serve.py:499-548`）的关键不是索引本身，而是**放弃条件**：

| 条件 | 行为 | 理由 |
|---|---|---|
| 查询串不足 3 字符 | 返回 `None` → 全表扫 | 无法三元组化 |
| 某个 needle 的最稀有 trigram 仍出现在 > 10% 节点 | 返回 `None` → 全表扫 | 索引不划算 |
| 任一 trigram 全图不存在 | 该 needle 贡献零候选 | 必然无命中 |

注释把契约写死了（`serve.py:503-508`）：候选集是**超集**，调用方还要用精确谓词重打分；返回 `None` 时退回全扫，**"永不更差"**。这是"加一层近似索引"最安全的写法，我们可以直接照抄。

### 7.5 种子选择：分数断层 + 每词保底

`_pick_seeds()`（`serve.py:792-887`）默认 `max_k=3`、`gap_ratio=0.2`：

```
排序后从高到低取，一旦 score < top_score * 0.2 就停
```

动机（`serve.py:801-807`）：`FooBarService` 1000 分、`error` 节点 1 分，差距 99.9%，只该有前者做种子。

但这个策略有一个已知失效模式，注释写得很清楚（`serve.py:808-829`）：多词自然语言查询里，某个词偶然精确命中一个不相关节点（`_EXACT_MATCH_BONUS` 是 1000，子串只有 1.0），断层策略会把**其它词真正相关的子串命中全部丢掉**，BFS 只在一个不相关节点的邻域里打转（issue #1445）。补丁是「**每个不同查询词保底一个种子**」，且保底种子按各词最强匹配排序（`serve.py:874-878`）。

还有一层防污染（`serve.py:900-910`）：`_RELATIONAL_INTENT_TERMS` 把 `calls/uses/imports/extends/implements/references…` 这些"关系动词"从**保底种子**里摘掉——因为「谁调用了 X」里的 `calls` 是问的关系，不是要找的符号；否则它会前缀命中 `.callStoreWithAmount()` 之类的无关节点，占一个种子位（#2507）。但它**不**从排序里删，所以真有叫 `calls` 的标识符仍能靠分数赢到位置。

### 7.6 输出：预算内的文本 + 种子优先 + 显式截断

`_subgraph_to_text()`（`serve.py:1125-1313`）三件事：

1. **种子优先渲染**（`serve.py:1136-1164`）：先渲染 `seeds`，其余按「到种子的跳数 → 度数降序 → id」排序。注释点名这是 `#BUG2` 的修复——一次分支合并把 `seeds=` 参数弄丢了，"seed-first ordering" 变成死代码，问的符号被高扇出 hub 挤到预算之外。
2. **NODE 先、EDGE 后**（`serve.py:1165-1251`）：所以截断总是先丢边、不整块丢节点。
3. **超预算时的三分支**（`serve.py:1252-1313`）：
   - 全装得下 → 原样返回；
   - 所有 NODE 装得下、只有 EDGE 装不下 → **不截断**，返回完整结果 + 顶部"这已经是完整答案，加预算不会变小"；
   - NODE 都装不下 → 顶部 `[!] TRUNCATED` + 底部尾标记，并给出精确的 `--budget N` / `token_budget=N` 建议值。

第三条的第二种情况是本文件里最"反直觉但对"的决策：宁可变贵，也不给一个看起来像完整答案的残页。理由写在 `serve.py:1266-1279`：静默截断会被读成"图里没有"（#2601、#2784）。

### 7.7 遍历：为什么必须先转无向视图

`_traversal_view()`（`serve.py:1365-1413`）是一段值得逐字读的注释：`_load_graph` 为了保住 arc 顺序强制 `directed: True`，于是在 `DiGraph` 上 `G.neighbors()` **只给后继**。结果是一个"只被调用、自己没调过别人"的叶子函数，MCP 的 `query_graph` 只返回种子自己；而 CLI 的 `query` 用无向加载，能返回调用者、测试和相邻模块——**同一个图文件，两个入口给出不同答案**。

修法是：建一张无向副本专门用于遍历，每条边把真实方向存成 `_src/_tgt`；渲染时读标记还原。副本按图对象缓存（`G.graph["_traversal_view"]`），因为"下游只读，热重载会换掉整个 G"。这是一条通用教训：**「图的方向」与「遍历的无向性」是两个正交需求，不能靠一张图同时满足**。

### 7.8 三个查询面

| 面 | 入口 | 形态 | 证据 |
|---|---|---|---|
| CLI | `graphify query/path/explain` | 文本打到 stdout；**退出码即语义**：`0` 有答案、`3` 名字歧义、`4` 无匹配 | `cli.py:93-94`、`README.md:417` |
| MCP stdio | `serve()` | 10 个 tool：`query_graph`、`get_node`、`get_neighbors`、`get_community`、`god_nodes`、`graph_stats`、`shortest_path`、`list_prs`、`get_pr_impact`、`triage_prs` | `serve.py:2305-2441` |
| HTTP | `serve_http(graph_path, host, port, ...)` | 单文件 `serve.py:3008` 起 | `ARCHITECTURE.md:32` |

`query_graph` 的参数（`serve.py:2306-2326`）就是产品契约：`question`（必填）、`mode: bfs|dfs`、`depth: 1-6`（服务端再 `min(depth, 6)` 钳一次，`serve.py:2467`）、`token_budget`（默认 2000）、`context_filter: string[]`。**所有 tool 都额外注入一个可选的 `project_path`**（`serve.py:2446-2459`），一处注入而不是在 11 份 schema 里各写一遍——加 tool 时不会漏。

还有一个我没想到的小东西：`querylog.py`（80 行）把每次 `query/path/explain/MCP query_graph` 写成一行 JSONL 到 `~/.cache/graphify-queries.log`（时间、问题、语料、返回节点数、耗时），可用 `GRAPHIFY_QUERY_LOG_DISABLE=1` 关掉（`README.md:436`）。**没有这个日志，检索质量无法被评估**，只能靠感觉调权重。

### 7.9 名字歧义：拒绝回答，而不是猜

`_find_node_tiers()` / `_find_node()` / `_rivals_across_files()` / `_ambiguity_message()`（`serve.py:1634-1975`）构成一套分级解析：精确 id → 精确标签 → 路径限定 → 前缀 → 子串；同一级命中多个时**不猜**，而是把候选列出来并返回退出码 3（`cli.py:93`）。`_near_miss_message()`（`serve.py:1791`）在零命中时给出"最接近的 5 个"。

这条对我们的 `graph_symbol` 有直接对照价值：我们的两处实现都是「命不中返回 null / 空数组」（`src/tools.ts:294-313`、`src/host/McpServer.ts:217-242`），调用方无法区分"没有这个符号"和"名字有歧义，请选一个"。

---

## 八、图谱存储与增量更新

### 8.1 存储格式

单文件 `graph.json`，NetworkX node-link（`nodes` + `links` + `graph`），外加两个版本戳（`README.md:72-74`）：

| 键 | 作用 |
|---|---|
| `graph.schema_version` | 格式不兼容变更的探测器 |
| `graph.graphify_version` | 产出该图的 Graphify 版本 |
| 顶层 `built_at_commit` | 建图时的 git HEAD（`export.py` 的 `_git_head()`，`export.py:217-224`） |

`built_at_commit` 不只是溯源：MCP 的 `graph_stats` 会把它与**当前 HEAD** 对比，输出 `Built at commit: <sha> (matches HEAD)` 或警告已过期（`serve.py:2584-2606`）。注释指明动机——"An MCP client cannot stat graph.json, so this is its only staleness signal (#3354)"。**给不出文件 mtime 的消费者，需要一个显式的陈旧度字段。**

### 8.2 写入：原子 + 不缩水 + 无变化不写

| 机制 | 实现 | 证据 |
|---|---|---|
| 原子写 | `write_text_atomic` / `write_json_atomic` / `_atomic_replace` | `paths.py:156-286` |
| Windows 替换回退 | `os_replace_with_fallback`：`os.replace` 在 WinError 5/32/17 时回退为「临时文件 → 把 dst 改名备份 → 改名就位 → 失败则还原」 | `paths.py:84-140` |
| Windows 长路径 | `os_long_path`：超 260 字符加 `\\?\`／UNC 加 `\\?\UNC\` | `paths.py:56-81` |
| 内容未变不写 | `write_text_atomic_if_changed` | `paths.py:221` |
| 防缩水 | 新图节点数 < 旧图 → 拒绝写，除非 `force=True`；旧文件读不出来 → 也拒绝（fail-safe） | `export.py:292-336` |
| 缩水标记 | 重新抽取后语义节点变少的源文件 → `_unverified_semantic_shrink` | `build.py:2518-2544` |

`write_text_atomic_if_changed` 这一点容易被低估：它避免"内容没变但 mtime 变了"，而 mtime 变化会让 `watch` 误判、让下游缓存失效。

### 8.3 增量路径（四条）

| 手段 | 触发 | 机制 |
|---|---|---|
| 内容哈希 | 任意一次 `extract` | 未变文件直接用缓存结果（`cache.py:512`） |
| `--update` | 手动 | 只重抽变更文件；**但**跨文件消解仍需要"未变更语料"的只读上下文——`extract(resolution_context_nodes=…, resolution_context_edges=…)`（`extract.py:9520-9536`） |
| `watch` | 常驻 | `watch(watch_path, debounce=3.0)`（`ARCHITECTURE.md:33`） |
| git hook | commit / checkout | `graphify hook install`（`README.md:361`） |

`resolution_context_nodes` 那段 docstring（`extract.py:9520-9536`）说明了一个我们必须知道的坑：

> 增量重建时，若只用 `all_nodes`（本次抽的文件），**变更文件 → 未变更文件的直接调用会整条消失**；所以要把未变更语料的节点/边作为**只读索引上下文**注入，但绝不参与返回值（"They are never parsed, mutated, or returned"）。

我们的增量路径（`src/host/incrementalUpdate.ts`）是"按变更文件定向读 DB 行 + 与当前图切片 diff"，天然带着完整索引（DB 就是全量），所以**不需要**这个概念。但它的反面教训适用：如果哪天的增量改成"只喂变更文件"，跨文件边会静默消失。

### 8.4 我们的增量现状（对照）

| 能力 | graphify | 我们 | 判断 |
|---|---|---|---|
| 变更文件定向读 | 有 | 有：`readFilesFromDb`（`src/adapters/CodeGraphAdapter.ts:657-705`），两种分隔符都试、目录前缀匹配 | **已对齐** |
| delta 应用前校验 | — | 有：`canApplyGraphDelta` 校验修订漂移 + 悬空边（`src/shared/graphDelta.ts:72-90`） | **我们更强** |
| 应用时防缩水 | 有（`export.py:292-336`） | **无** | **缺口** |
| 内容指纹做快照幂等 | — | 有：`canonicalizeNode/Edge` + `hash64`（`src/shared/graphFingerprint.ts:84-110`） | **我们更强** |
| 解析器版本进缓存键 | 有（`cache.py:41`） | **无** | 缺口（P1-2） |
| 原子写 | 有（`paths.py:156-286`） | 未验证（快照走 SQLite 事务，见 `src/host/db/GraphRepository.ts:115-121`） | 需实测 |

---

## 九、技能形态：一个安装器喂 20+ 个 assistant

这部分是"工程化分发"的知识，不是算法，但对我们有参考价值。

| 维度 | 做法 | 证据 |
|---|---|---|
| 入口 | `graphify install` 自动探测当前 assistant 并注册技能 | `README.md:202` |
| 平台数 | 20+，每个都有 `graphify <platform> install` 别名 | `README.md:225-251` |
| 技能包结构 | `graphify/skills/<platform>/SKILL.md` + `references/*.md`（**按需加载的 sidecar**，不塞进主技能） | `graphify/skills/claude/references/` 下有 `query.md`、`update.md`、`exports.md`、`hooks.md`、`transcribe.md`、`add-watch.md`、`github-and-merge.md`、`extraction-spec.md` |
| 常驻指令 | `graphify/always_on/` 下 6 份模板（Claude/Gemini/AGENTS.md/VS Code/Kiro/Antigravity） | `graphify/always_on/` |
| 强制转向（"别 grep，先查图"） | 两类机制：**hook 平台**（Claude Code / Gemini CLI）在 Read/Glob/Grep 前触发 hook 提示；**指令文件平台**（Codex/Cursor/…）写常驻规则 | `README.md:304-311` |
| 项目级 vs 用户级 | `--project` 写进仓库（`.claude/skills/`、`.agents/skills/`），并打印 `git add` 提示 | `README.md:206-217` |
| 卸载 | `graphify uninstall`（`--purge` 连 `graphify-out/` 一起删） | `README.md:313` |
| 无反而不做的取舍 | README 明确写"bare `graphify install` 只装 Claude Code，要跨框架请显式用 `--platform agents`" | `README.md:254` |

`references/query.md:23-59` 是整个技能包里最有意思的一段：它承认检索是**词法匹配**，于是要求 agent 先导出图的**实际词表**（`.vocab.txt`），然后**只允许从这份词表里挑 ≤12 个 token** 来改写查询，并要求把选择结果打印出来以便审计。硬约束写得很硬：

> You MUST pick only tokens present in the vocabulary file. Do NOT invent tokens. … If **no** vocab tokens match the query at all, output an empty list and tell the user the corpus has no relevant vocabulary for this question. Do not fabricate a search.

**用流程纪律弥补检索能力的不足**——这条思路对我们特别合适，因为我们同样没有语义检索，而且我们面向的也是 LLM 调用方。

---

## 十、测试与性能

| 维度 | 事实 | 证据 |
|---|---|---|
| 测试规模 | 474 个测试文件 / 7,055 个测试函数 | `find tests -name '*.py' \| wc -l`、`grep -rh "^def test_"` |
| 组织方式 | 一个模块一个测试文件 | `ARCHITECTURE.md:114` |
| 隔离纪律 | 「测试套件设计为避免网络访问与不受控文件系统副作用；多数测试用临时目录与环境夹具隔离」 | `ARCHITECTURE.md:120` |
| 文档防漂移 | 架构文档里的每个符号被 `tests/test_architecture_doc.py` import | `ARCHITECTURE.md:15` |
| 性能手段 1 | `ProcessPoolExecutor` 绕 GIL；84 个代码文件并行比串行快约 1.66× | `docs/how-it-works.md:71-73` |
| 性能手段 2 | 打分从 `T+1` 遍全图遍历压成 1 遍；「在 10 万节点、3 个词的基准上，原实现 ~71% 的打分时间花在冗余的逐词 pass 上」 | `serve.py:1469-1475` |
| 性能手段 3 | trigram 预筛 + 放弃条件（§7.4） | `serve.py:499-548` |
| 性能手段 4 | 遍历视图/IDF/trigram 索引都缓存在 `G.graph` 上（换图即失效） | `serve.py:390`、`:482`、`:1404` |
| 基准口径 | LOCOMO(n=300) recall@10 = 0.497、QA 45.3%；LongMemEval-S 76%；建图 LLM 成本 0 | `README.md:132-140`、`BENCHMARKS.md:24-33` |
| 基准可信度声明 | 同一 harness、同一模型、同一预算，judge 与第二个独立 judge 盲校验（90.6% 一致、Cohen's κ 0.81） | `BENCHMARKS.md:33-38` |

需要保持清醒的一点：上述基准里 `recall@10 0.497`、`QA 45.3%` 都是**它自己 harness 上的自评**。拿它当"绝对水平"不成立，但当"同 harness 内相对强于 BM25/mem0"是成立的（`BENCHMARKS.md:24-31` 里 BM25 的 recall@10 是 0.362）。我在 §14 会再标注一次这个边界。

---

## 十一、对照本项目：三分分类

先把我方现状钉住（都是实际读到的）：

| 我方对象 | 现状 | 证据 |
|---|---|---|
| 边类型 | 9 个枚举值：`call/import/extend/implement/dependency/contains/association/aggregation/composition` | `src/types/index.ts:64` |
| 边附加信息 | `properties: Record<string, unknown>`，**唯一的自由扩展位** | `src/types/index.ts:67` |
| codegraph 边行 | `{id, source, target, kind, line: number\|null}`，**没有 confidence 列** | `src/adapters/CodeGraphAdapter.ts:97-103` |
| 边映射 | `mapRowsToGraphEdges` 只写 `line` 与 `__source` | `src/adapters/CodeGraphAdapter.ts:282-292` |
| kind 压平 | 上游 `calls→call`、`imports→import`、`extends→extend`、`implements→implement`、`depends→dependency`，未知一律 `dependency` | `src/adapters/CodeGraphAdapter.ts:155-167`、`:301-303` |
| 边丢弃 | 端点缺失 / 自环 / `uses_var`、`func_imports_local` 被丢 | `src/adapters/CodeGraphAdapter.ts:169-172`、`:258-263` |
| 多源合并 | `merge()` 按 `edge.id` 去重，**后写覆盖**（含 properties 展开） | `src/merger/GraphDataMerger.ts:26-41` |
| delta 应用 | `applyDelta` 同样后写覆盖 | `src/merger/GraphDataMerger.ts:69-108` |
| delta 校验 | `canApplyGraphDelta`：修订漂移 + 悬空边，**无缩水判定** | `src/shared/graphDelta.ts:72-90` |
| 置信度先例 | 死代码分析有 `confidence: 'confirmed' \| 'suspected'` + `reason`，但那是**分析结论**不是边属性 | `src/shared/analysis/DeadCodeAnalyzer.ts:5-19`、`:100-116` |
| 工具面 A（DSH tools） | 10 个：`graph_status/data/symbol/impact/path_find/path_enumerate/cycles/health/rules_check/focus` | `src/tools.ts:247-618` |
| 工具面 B（独立 MCP） | **另一套 4 个**：`graph_status/data/symbol/impact`，其中 `graph_symbol` 是纯子串扫描 | `src/host/McpServer.ts:183-269`、`:217-242` |
| 工具注册 | `src/index.ts` 用**固定解构列表**逐个 `ctx.tools.register`——新增 tool 必须同时改这里 | `src/index.ts:50-62` |
| 检索原语 | `parseSearchQuery`/`matchSearchQuery`/`fuzzyMatch`/`fuzzyScore`（纯子串/模糊，无 IDF、无 `_` 分隔语义） | `src/shared/searchUtils.ts:7-62` |
| token 预算 | **不存在**（全仓 `grep tokenBudget\|token_budget\|charBudget` = 0 命中） | — |
| 边归因 | **不存在**（`grep EXTRACTED\|INFERRED` 仅命中死代码面板与 i18n） | — |
| 截断标记 | `/data` 超 `API.DATA_RESPONSE_MAX_BYTES` → `slimGraphData` + `x-truncated: 1` | `src/host/routes/dataRoutes.ts:78-86` |
| 快照持久化 | SQLite 四张表；`saveSnapshot` 无"变小"检查 | `src/host/db/GraphRepository.ts:71-74`、`:115-121` |
| 图指纹 | `canonicalizeNode/Edge` + 双通道 FNV64 | `src/shared/graphFingerprint.ts:84-110` |
| 解析器 | `web-tree-sitter@0.27` + `tree-sitter-wasm`（WASM，不是 Python 原生绑定） | `package.json` dependencies |
| 社区检测 | 已有 `graphology-communities-louvain` + `src/client/store/cluster/` | `package.json`、`src/client/store/cluster/` |

### 11.1 可直接借鉴（结构对得上、无新依赖、不违反我们的类型纪律）

| # | graphify 能力 | 我方落点 | 为什么"直接" |
|---|---|---|---|
| D1 | 边归因字段进 `properties` | `src/adapters/CodeGraphAdapter.ts:282-292` | `properties` 已是 `Record<string, unknown>`，**不需要改 `GraphEdge` 接口** |
| D2 | 冲突消解的分层优先级（方向→具体关系→置信度→有位置→分数） | `src/merger/GraphDataMerger.ts:26-41` | 现在的"后写覆盖"换成一张 rank 表即可，纯函数、可测 |
| D3 | 写入侧防缩水 | `src/shared/graphDelta.ts:72-90` + `:38-57` | `canApplyGraphDelta` 已存在，加一条判定即可；调用点唯一（`src/client/store/slices/graphDataSlice.ts:246`） |
| D4 | 截断"给出精确下一步" | `src/host/routes/dataRoutes.ts:78-86` | 已有 `x-truncated` 标记，补一个 `x-truncated-hint` 头即可 |
| D5 | 文档表被测试 import | `docs/research/*.md` 与本仓库 `CLAUDE.md` | 纯测试工程，无依赖 |
| D6 | 查询日志（JSONL） | 新增 `src/shared/querylog.ts`，在 `src/tools.ts` 的 execute 里调用 | 无依赖，`node:fs` 追加写即可 |
| D7 | `_` 与 `-` 等价的分词 | `src/shared/searchUtils.ts:7-36` | 纯函数改动，向后兼容（需补用例） |

### 11.2 需改造借鉴（思想对、形态必须换）

| # | graphify 能力 | 障碍 | 改造方向 |
|---|---|---|---|
| M1 | "图查询 → token 预算文本" | 我们输出全是 JSON；且没有 `query` 这个工具 | 新建**纯函数** `renderSubgraphText()`，工具层只做 IO；中文的 token 估算不能照抄 `len/3`（见 P0-2 风险栏） |
| M2 | trigram 倒排 + "永不更差"降级 | 我们的图规模与生命周期不同（浏览器侧有 `Trie`，host 侧无索引） | 先只做 host 侧一次性倒排，挂在图的指纹上做失效；放弃条件比索引本身更重要 |
| M3 | 每词保底种子 + 关系动词降级 | 我们没有"问题句"入口，只有符号查找 | 只在 M1 的新工具内部需要，不影响既有工具 |
| M4 | per-file AST 缓存 + schema v29 | 我们走 `web-tree-sitter`，文件级缓存不在 adapter 里 | 可在 `TreeSitterAdapter` 上挂 LRU（按 `computeContentHash` 键），并把解析器/语法版本拼进键 |
| M5 | 原子写 + Windows 长路径/替换回退 | 我们的快照在 SQLite 里，但导出/预设有文件写入 | 抽成 `src/shared/atomicWrite.ts`，只在真有文件写入的路径用 |
| M6 | 名字歧义拒绝 + 近似候选 | 我们两个 MCP 面各有一套 `graph_symbol` | 先把"歧义 vs 未找到"分成两种返回（`errorCode`），再谈近似 |
| M7 | 社区标注（LLM-free 的 hub 命名） | 我们已有 Louvain，没有命名 | `label_communities_by_hub()` 是纯图算法，可移植（且不花钱） |

### 11.3 不适用（写清为什么）

| graphify 能力 | 为什么对我们不适用 |
|---|---|
| Python 3.10+ / `uv` / `pipx` 分发 | 我们是 ESM+TS 的 DSH 插件，`package.json:33` 约束 `node>=22.19`；运行环境是 Host 进程，不是独立 CLI |
| 原生 tree-sitter 绑定 + 40 语言语法包 | 我们用 `web-tree-sitter`（WASM）；每加一门语言的成本结构不同（WASM 包体积 vs Python wheel） |
| Pass 3 语义抽取（LLM 抽文档） | 我们的定位是"可视化 + 结构分析"，不承担建图成本；引入 LLM 抽取会改变插件的成本模型 |
| MCP stdio server 作为主入口 | 我们已有 `src/host/McpServer.ts`，但主入口是 DSH 的 `ctx.tools.register` |
| `graph.html` 自包含可视化 | 我们本来就有 Cytoscape 渲染层（`IRenderer` 抽象），这是我们的强项，不是要抄的 |
| CLI 退出码语义（3/4） | 我们没有 CLI 消费者；对应能力应落在工具返回的 `errorCode` 上 |
| `merge-graphs` 跨仓合并 | 我们有 `RepoId` 品牌类型与多源合并，但跨仓语义需要先确定产品需求 |
| hyperedges（3+ 节点关系） | 我们没有对应的可视化与查询消费者；加了就是死数据 |

---

## 十二、借鉴清单

分级口径：**P0 = 现有架构内可落地、且解决真实缺口**；**P1 = 价值明确但需要新建模块或引入新维度**；**P2 = 方向对但当前无消费者，先记录**。

### P0-1　边来源归因 + 合并顺序无关

| 项 | 内容 |
|---|---|
| **落点文件** | `src/adapters/CodeGraphAdapter.ts`（`mapRowsToGraphEdges`，:252-294）<br>`src/merger/GraphDataMerger.ts`（`merge`，:6-66；`applyDelta`，:69-108）<br>新增 `src/shared/edgeAttribution.ts`（归因常量表 + 强度排序，唯一真源） |
| **改动要点** | ① 在 `mapRowsToGraphEdges` 的 `properties` 里加三键：`edgeOrigin: 'ast' \| 'index' \| 'manifest' \| 'heuristic'`、`edgeLocatable: e.line !== null`、`rawKind: e.kind`（保留被 `EDGE_KIND_MAP` 压平前的上游 kind）。<br>② `TreeSitterAdapter` 造的 `contains` 边（`src/adapters/TreeSitterAdapter.ts:426-433`）写 `edgeOrigin: 'ast'`——这是**唯一无歧义**的 `EXTRACTED` 等价物。<br>③ `GraphDataMerger.merge/applyDelta`：同 `edge.id` 冲突时不再 `{...existing, ...edge}`，改为按 `EDGE_ORIGIN_RANK`（`ast 3 > index 2 > manifest 2 > heuristic 1`）→ `edgeLocatable` → 保留先到者，**合并结果与 adapter 入参顺序无关**。<br>④ 显式**不写** `confidence: 'EXTRACTED'\|'INFERRED'`：上游无此列，贴了就是编造（§6.5）。 |
| **验收方式** | ① 单测：每种 `kind` 走 `mapRowsToGraphEdges`，断言 `edgeOrigin`/`edgeLocatable`/`rawKind`（`line: null` 用例必须存在）。<br>② **顺序无关性**：两个 `AdapterResult` 含同一 `edge.id`，`[A,B]` 与 `[B,A]` 两种顺序 merge 后 `toEqual` 同一结果（现在的实现两种顺序结果不同——这就是要修的缺陷）。<br>③ 反向用例：`edgeLocatable: false` 的边**不得**被 rank 提升。<br>④ 全体用例里 `edgeLocatable` 不能只有 `true` 一种取值（CLAUDE.md：「default empty set hides defects」的同族）。 |
| **风险** | ① `properties` 参与 `graphFingerprint` 哈希（`src/shared/graphFingerprint.ts:99-110`），加键会让**所有已有快照指纹变化** → 必须同步 `FINGERPRINT.VERSION`，否则旧快照永不命中或错误命中。<br>② 归因取值必须是可证明的（四个 adapter 产物互斥），一旦为了"看起来更智能"而给未知来源贴默认值，归因立刻退化为噪声。<br>③ `rawKind` 可能与 `type` 不一致（如 `uses_var` 被过滤），消费者要以 `type` 为准。 |
| **预估改动面** | src ≈ 120 行（含新常量表 ~30 行）+ 测试 ≈ 150 行；触及 3 个 src 文件 + 1 个新文件 |

### P0-2　`graph_query`：关键词 → 种子 → 子图 → 预算内文本

| 项 | 内容 |
|---|---|
| **落点文件** | 新增 `src/shared/queryText.ts`（**纯函数**，无 IO、无 React、无 cordis，可被 host 与 client 同时 typecheck）<br>`src/tools.ts`（新增 `graphQuery` 工具定义，并在 `src/index.ts:50-62` 的解构列表里注册）<br>可选镜像：`src/host/McpServer.ts:183-269` |
| **改动要点** | ① `selectSeeds(nodes, terms, {maxK: 3, gapRatio: 0.2})`：分级加分（精确 1000 / 前缀 100 / 子串 1 / 路径 0.5，照 `serve.py:339-351`）+ 断层截断（`serve.py:848-860`）+ **每词保底一个种子**（`serve.py:862-887`）——保底这一条必须抄，否则多词查询会被单个精确命中劫持（#1445 的现场）。<br>② `renderSubgraphText(skeleton, seeds, {depth, mode, tokenBudget})`：种子优先渲染 → 其余按「跳数 → 度数降序 → id」→ NODE 先 EDGE 后 → **超预算的三分支**（装得下 / 只有边装不下返回完整+over-budget 告示 / 节点也装不下则顶部 `[!] TRUNCATED` + 精确的下一步预算值），照 `serve.py:1252-1313`。<br>③ **中文 token 估算不能抄 `len/3`**：graphify 的 `/3` 是按英文校准的（`serve.py:1131`、`:1285`）。中文一字约 1 token，照抄会让中文输出被**少算 2-3 倍**，截断永不触发。改为 `estimateTokens(s) = ceil(cjkCount * 1 + otherCount / 3.5)`，并以纯函数单测钉住。<br>④ 渲染前对每个 label/属性值做控制字符清洗（对应 graphify `sanitize_label`，`ARCHITECTURE.md:102`）——LLM 上下文注入是真实风险。 |
| **验收方式** | ① 纯函数单测：三分支各一例，其中"所有节点装得下、只有边超预算"必须返回**完整结果**且带 over-budget 告示（这是最容易做错的一支）。<br>② 种子优先：给一个高度数 hub 与一个低度数种子，预算极小，断言**种子仍在输出里**、hub 被截断。<br>③ 截断告示里的 `token_budget=N` 必须**真的够**：用同一个估算函数验证 `estimateTokens(full) <= N`（否则告示在骗人，这是 graphify 自己踩过的 `#2784`）。<br>④ 每词保底：两词查询，一词精确命中无关节点、一词子串命中相关节点，断言两个种子都在。<br>⑤ **注册闭环**：断言 `createGraphTools()` 返回的键集合 == `src/index.ts` 实际注册的集合（CLAUDE.md 记过"工厂返回 tool 不等于注册 tool"）。 |
| **风险** | ① 两套 MCP 面（`src/tools.ts` 与 `src/host/McpServer.ts`）会漂移——只改一处等于另一处永远查不到（本仓库已有同类教训）。<br>② 预算估算永远是近似，错误的估算方向决定用户是"多花 token"还是"少看内容"；应偏向**高估**（宁可早截断，也别让调用方以为看全了）。<br>③ 若 `selectSeeds` 用了全图扫描，大图（万级节点）会有明显延迟——需先测，或先复用 `canonicalizeEdge` 那种"挂在图对象上"的缓存策略。 |
| **预估改动面** | 新文件 ≈ 260 行 + `tools.ts` ≈ 60 行 + `index.ts` ≈ 2 行 + 测试 ≈ 220 行 |

### P0-3　图写入防缩水守卫

| 项 | 内容 |
|---|---|
| **落点文件** | `src/shared/graphDelta.ts`（`canApplyGraphDelta`，:72-90）<br>`src/client/store/slices/graphDataSlice.ts:246`（唯一 delta 应用点）<br>`src/host/routes/shared.ts:585`（`saveSnapshot` 调用点） |
| **改动要点** | ① `canApplyGraphDelta` 增加"结果规模不得断崖"判定：`nextNodes < currentNodes * SHRINK_FLOOR`（建议 `0.5`，落在 `INCREMENTAL` 常量表里，不写字面量）→ 返回 `false`，让调用方落回全量重新取数（这正是该函数既有的语义：`false` ⇒ 走全量）。<br>② 拒绝原因必须**可观测**：返回结构化 `{ ok: false, reason: 'shrink-guard', before, after }` 或至少 `log.warn`，否则用户只看到"没更新"。<br>③ `saveSnapshot`（host 侧）在写入前读最近一条快照的 `node_count`，跨过同一阈值时**跳过写 + 打日志**，并保留 `pruneSnapshots` 的既有行为。 |
| **验收方式** | ① 删除 90% 节点的 delta → `canApplyGraphDelta` 为 `false`。<br>② 正常小改（删 3 个节点 / 改 5 条边）→ 仍为 `true`（**必须有这个用例**，否则守卫退化成"永远拒绝"）。<br>③ 空 delta → `true`（`isEmptyGraphDelta` 已有，:17）。<br>④ 阈值边界：`next == floor * current` 必须有一个确定性断言（`>` 与 `>=` 差一条边，两种写法都"看起来合理"）。<br>⑤ 守卫触发后必须**落回全量**而不是静默保留旧图——断言最终 `nodes.length` 等于全量值。 |
| **风险** | ① 阈值是新的魔数，误报会挡住合法的"删掉一个大模块"的重构；必须有显式绕过通道（参数或配置）并记录。<br>② host 与 client 两处守卫的阈值必须是**同一常量**，否则一处拦一处放，问题只是被推迟。<br>③ 这条守卫只防"断崖"，不防"渐进缩水"（每次掉 40% 连掉三次）；要诚实写清边界，不能让读者以为覆盖率 100%。 |
| **预估改动面** | src ≈ 70 行 + 测试 ≈ 90 行 |

### P1（价值明确，但需新建模块或引入新维度）

| # | 借鉴项 | 落点 | 要点 | 验收 | 风险 |
|---|---|---|---|---|---|
| P1-1 | **归因/健康体检**：`graph_stats` 式的占比报告 + 陈旧度 | `src/tools.ts` 新工具；`src/shared/analysis/` 新函数 | 输出「边来源分布」「可定位边占比」「快照指纹 vs 当前索引 mtime/commit」。照 `serve.py:2571-2582` 与 `serve.py:2584-2606` | 三条计数必须**自洽**（各来源之和 == 总边数）；陈旧度在"无 git / 无快照"两种缺失下必须降级而不是抛错 | 计数口径必须写明"在哪一步之后统计"，否则和 UI 上的数字对不上（CLAUDE.md 有同类教训：三个数来自不同集合） |
| P1-2 | **解析器版本进缓存键 + per-file AST 缓存** | `src/adapters/TreeSitterAdapter.ts`，新增 `src/shared/parserCache.ts` | 缓存键 = `computeContentHash(content) + web-tree-sitter 版本 + 语法包版本 + 抽取器 schema 版本`；照 `cache.py:41`/`:49`/`:1040` | 升级 `web-tree-sitter` 后必须 100% miss（可用假版本号单测）；同内容两次解析必须 100% hit | 缓存是"错的答案乘 N 倍"；版本号拼错一位就等于永不失效 |
| P1-3 | **检索词法层**：`_`/`-` 等价 + 停用词 + 分级加分 | `src/shared/searchUtils.ts` | 分词改 `[^\W_]+`（`serve.py:222-233`）；停用词表收英/中（不自造外语表，除非有真实用例）；`fuzzyScore` 之上叠前缀/精确两档 | 现有 `fuzzyMatch/fuzzyScore` 用例**全部保持绿**（向后兼容是本项前提）；新增 `graph_first_guard` 能被 `graph-first-guard` 命中的用例 | 停用词误伤真实符号（如 `work`/`get`）——graphify 的做法是"只过滤查询侧，从不过滤节点侧"（`serve.py:262-264`），必须照抄这个方向 |
| P1-4 | **原子写 + Windows 路径回退** | 新增 `src/shared/atomicWrite.ts` | 临时文件 → rename → 失败备份还原；超 260 字符加 `\\?\`；内容未变不写（`paths.py:56-140`、`:221`） | 用真实临时目录测三种情形：正常替换、目标被占用、路径超长；"内容未变"必须**不改 mtime** | 我们是 Windows 主场，这段的每条分支都有真实触发场景，但也最难在 CI（Linux）里复现——需要在 Windows 上单独跑一次 |
| P1-5 | **歧义拒绝 + 近似候选** | `src/tools.ts:294-313`、`src/host/McpServer.ts:217-242` | 命中多个同分候选时返回 `{ errorCode: 'AMBIGUOUS', candidates: [...] }`；零命中时返回最近 5 个（`serve.py:1791-1820`） | 两个 MCP 面的返回形状必须**同构**（否则调用方要写两套解析）；`AMBIGUOUS` 与 `NOT_FOUND` 必须有各自的用例 | 现有调用方可能依赖"命中即返回第一个"，改成歧义即拒绝是**行为破坏性变更**，需要版本位或配置开关 |
| P1-6 | **查询日志** | 新增 `src/shared/querylog.ts`，在工具 execute 里调用 | JSONL：时间/问题/命中数/耗时/是否截断；默认写 `.cycles/` 或系统缓存目录，可用环境变量关闭（`README.md:436` 的形态） | 日志行必须可被 JSON.parse（避免多行/非法字符）；关闭开关必须真的不落盘 | 隐私：日志里会有用户的问题原文。graphify 的做法是"默认只记元数据不记完整子图"，我们应更保守（可只记 hash + 计数） |
| P1-7 | **社区 hub 命名** | `src/client/store/cluster/` | `label_communities_by_hub()` 是纯图算法：用成员中度数最高的节点标签命名社区（`cluster.py:185`） | 同一张图两次运行给出一致的社区名（确定性排序是硬要求） | 我们已有 Louvain 但社区编号本身可能不稳定；命名前必须先有"社区编号跨次稳定"的保证（graphify 用 `remap_communities_to_previous()`，`cluster.py:434`） |

### P2（方向对，当前无消费者，先记录）

| # | 项 | 为什么先不做 |
|---|---|---|
| P2-1 | MinHash/LSH 实体去重（`dedup.py`） | 我们只按 `edge.id`/`node.id` 去重；跨源"同实体不同 id"目前没有真实样本可验证，先有样本再上算法 |
| P2-2 | hyperedges（3+ 节点） | 无渲染、无查询、无编辑器；加了就是死数据 |
| P2-3 | wiki 导出（`wiki.py`） | 我们的交付形态是画布与工具，wiki 是另一条产品线 |
| P2-4 | `.graphifyignore` 等价物 | 我们有 `NOISE_PATH_SEGMENTS`（`src/adapters/CodeGraphAdapter.ts:174-185`）与 `.gitignore`，缺的是"按项目声明"，需求未确认 |
| P2-5 | 跨仓 `merge-graphs` | 需要先定跨仓的节点身份规则，否则合并即污染 |
| P2-6 | 多语言语法包矩阵 | 我们走 WASM，加语言=加包体积；应由真实用户需求驱动 |

---

## 十三、不适用清单（汇总，含理由）

1. **Python 工具链**：`requires-python = ">=3.10"`（`pyproject.toml:12`）、`uv`/`pipx` 分发（`README.md:50-55`）。我们是 `"type": "module"` + `node>=22.19` 的 DSH 插件（`package.json:7`、`:24`）。**不能共用任何运行时代码**，只能借鉴设计。
2. **原生 tree-sitter 绑定**：graphify 依赖 `tree-sitter>=0.25` 与 25+ 个 `tree-sitter-<lang>` Python wheel（`pyproject.toml:28-53`）；我们用 `web-tree-sitter@0.27` + `tree-sitter-wasm`（`package.json` dependencies）。语言扩展的成本模型完全不同。
3. **三 Pass 中的 Pass 3（LLM 语义抽取）**：`docs/how-it-works.md:15-16`。我们不做建图成本承担方，引入它会改变插件的成本与隐私模型。
4. **LLM 后端矩阵**（Gemini/Kimi/Claude/OpenAI/DeepSeek/Azure/Bedrock/Ollama，`README.md:433-434`）：我们没有 LLM 调用面。
5. **`graph.html` 自包含导出**：我们已有 Cytoscape + `IRenderer` 抽象 + 完整前端，这是我们的强项。
6. **20+ assistant 的安装器**（`install.py` 2,826 行）：我们只有一个宿主（DSH），`ctx.tools.register` + `ctx.slots.inject` 就是分发机制。
7. **hook 平台差异处理**（`README.md:304-311`）：DSH 没有 `PreToolUse` 这类钩子；对应能力是工具描述与技能文案。
8. **CLI 退出码**（`cli.py:93-94`）：无 CLI 消费者。
9. **`_minhash.py` 那类"绕开 datasketch"的实现**：那是 Python 生态特有的依赖链问题（`_minhash.py:1-12` 记录了 scipy→cmd.exe 在 EDR 下卡死），与 JS 生态无关。
10. **Leiden 算法本体**：我们已有 `graphology-communities-louvain`；抄 Leiden 属于换轮子，不解决任何现有问题（要抄的是"社区命名"与"编号稳定"，见 P1-7）。

---

## 十四、诚实披露

### 14.1 我确实读到的（可复核）

| 类别 | 具体 |
|---|---|
| 全文读完 | `README.md`（516 行）、`ARCHITECTURE.md`（149 行）、`docs/how-it-works.md`（101 行）、`BENCHMARKS.md` 前 40 行 |
| 精读的代码段 | `serve.py` 的 1-130、200-660、792-961、1125-1544、2290-2489 行；`build.py` 的 180-224、1840-1968、2490-2619 行；`extract.py` 的 4770-4899、9489-9638 行；`export.py` 的 185-224、287-347 行；`cache.py` 的 1-60 行区段与函数签名；`paths.py` 的 56-140 行；`validate.py` 的 1-80 行；`cluster.py`/`analyze.py`/`dedup.py`/`_minhash.py` 的函数签名与文件头；`graphify/skills/claude/references/query.md` 前 80 行；`graphify/skill.md` 前 60 行 |
| 用工具生成的统计 | 文件数/扩展名分布、`wc -l` 全量、`def test_` 计数、`context` 取值分布、`relation` 取值分布、`confidence_score` 取值分布、对 `worked/httpx/graph.json` 的节点/边/键统计（Python 直读） |
| 我方文件 | `src/types/index.ts` 全读；`src/adapters/CodeGraphAdapter.ts` 1-200、200-380、560-778 行；`src/merger/GraphDataMerger.ts` 全读；`src/shared/graphFingerprint.ts` 1-190 行；`src/shared/graphDelta.ts` 全读；`src/shared/analysis/DeadCodeAnalyzer.ts` 1-180 行；`src/tools.ts` 240-400、496-565 行；`src/host/McpServer.ts` 180-279 行；`src/host/routes.ts` 全读；`src/host/routes/dataRoutes.ts` 40-150 行；`src/host/incrementalUpdate.ts` 55-120 行；`src/host/db/GraphRepository.ts` 表结构与方法签名；`src/adapters/TreeSitterAdapter.ts` 395-470 行；`package.json` 全读 |

### 14.2 只读了文档/注释、未逐行验证实现的部分

| 结论 | 依赖的文档 | 未验证点 |
|---|---|---|
| Leiden/Louvain 的具体回退路径 | `README.md:380` | 未读 `cluster.py:106 _partition()` 全文 |
| `--batch-size` / `.graphify_labels.json.sig` 的标签持久化 | `README.md:376-380` | 未读 `label_communities_by_hub` 与签名校验实现 |
| `dedup.py` 的六级管道 | `dedup.py:1-5` 文件头 | 未读中间阶段实现，**未验证各级实际触发率** |
| `report.py` 报告结构 | `ARCHITECTURE.md:24` | 未读 `report.py` |
| PR 相关 tool（`list_prs`/`get_pr_impact`/`triage_prs`） | `serve.py:2395-2440` 的 schema | 未读 `prs.py`，无法判断数据来源与降级行为 |
| `watch` 的 debounce 与"防缩水"检查 | `ARCHITECTURE.md:33` | 未读 `watch.py`，`_check_shrink` 只从 `build.py` 注释间接得知 |
| HTTP 服务面 | `ARCHITECTURE.md:32` | 未读 `serve.py:3008` 起的 `serve_http` 实现 |

### 14.3 未验证的推断（明确标注为推断）

1. **依赖注入的"否定证据"**：我说"我们不需要 `resolution_context_nodes`"，依据是我们的增量是先读 DB（全量索引）再 diff（`src/adapters/CodeGraphAdapter.ts:657-705`）。这是**读代码得出的推断**，我没有实际跑一次增量重建来确认跨文件边不丢。
2. **`graph_delta` 缩水风险的实际发生概率**：我判定"缺缩水守卫是真实缺口"，依据是 `canApplyGraphDelta` 的判定项里确实没有规模维度（`src/shared/graphDelta.ts:72-90`）。但我**没有**构造出一个真实会触发的场景，因此 P0-3 的严重性是设计判断，不是事故复盘。
3. **中文 token 估算误差量级**：我说 `len/3` 会让中文少算 2-3 倍，这是基于"中文 1 字≈1 token、英文 3-4 字符≈1 token"的常识推算，**没有用本项目的真实 tokenizer 实测**。落地前必须用宿主模型的分词器标定。
4. **`properties` 加键会让旧快照指纹全部变化**：依据是 `canonicalizeEdge` 把 `stableStringify(edge.properties)` 纳入哈希（`src/shared/graphFingerprint.ts:108`）。逻辑上必然成立，但我**没有**跑一次旧快照读回来对比。
5. **基准数字的独立性**：`BENCHMARKS.md` 的所有数字都由 graphify 自己的 harness 产出（`BENCHMARKS.md:33-38` 自述"graphify's own harness"）。同 harness 内的相对比较有意义，跨 harness 的绝对水平**不可信**。
6. **`context` 的 13 种取值是"全部"**：我是用 `grep -oP '"context":\s*"\K[^"]+'` 在 `graphify/` 下统计的，若有取值是运行时拼出来的（如 `f"{a}_{b}"`），会漏统计。我看到的取值里没有明显的拼接形态，但**没有逐一回溯每个赋值点**。
7. **"文档表被测试 import"的效果**：我信了 `ARCHITECTURE.md:15` 的自述，**没有打开 `tests/test_architecture_doc.py` 确认它到底 import 了哪些符号**。这条结论的强度只到"作者如此声明，且该测试文件确实存在于 `tests/` 列表"。

### 14.4 对任务前提的两点修正

1. 任务描述里写"克隆失败则回退 web_fetch"。实际**克隆成功**（398 MB 左右的工作树，1,118 个文件），不需要回退路径。
2. 任务要求判定"是否是空壳/营销仓库"。结论是**不是**（§1 有六项核验）。但**需要注意它的商业色彩**：README 顶部与中段各有一段 Graphify Cloud 的推广（`README.md:31`、`:41`、`:125-126`、`:462-473`），开源部分是 Cloud 的上游。这不影响代码质量判断，但意味着**"社区版能力"和"云版能力"是两个集合**——例如"formal verification""Sentry/Jira connectors""monorepo/cross-repo 持续更新"只在 Cloud（`README.md:468-471`），开源仓库里没有对应模块（我 `git ls-files` 没找到 sentry/jira 相关文件）。这一点在评估"抄它能不能拿到这些能力"时很重要：**拿不到**。

---

## 十五、附录：关键证据索引

供复核用。左侧是我在正文里的论断，右侧是可点到的最小证据。

| 论断 | 证据（相对路径:行号） |
|---|---|
| 三 Pass 划分与"代码不送 LLM" | `docs/how-it-works.md:5-22` |
| 主链路 `detect→extract→build→cluster→analyze→report→export` | `ARCHITECTURE.md:8-11` |
| `extract()` 是两遍扫描 | `extract.py:9499-9504` |
| 跨文件消解 → INFERRED 边 + 位置 + 分数 | `extract.py:4847-4861` |
| import 证据把 INFERRED 提为 EXTRACTED | `extract.py:10688-10690` |
| 置信度三值与 score 梯度 | `docs/how-it-works.md:34-50`、`export.py:189-197` |
| `confidence` 是边必填字段 | `validate.py:5-6`、`ARCHITECTURE.md:64-67` |
| 真实图产物：330/330 边带 confidence + source_location | `worked/httpx/graph.json`（直读统计） |
| 冲突消解七层裁决 | `build.py:1860-1924` |
| `_CONFIDENCE_RANK = {EXTRACTED:3, INFERRED:2, AMBIGUOUS:1}` | `build.py:191` |
| 用错归因策略会整批改写 144 个节点对 | `build.py:1887-1897` |
| 无向存储 + `_src/_tgt` 保方向 | `ARCHITECTURE.md:73-77`、`paths.py:574`、`:593` |
| 分词把 `_` 当分隔符（含 bug 复盘） | `serve.py:222-233` |
| 多语种停用词与取舍说明 | `serve.py:258-314` |
| 四档加分 + rationale/attribute 档 | `serve.py:339-351` |
| IDF 缓存挂图对象上 | `serve.py:382-404` |
| trigram 预筛的"永不更差"放弃条件 | `serve.py:499-548` |
| 种子断层 `gap_ratio=0.2` 与每词保底 | `serve.py:792-887` |
| 关系动词不占保底种子位 | `serve.py:900-910` |
| `context` → 查询过滤维度 | `serve.py:913-958` |
| 预算文本 + 种子优先 + 三分支截断 | `serve.py:1125-1313` |
| "所有节点装得下就说这已完整" | `serve.py:1280-1294` |
| 遍历必须转无向视图（含两个入口答案不一致的复盘） | `serve.py:1365-1413` |
| 查询主流程与单遍打分优化（省 71% 时间） | `serve.py:1418-1493`、`:1469-1475` |
| 10 个 MCP tool 与 `project_path` 统一注入 | `serve.py:2305-2460` |
| `graph_stats` 的归因占比 | `serve.py:2571-2582` |
| `built_at_commit` 作为陈旧度信号 | `serve.py:2584-2606` |
| 名字歧义拒绝 + 近似候选 | `cli.py:93-94`、`serve.py:1791-1820` |
| 原子写 / Windows 替换回退 / 长路径 | `paths.py:56-140`、`:156-286`、`:221` |
| 拒绝用更小的图覆盖（防缩水） | `export.py:292-336` |
| 语义缩水标记 | `build.py:2518-2544` |
| AST 缓存 schema v29 与其解释 | `cache.py:41`、`:49`、`:1040` |
| 内容哈希增量 | `cache.py:512`、`docs/how-it-works.md:77-79` |
| 40 语言扩展名清单（单一真源） | `detect.py:48` |
| 并行抽取 1.66× | `docs/how-it-works.md:71-73` |
| 架构文档符号被测试 import | `ARCHITECTURE.md:15` |
| 查询日志 JSONL | `README.md:436`、`querylog.py` |
| 技能包 + sidecar references 结构 | `graphify/skills/claude/references/*.md`、`README.md:206-217` |
| "只许用图里存在的 token 扩展" | `graphify/skills/claude/references/query.md:23-59` |
| 许可证 Apache-2.0（含 MIT 遗产） | `pyproject.toml:13`、`LICENSE:2`、`NOTICE:1-8` |
| Cloud 能力不在开源仓 | `README.md:462-473`（对照 `git ls-files` 无 sentry/jira 模块） |

我方证据索引：

| 论断 | 证据 |
|---|---|
| `GraphEdge.properties` 是唯一自由扩展位 | `src/types/index.ts:60-68` |
| codegraph 边行无 confidence 列 | `src/adapters/CodeGraphAdapter.ts:97-103` |
| 边映射只写 line + `__source` | `src/adapters/CodeGraphAdapter.ts:282-292` |
| 上游 kind 被压平成 9 类 | `src/adapters/CodeGraphAdapter.ts:155-167`、`:301-303` |
| merge 后写覆盖 | `src/merger/GraphDataMerger.ts:26-41` |
| delta 校验不含规模维度 | `src/shared/graphDelta.ts:72-90` |
| 边属性参与图指纹 | `src/shared/graphFingerprint.ts:99-110` |
| 已有"置信度"先例（死代码） | `src/shared/analysis/DeadCodeAnalyzer.ts:5-19`、`:100-116` |
| 工具面 A 的 10 个工具 | `src/tools.ts:247-618` |
| 工具面 B 是另一套 4 个 | `src/host/McpServer.ts:183-269` |
| 注册是固定解构列表 | `src/index.ts:50-62` |
| 无 token 预算概念 | 全仓 `grep tokenBudget\|token_budget\|charBudget` = 0 |
| 已有截断标记但无"下一步" | `src/host/routes/dataRoutes.ts:78-86` |
| 快照表与 `saveSnapshot` | `src/host/db/GraphRepository.ts:71-74`、`:115-121` |
| tree-sitter 走 WASM | `package.json` dependencies（`web-tree-sitter`、`tree-sitter-wasm`） |
| 已有 Louvain 社区检测 | `package.json`（`graphology-communities-louvain`）、`src/client/store/cluster/louvainDetection.ts` |

---

*报告结束。文中的全部 `路径:行号` 基于 commit `0a8cd4e1e342235fe53e881fb5d591bf0460071f`（graphify 侧）与本仓库当前工作树（本项目侧）；两者任何一方发生变更，行号都可能漂移。*
