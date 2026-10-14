# M0-③ spike 报告 · 账本规范化反推（ledger canonical form）

> 状态：**已完成，结论 GO**（2026-10-13）。对应 [04-开发计划与里程碑.md](../04-开发计划与里程碑.md) §2 的 M0-③ 交付物，
> 回答 [05-数据结构与算法设计.md](../05-数据结构与算法设计.md) §3 的「canonical 反推」与 [04](../04-开发计划与里程碑.md) 风险 **R11**（hash 不可复现 → 降级只读不双链）。
> 复现脚本：`.anic-skill-evo/spike/ledger-canonical.mjs`（只读，不修改 `.cycles/`）。

---

## 0. 结论先行

| 问题 | 答案 |
|---|---|
| 既有 56 条 entry 的 hash 能否由一条**可写清**的规范形式逐条复现？ | **能，56/56**（唯一形式：固定六字段键序 + `JSON.stringify` 默认序列化） |
| 其余候选形式？ | 全部否证（字典序 0/56、含 hash 整对象 0/56、`k=v` 0/56、去空白 1/56） |
| 链是否可校验？ | **55/56 链接完好**，`chainHead === 末条 hash`；唯一断点是 **index 0 的 genesis**（`previousHash` 非 null） |
| 插件能否**接续**这条账本？ | **能**。新 entry 的 `previousHash` 必须取既有 `chainHead`，而不是重新 genesis |
| R11 风险 | **退场**：canonical 形式已实测钉死，不需要「降级为只读不双链」 |
| 唯一需要设计的点 | **legacy genesis 断链的处置语义**（§6，三选项 + 推荐） |

一句话：**「插件接续既有账本」这个承重假设成立**，且实现约束只有一条——六字段键序与序列化方式冻结。

---

## 1. 为什么这是承重假设

`docs/anic/` 的整套设计（08 §3.1 分段账本、09 §4.2 原则 1「单一事实来源」）都建立在「账本 = 唯一真相」上。
若既有账本的 hash 无法复现，则：

- 插件无法在既有链上**追加**（新的 `previousHash` 无从计算），
- 只能另起一条链（双链），而双链立刻推翻「单一事实来源」，
- 或者降级为**只读**（能看到历史，不能写新门禁结果）。

因此 M0-③ 的判据是二值的：**复现成功 ⇒ 追加可行；复现失败 ⇒ 降级只读**。

## 2. 方法与候选形式

只读脚本遍历 `.cycles/gates/ledger.json` 的 56 条 entry，对每条按候选形式重算 `sha256` 并与 `entry.hash` 比对：

| 代号 | 形式 |
|---|---|
| **A** | 固定六字段键序 `{gate, gateName, result, detail, timestamp, previousHash}` + `JSON.stringify` 默认序列化（**当前实现**） |
| B | 同 A 但删去所有空白字符（`replace(/\s/g,'')`） |
| C | 键名字典序 |
| D | 含 `hash` 字段的整对象 `JSON.stringify(entry)` |
| E | `key=value` 按行连接 |

另校验两项：`previousHash` 与前一条 `hash` 的链接、`chainHead` 与末条 `hash` 的一致性。

## 3. 结果（实测）

| 形式 | 复现 | 判定 |
|---|---|---|
| **A: 固定六字段键序 + `JSON.stringify`** | **56/56** | ✅ 唯一正确形式 |
| B: 去掉全部空白 | 1/56 | ❌ 证明**字段值内部的空白参与哈希** |
| C: 键名字典序 | 0/56 | ❌ 键序是载荷的一部分 |
| D: 含 `hash` 的整对象 | 0/56 | ❌ `hash` 不参与自身计算 |
| E: `k=v` 行连接 | 0/56 | ❌ |

链与头：

| 指标 | 值 |
|---|---|
| 有效链接 | **55/56** |
| `chainHead` | `a99ac6bd179bc4ed60fc70e5fa515f411ea39c6aa281ffe92f02e3528be21eba` |
| 末条 hash | 同 `chainHead`（一致） |
| 唯一断点 | `index 0`，`previousHash = c2e7c9e5eeaf7c18af4a35efed17169e8a5d516130864194c55f3e337ad66404`（非 null，期望 null） |
| 字段键集 | 56/56 完全一致：`gate, gateName, result, detail, timestamp, previousHash, hash` |
| `timestamp` 形态 | 56/56 为 ISO 8601（`2026-10-05T00:00:00.000Z`） |

**golden vector（供实现锁死用）**：

```
payload   = {"gate":"G2","gateName":"测试收敛门","result":"PASS","detail":"golden vector fixture","timestamp":"2026-01-01T00:00:00.000Z","previousHash":null}
sha256    = 3d77e40f1610b0742bca2573165b2b95c7d4aeeb64e4641b02b8eb8f888df329
```

真账本锚点（只读引用）：

```
entry[0].hash  = c9d448ba8ed100ea7de8c2f4af31318d9b8210e09260d4c59dafeb3859379ddf
entry[55].hash = a99ac6bd179bc4ed60fc70e5fa515f411ea39c6aa281ffe92f02e3528be21eba
```

## 4. 正确性论证

- **A 通过 56/56 ⇒ 形式已被完全确定**：哈希是确定性函数，能复现全部 56 条即说明「键序 + 序列化」与写者当时的实现逐字节一致。
- **B 只过 1/56 ⇒ 值内空白是载荷的一部分**：`JSON.stringify` 本身不产生结构性空白，因此 B 与 A 的差异全部来自 `detail` 等多行字段内部的换行与缩进被删除。这一条同时排除了「先规范化空白再哈希」的宽松实现——**任何"清理"都会立刻破坏链**。
- **C/D/E 全否 ⇒ 不是"某种常见 canonical 形式"就能兼容**：字典序（C）与整对象（D）都是最容易被后来者"顺手改成更规范的样子"的两种写法，实测 0/56 说明这类"改进"就是断链事故。

## 5. 一条方法论纠正（记录在案）

本 spike 第一轮用 PowerShell `ConvertFrom-Json` 读账本，得到 `timestamp = 10/05/2026 00:00:00`（en-US locale），一度判断为「账本时间戳是 locale 格式、跨机器不可复现」的**高危**结论。
实际是 **PowerShell 的幻影**：`ConvertFrom-Json` 会把 ISO 字符串自动转成 `[datetime]` 对象，再按本地格式渲染输出；账本里存的始终是 ISO。

教训与 CLAUDE.md 既有条目同源：**一个未经来源验证的显示值不是证据**。用 Node 直读文件后结论反转。
（反作用证据：若真是 locale 格式，A 也无法复现——因为 locale 字符串也是"值"，会被原样哈希。可见"格式可疑"本身不构成断链理由；**只有复现失败才是**。）

## 6. 接续设计（唯一需要决策的点）

既有链在 genesis 处断了（index 0 的 `previousHash` 指向一条已被裁剪的历史链头）。这不是本插件造成的，也不会被本插件修复。三种处置：

| 方案 | 做法 | 评价 |
|---|---|---|
| ① 拒绝 | 断链即拒绝写入 | ❌ 把历史数据形态当成新缺陷，无法接续 |
| ② 静默接续 | 新 entry 的 `previousHash` 取 `chainHead`，校验时忽略 genesis | ⚠️ 可用但"忽略"是隐式的，等于把惯例外挂 |
| **③ 显式采用（推荐）** | 写入一条 **adoption 记录**（新 entry，`gate` 为 `ADOPT` 或 detail 声明 adopted anchor），`previousHash = chainHead`；此后校验以该 anchor 为起点 | ✅ 断链成为**有记录的事实**而非被忽略的例外 |

配套两条实现约束：

1. **追加端点**：`previousHash` 只能取 `chainHead`（或链尾），绝不重新 genesis；分段落盘（08 §3.1）只改变物理位置，**canonical 载荷不变**。
2. **校验分级**：`verifyChain(strict)` 期望 genesis `previousHash === null`（对既有账本返回 55/56 + 明确断点）；`verifyFromAnchor(anchor)` 在 adoption 之后应全绿。二者不能混用，否则 adoption 会"顺手"把严格校验静默放宽。

## 7. 跨工作区读写（M0-③ 第二半）

插件侧的机制已存在，实测锚点 `src/host/security.ts`：

- `setAllowedWorkspaceRoots(roots, source)` / `addAllowedWorkspaceRoots(roots, source?)` —— 白名单**只增不改**的方向已内建；
- 路径判定 `cmpPath === cmpRoot || cmpPath.startsWith(cmpRoot + sep)`（`security.ts:76`）——**同前缀兄弟目录不越权**（`/a/b` 不会放行 `/a/bc`）；
- 白名单来源注释（`security.ts:19-23` 的 `WorkspaceRootSource = 'registry' | 'sessions' | 'cwd' | 'unknown'`）明确：**只来自宿主服务（workspaceRegistry / sessions），绝不来自用户输入**。

结论：ANIC 的 `.cycles/` 写入器可以复用同一模型——工作区根来自宿主服务，路径判定用同一函数，**不需要新开一条信任边界**。

## 8. 对文档族的影响

| 文档 | 变化 |
|---|---|
| 04 §2 / §R11 | M0-③ **通过**；R11（hash 不可复现）**退场**，替换为「adoption 记录语义」约束 |
| 05 §3 | canonical 形式从**推断**变为**实测钉死**（固定六字段键序 + `JSON.stringify`，golden vector 已入库） |
| 08 §3.1 | 分段只追加**不改变** canonical 载荷（分段是物理布局，不是哈希输入） |
| 09 §4.2 原则 1 | 「单一事实来源」获得实测支撑：接续而不是另起链 |
| 03 §3 / 12 | `runtime/Ledger.ts` 增加 `verifyFromAnchor` 与 adoption 路径 |

## 9. 复现指令

```bash
node .anic-skill-evo/spike/ledger-canonical.mjs .
```

输出为 JSON：`canonical`（五种形式的复现率）、`chain`（链接数与断点）、`chainHeadMatchesLast`、`extraKeys`、`timestampShapes`。只读，不写入 `.cycles/`。

## 10. 残余风险

- **R11′**：若未来有人「清理」`detail` 的空白或调整键序，链立即断——故 canonical 形式必须有**机器守卫**（已加入契约套件 K1 golden vector，见 [10-技能进化记录.md](../10-技能进化记录.md) §9.9）。
- **R11″**：`gate` 取值空间受 `GATE_NAMES` 约束，adoption 记录若使用新 gate 值，需要显式扩展白名单（否则触发 v1.8.0 的 fail-loud「未知 gate」——这是有意行为）。
- 本 spike 只覆盖**单工作区**账本；多工作区并行写入的临界区问题属 08 §3.1 与 05 §8，未在此验证。
