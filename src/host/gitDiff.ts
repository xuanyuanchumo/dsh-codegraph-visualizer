/**
 * git 文件级差异采集器（P0-D，cycle-105 真机发现）。
 *
 * ## 为什么需要它
 *
 * 升级前的 `/diff` 把 `workspacePath@commit` 当仓库路径去查 `.codegraph/codegraph.db`，
 * 那个路径永远不存在，于是路由**恒返回空 diff 且 HTTP 200**——假成功。详见
 * `src/shared/gitFileDiff.ts` 文件头的完整推导。
 *
 * 本模块只负责跑 git 子进程，把原始输出交给 `parseGitRawDiff` 解析。所有「怎么理解输出」
 * 的逻辑都在纯函数层，因此这里的职责被压到最小：起进程、控超时、兜错误。
 *
 * ## 与 `gitChurn.ts` 共用同一条硬约束
 *
 * **绝不用 `shell: true`。** P0-A（cycle-105 真机）已经证明：`execFile` 在 `shell: true`
 * 下把参数拼成一条命令行字符串而不做转义，工作区路径含空格就会被断开——
 * `git -C C:\Users\me\My Projects\repo` → `fatal: cannot change to 'C:\Users\me\My'`。
 * 该失败是**永久性**的，不是瞬时超时。
 *
 * ## 失败必须可见
 *
 * 本函数永不抛异常给调用方：git 没装 / 不是仓库 / 提交不存在 / 超时 / 输出超限，
 * 一律返回 `available: false` 并带上人类可读的 `error`。路由把它原样发给客户端，
 * 客户端据此显示「对比未完成」，而不是把一次失败渲染成「两版本没有差异」。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scoped } from '../shared/Logger.ts';
import {
  GIT_DIFF,
  parseGitRawDiff,
  type GitFileChange,
  type GitFileDiffResult,
} from '../shared/gitFileDiff.ts';

const log = scoped('host:git-diff');
const execFileAsync = promisify(execFile);

/**
 * 采集结果的短 TTL 缓存（按「工作区 + 两个引用」三元组）。
 *
 * 一次 `git diff` 在大型仓库上可能几百毫秒；面板重复提交同一对引用（用户反复点「对比」
 * 或改一下别的输入再改回来）不该重复起子进程。键里必须**同时**包含三个维度：
 * 只按工作区缓存会让 `A→B` 的结果冒充 `C→D`（与 P0-R16-02 家族「校验器与被校验对象
 * 无关」同一形态的缺陷，只是这里表现为「缓存与请求无关」）。
 *
 * 有界 Map + 主动淘汰：工作区路径与引用都来自请求参数，无界缓存等于把内存占用交给调用方。
 */
interface DiffCacheEntry { result: GitFileDiffResult; timestamp: number; }
const diffCache = new Map<string, DiffCacheEntry>();
const DIFF_CACHE_MAX = 16;
/** 缓存有效期：短到能反映新的提交，长到足以吸收一次面板操作里的重复请求。 */
const DIFF_CACHE_TTL_MS = 30_000;

/** 清空缓存（测试与工作区切换时使用；也让「采集器有缓存」这件事可被观测）。 */
export function clearGitDiffCache(): void {
  diffCache.clear();
}

function cacheKey(workspacePath: string, from: string, to: string): string {
  return `${workspacePath}\u0001${from}\u0001${to}`;
}

/** 采集失败时的空结果。`error` 是原因，其余字段是「什么都没有」的诚实表达。 */
function failed(error: string, from: string, to: string): GitFileDiffResult {
  return {
    changes: [],
    available: false,
    error,
    truncated: false,
    revisions: { from, to },
  };
}

/** 归一化原因：把 git 的 stderr 压成一行，避免把整段帮助文本写进响应。 */
function describeError(e: unknown): string {
  if (e instanceof Error) {
    const err = e as { stderr?: string; killed?: boolean; signal?: string; code?: string | number };
    const stderr = err.stderr;
    if (stderr) {
      const firstLine = stderr.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
      if (firstLine.trim()) return firstLine.trim();
    }
    // 超时/被杀时 `stderr` 是空串、`e.message` 只有一条 `Command failed: git ...` 命令回显，
    // 对用户毫无信息量。显式识别并给出可读原因，否则「diff 不可用」永远无法排查。
    if (err.killed || err.signal) {
      return `git diff 超时（>${GIT_DIFF.TIMEOUT_MS}ms）或被杀（signal=${err.signal ?? 'unknown'}）`;
    }
    if (err.code === 'ENOENT') return '找不到 git 可执行文件（未安装或不在 PATH 中）';
    const firstMessageLine = e.message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? e.message;
    return firstMessageLine.trim();
  }
  return String(e);
}

/**
 * 采集 `from..to` 之间的文件变更清单（带短 TTL 缓存）。
 *
 * 用 `-z` 而不是默认的换行分隔：文件名里可以包含空格、引号、非 ASCII，换行格式下 git 会
 * 用 C 风格转义（`"\346\226\207..."`）输出，解析那套转义等于重写一遍 git 的 quotepath 逻辑。
 * `-z` 给的是**原样字节**，路径永远不会被转义。
 *
 * `--no-renames`：重命名在 `--raw` 下会输出成 `R100\0old\0new`，是**三段**而不是两段。
 * 文件级 diff 只需要知道「这两个路径都变了」，禁用重命名检测后 git 会把它拆成 D + A，
 * 解析器就只需处理「状态行 + 一个路径」这一种形状。
 */
export async function collectGitFileDiff(
  workspacePath: string,
  from: string,
  to: string,
): Promise<GitFileDiffResult> {
  const key = cacheKey(workspacePath, from, to);
  const cached = diffCache.get(key);
  if (cached && Date.now() - cached.timestamp < DIFF_CACHE_TTL_MS) return cached.result;

  const result = await collectGitFileDiffUncached(workspacePath, from, to);

  // 只缓存**成功**结果：失败不缓存，否则一次瞬时失败会让用户在 30 秒内反复看到
  // 「对比未完成」，而期间 git 其实早就可用了。把失败固化成状态比重复失败更糟。
  if (result.available) {
    if (diffCache.size >= DIFF_CACHE_MAX) {
      const oldest = diffCache.keys().next().value;
      if (oldest !== undefined) diffCache.delete(oldest);
    }
    diffCache.set(key, { result, timestamp: Date.now() });
  }
  return result;
}

/** 无缓存的采集实现；测试直接调它来验证真实行为。 */
export async function collectGitFileDiffUncached(
  workspacePath: string,
  from: string,
  to: string,
): Promise<GitFileDiffResult> {
  const baseArgs = ['-C', workspacePath, '-c', 'core.quotepath=false'];

  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        ...baseArgs,
        'diff',
        '--raw',
        '--no-renames',
        '-z',
        from,
        to,
        // `--` 之后是 pathspec；这里刻意留空，但**必须**有这个分隔符：
        // 否则一个长得像文件名的引用（例如恰好存在名为 `HEAD` 的文件）会被 git
        // 当成 pathspec 而不是 revision，导致「diff 忽然返回空」。
        '--',
      ],
      {
        timeout: GIT_DIFF.TIMEOUT_MS,
        maxBuffer: GIT_DIFF.MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
    );

    const allChanges = parseGitRawDiff(stdout);
    // 截断必须显式标出：一份被截断的清单看起来和完整清单一模一样，用户会以为
    // 「只改了这 5000 个文件」而不是「还有更多没显示」。
    const truncated = allChanges.length > GIT_DIFF.MAX_FILES;
    const changes: GitFileChange[] = truncated ? allChanges.slice(0, GIT_DIFF.MAX_FILES) : allChanges;

    return {
      changes,
      available: true,
      error: null,
      truncated,
      revisions: { from, to },
    };
  } catch (e) {
    const reason = describeError(e);
    log.warn('collectGitFileDiff failed', { workspacePath, from, to, reason });
    return failed(reason, from, to);
  }
}
