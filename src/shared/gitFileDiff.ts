/**
 * git 文件级差异的纯函数层（P0-D，cycle-105 真机发现）。
 *
 * ## 为什么必须有这一层
 *
 * 升级前的 `/diff` 路由把「工作区路径 + `@` + 提交号」当成**仓库标识**去查
 * `.codegraph/codegraph.db`：
 *
 * ```
 * fetchMergedGraph(invoke, `${workspacePath}@${fromCommit}`, 'both')
 *   → resolveDbPath('D:\repo@abc123') = 'D:\repo@abc123\.codegraph\codegraph.db'
 * ```
 *
 * 那个路径**永远不存在**，于是 `nodes: []`、`edges: []`，路由照样回 **HTTP 200**。
 * 这是最坏的一种失败：不是报错，而是**假成功**——面板显示「两个版本之间没有结构变更」，
 * 而实测两个提交之间改了 42 个文件。用户没有任何线索能看出这次对比根本没做成。
 *
 * 根因是数据面缺一个维度：`codegraph.db` 索引的是**当前工作树**，表里没有任何
 * revision/commit 列（`nodes`/`edges`/`files` 三张表都没有）。也就是说「按提交取图」
 * 这件事在本仓库的数据面上**不可实现**，不是实现得不好。
 *
 * 唯一诚实且可实现的粒度是**文件级**：
 *
 * 1. `git diff --raw -z <from> <to>` 给出精确的变更文件清单与状态（A/M/D）；
 * 2. 画布上的文件节点 id 是可复现的 `file:<相对路径>`（探针实测 433/433 完全匹配，
 *    见 `scripts/probe-file-node-ids.mjs`）；
 * 3. 于是 `file:<path>` 与画布**同一命名空间**，`getElementById` 能真正命中。
 *
 * 若强行做符号级 diff，只能拿 tree-sitter 现场解析两个提交的源码，而 tree-sitter 的
 * 节点 id 是位置化的（`${filePath}:${label}:${row}`），与 DB 的语义化 id
 * （`file:...` / `import:<hash>`）**不可能对齐**——那会退回「标记一个都命中不了」
 * 的老问题，只是换了个地方。
 *
 * ## 本文件的职责边界
 *
 * 只做两件**没有副作用**的事：解析 git 输出、把变更清单转成图负载。跑 git 子进程的
 * 部分在 `src/host/gitDiff.ts`。这样单测不需要真的建仓库，也不会因为机器上没装 git 而红。
 */

/** 一个变更文件相对基线的状态。刻意复用 `diffStatus.ts` 的三值封闭联合。 */
export type GitFileStatus = 'added' | 'modified' | 'removed';

/** git 输出里的一条文件变更。 */
export interface GitFileChange {
  /** 归一化后的仓库相对路径（正斜杠、无前导 `./`）。 */
  path: string;
  status: GitFileStatus;
}

/** `git diff` 采集的硬性上限。 */
export const GIT_DIFF = {
  /** 最多接受多少个变更文件；超出则截断并置 `truncated`。 */
  MAX_FILES: 5000,
  /** 单次 `git diff` 的超时（毫秒）。超时按「采集失败」处理，不抛给调用方。 */
  TIMEOUT_MS: 15_000,
  /** `git diff` 输出上限（字节）。 */
  MAX_OUTPUT_BYTES: 8 * 1024 * 1024,
} as const;

/** 一次文件级 diff 的采集结果。失败与「没有变更」必须可区分。 */
export interface GitFileDiffResult {
  changes: GitFileChange[];
  /** 采集**是否真的拿到了 git 数据**。`false` 时 `changes` 为空，`error` 说明原因。 */
  available: boolean;
  /** 采集失败时的原因（人类可读）；成功为 `null`。静默失败无法排查，因此保留在载荷里。 */
  error: string | null;
  /** 是否被 `MAX_FILES` 截断。截断时面板必须能说明「只覆盖前 N 个文件」。 */
  truncated: boolean;
  /** 解析出的提交数（恒为 2：`from` 与 `to`）。供面板回显「A → B」。 */
  revisions: { from: string; to: string } | null;
}

/**
 * 把路径归一化成与 `codegraph.db` 的 `file_path` 列可比对的形状。
 *
 * 刻意与 `churn.ts` 的 `normalizeChurnPath` 保持**同一套规则**，但不直接 import 它：
 * 两个模块的语义不同（churn 是「统计」、这里是「身份」），共用一个函数会让任何一侧
 * 的规则调整意外改变另一侧。规则本身很短，重复是可接受的代价；真正不能重复的是
 * **节点 id 的拼法**，那件事在 `buildFileNodeId` 里只有一份实现。
 */
export function normalizeDiffPath(rawPath: string): string {
  return String(rawPath ?? '')
    // trim 是必需的：`-z` 分出的路径段理论上不带空白，但 git 的某些版本在
    // 状态码与路径之间会多一个空格（`--raw` 的人类可读格式就有）。
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/**
 * 画布上文件节点的 id。
 *
 * 这是**唯一构造点**：宿主侧生成 diff 节点、客户端侧查画布元素都用它。探针
 * （`scripts/probe-file-node-ids.mjs`）实测 433/433 个文件节点的 id 恰好是
 * `file:<file_path>`，因此这里的拼法必须与 `CodeGraphAdapter.mapRowsToGraphNodes`
 * 保持一致（那里直接用 DB 的 `n.id`，而 DB 的 id 就是 `file:<path>`）。
 *
 * 拼错一个字符的后果是静默的：`getElementById` 找不到元素 ⇒ 标记一个都不出现 ⇒
 * 面板显示「N 处变更」而画布毫无反应，且没有任何报错。
 */
export function buildFileNodeId(path: string): string {
  return `file:${normalizeDiffPath(path)}`;
}

/** git `--raw` 的状态字母 → 三值语义。`--no-renames` 保证不会出现 R/C。 */
const RAW_STATUS_MAP: Record<string, GitFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  T: 'modified', // 类型变更（普通文件 ↔ 符号链接等）在图上仍是「这个文件变了」
};

/**
 * 解析 `git diff --raw --no-renames -z` 的原始输出。
 *
 * 输出形状（`-z` 下用 NUL 分隔，状态行与路径**交替**出现）：
 *
 * ```
 * :100644 100644 694c57a e3b3222 M\0docs/a.md\0:100644 000000 abc1234 0000000 D\0src/b.ts\0
 * ```
 *
 * 刻意解析**状态行 + 紧随其后的一个路径段**，而不是按「每两段一组」硬切：
 * `-z` 输出里路径段可能为空（极少数情况下 git 会给出空路径），硬切会让后续所有
 * 配对整体错位一格——这类错位在结果上表现为「一堆文件状态全是上一个文件的」，
 * 且没有任何报错。
 *
 * 无法识别的状态字母（`U` 未合并、`X` 未知）**不静默丢弃**：按 `modified` 计入，
 * 因为「这个文件在两个提交之间确实不同」是唯一可以确定的事实。丢掉它会让 diff
 * 少报一个文件，而少报比多报更危险（用户会以为没改）。
 */
export function parseGitRawDiff(output: string): GitFileChange[] {
  const segments = String(output ?? '').split('\0');
  const changes: GitFileChange[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? '';
    // 状态行以 `:` 开头；其余段都是路径，由「前一个状态行」消费掉。
    if (!segment.startsWith(':')) continue;

    // 状态行形如 `:100644 100644 <sha> <sha> <STATUS>`，STATUS 是最后一个空白分隔的字段。
    const fields = segment.trim().split(/\s+/);
    const rawStatus = fields[fields.length - 1] ?? '';
    // 取状态字母的首字符：`M` / `A` / `D` / `T`；`R100` 之类在本仓库不会出现
    // （`--no-renames`），但首字符规则对它们同样安全。
    const letter = rawStatus.charAt(0).toUpperCase();
    const status = RAW_STATUS_MAP[letter] ?? 'modified';

    const rawPath = segments[i + 1] ?? '';
    // 消费掉路径段：下一轮从状态行继续。`i += 1` 而不是依赖「每两段一组」。
    i += 1;

    const path = normalizeDiffPath(rawPath);
    if (!path) continue;
    changes.push({ path, status });
  }

  return changes;
}

/**
 * 把变更清单转成 `/diff` 的响应图负载。
 *
 * **只产节点、不产边**：文件级 diff 里「两个文件之间新增了一条依赖」这件事在
 * `git diff --raw` 的输出里根本不存在（它只给文件清单，不给内容）。硬编一条边
 * 等于编造数据。节点上的 `diffStatus` 足以让画布上的文件节点亮起对应颜色。
 *
 * 节点字段刻意与 `CodeGraphAdapter.mapRowsToGraphNodes` 对文件节点的产出对齐：
 * `type: 'module'`（DB 的 `kind: 'file'` 映射到 `module`）、`label` 取文件名、
 * `filePath` 取归一化相对路径。这样即使客户端的 `coerceNode` 走同一套归一化，
 * 字段也不会因为「diff 节点比普通节点少了几个字段」而被过滤掉。
 */
export function fileChangesToDiffNodes(
  changes: readonly GitFileChange[],
): Array<{
  id: string;
  label: string;
  type: 'module';
  filePath: string;
  properties: Record<string, unknown>;
}> {
  const seen = new Set<string>();
  const nodes: Array<{
    id: string;
    label: string;
    type: 'module';
    filePath: string;
    properties: Record<string, unknown>;
  }> = [];

  for (const change of changes) {
    const filePath = normalizeDiffPath(change.path);
    if (!filePath) continue;
    const id = buildFileNodeId(filePath);
    // 同一路径出现两次（例如 rename 的两侧在 `--no-renames` 下被拆成 D + A）
    // 只保留**第一条**：后面的条目描述的是同一份文件的另一半生命周期，
    // 覆盖会让状态在「删除」与「新增」之间随机跳动。
    if (seen.has(id)) continue;
    seen.add(id);

    const segments = filePath.split('/');
    const label = segments[segments.length - 1] || filePath;

    nodes.push({
      id,
      label,
      type: 'module',
      filePath,
      properties: {
        // `diffStatus` 必须落在 `properties` 里：`diffStatus.ts` 的 `readDiffStatus`
        // 只读 `properties.diffStatus`，写到顶层会被整条忽略（标记不出现且无报错）。
        diffStatus: change.status,
        // 与 DB 文件节点同一套属性词汇，便于面板按 kind 过滤时行为一致。
        kind: 'file',
        source: 'git-diff',
      },
    });
  }

  return nodes;
}
