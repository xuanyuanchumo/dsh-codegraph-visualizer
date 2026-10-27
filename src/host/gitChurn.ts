/**
 * git 变更频率采集器（研究报告 §六 #11）。
 *
 * 现有热点分析只有入度维度；本模块补上「变更频率」一侧：在工作区里跑一次
 * `git log --name-only`，把「每个文件被多少个提交触及过」交给客户端与入度相乘。
 *
 * **失败必须可见，不能静默编造数据。** 本函数永不抛异常给调用方：
 * git 没装 / 目录不是仓库 / 超时 / 输出超限，一律返回 `available: false` 的空结果，
 * 由路由把它原样发给客户端——客户端据此显示「未获取到变更频率」，
 * 而不是把它当成「所有文件 0 次变更」混进热点排序。
 *
 * **刻意不用 `shell: true`（P0-A，cycle-105 真机发现）。** `prerequisites.ts` 里的
 * `shell: win32` 只在探测 `codegraph` 命令时成立（那里需要 shell 解析 `.cmd`），
 * 而 `git` 是一个真正的可执行文件，走 shell 只会带来一个致命副作用：`execFile` 在
 * `shell: true` 下把参数**拼成一条命令行字符串而不做转义**（Node DEP0190 也警告这一点），
 * 于是工作区路径里只要有空格就会被 shell 断开——
 *
 * ```
 * git -C C:\Users\me\My Projects\repo ...   →  fatal: cannot change to 'C:\Users\me\My'
 * ```
 *
 * 该失败是**永久性**的（不是瞬时超时）：只要工作区路径含空格，churn 就永远不可用，
 * 而本仓库的大量用户工作区正是 `D:\My Projects\...` 这类路径。
 * 去掉 shell 后参数按 argv 逐个传递，空格与中文都能正确到达 git（已实测：
 * 含空格 + 中文的临时仓库路径在 `shell: false` 下正常、`shell: true` 下报
 * `fatal: cannot change to ...: No such file or directory`）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scoped } from '../shared/Logger.ts';
import { CHURN, parseGitLogNames, type ChurnResult } from '../shared/churn.ts';

const log = scoped('host:churn');
const execFileAsync = promisify(execFile);

/**
 * 采集结果的短 TTL 缓存（按工作区路径）。
 *
 * `git log` 在大型仓库上要几百毫秒到数秒，而热点面板每次打开、每次换图都会触发一次请求。
 * 没有缓存时，用户拖动一次图就会连发多次 git 子进程——这是本仓库反复出现的
 * 「一个昂贵操作被无节流地重复调用」形态（对照 cycle-85 的 prefetch 重复请求）。
 *
 * 刻意用**有界 Map + 主动淘汰**而不是无界对象：工作区路径来自请求参数，
 * 无界缓存等于把攻击面（或用户长时间使用后的内存占用）交给调用方。
 */
interface ChurnCacheEntry { result: ChurnResult; timestamp: number; }
const churnCache = new Map<string, ChurnCacheEntry>();
const CHURN_CACHE_MAX = 16;
/** 缓存有效期：短到能反映新的提交，长到足以吸收一次面板操作里的重复请求。 */
const CHURN_CACHE_TTL_MS = 30_000;

/** 清空采集缓存（测试与工作区切换时使用；也让「采集器有缓存」这件事可被观测）。 */
export function clearChurnCache(): void {
  churnCache.clear();
}

/** 采集失败时的空结果。`error` 是原因，其余字段是「什么都没有」的诚实表达。 */
function failed(error: string): ChurnResult {
  return { byFile: {}, commitCount: 0, revision: null, truncated: false, available: false, error };
}

/** 成功时的空结果（git 可用但仓库里没有提交 / 没有文件变动）。 */
function empty(): ChurnResult {
  return { byFile: {}, commitCount: 0, revision: null, truncated: false, available: true, error: null };
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
    // 超时/被杀时 `stderr` 是空串、`e.message` 只有一条 `Command failed: git ...` 命令回显——
    // 那种原因对用户毫无信息量（真机日志里表现为 `reason: 'Command failed: git -C ...\n'`）。
    // 这里显式识别出来并给出可读原因，否则「churn 不可用」永远无法排查。
    if (err.killed || err.signal) {
      return `git log 超时（>${CHURN.TIMEOUT_MS}ms）或被杀（signal=${err.signal ?? 'unknown'}）`;
    }
    if (err.code === 'ENOENT') return '找不到 git 可执行文件（未安装或不在 PATH 中）';
    // 其余情况保留 message 的第一行，至少带上退出码。
    const firstMessageLine = e.message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? e.message;
    return firstMessageLine.trim();
  }
  return String(e);
}

/**
 * 采集 `workspacePath` 的 git 变更频率（带短 TTL 缓存）。
 *
 * 刻意用 `-C <dir>` 而不是把路径塞进 args：路径里带空格时 shell 转义是脆弱的，
 * `-C` 是 git 自己的参数，安全且可测。
 *
 * 缓存只缓存**成功**结果：失败（`available: false`）不缓存，否则一次瞬时失败会让用户
 * 在 30 秒内反复看到「未获取到变更频率」，而期间 git 其实早就可用了。
 * 这与「退化默认值必须拒绝而不是承诺」同一取向——把失败固化成状态比重复失败更糟。
 */
export async function collectGitChurn(workspacePath: string): Promise<ChurnResult> {
  const cached = churnCache.get(workspacePath);
  if (cached && Date.now() - cached.timestamp < CHURN_CACHE_TTL_MS) return cached.result;

  const result = await collectGitChurnUncached(workspacePath);

  if (result.available) {
    if (churnCache.size >= CHURN_CACHE_MAX) {
      const oldest = churnCache.keys().next().value;
      if (oldest !== undefined) churnCache.delete(oldest);
    }
    churnCache.set(workspacePath, { result, timestamp: Date.now() });
  }
  return result;
}

/** 无缓存的采集实现；测试直接调它来验证「缓存不改变结果」之外的真实行为。 */
export async function collectGitChurnUncached(workspacePath: string): Promise<ChurnResult> {
  const baseArgs = ['-C', workspacePath, '-c', 'core.quotepath=false'];

  // 先拿 HEAD：即使 log 失败，revision 也能告诉用户「这份统计基于哪个提交」。
  let revision: string | null = null;
  try {
    const head = await execFileAsync('git', [...baseArgs, 'rev-parse', 'HEAD'], {
      timeout: CHURN.TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    revision = head.stdout.trim() || null;
  } catch {
    // HEAD 取不到不阻断 log（例如空仓库）；log 自己会给出更准确的原因。
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        ...baseArgs,
        'log',
        '--name-only',
        '--format=%x1e',
        '--no-renames',
        `--max-count=${CHURN.MAX_COMMITS}`,
      ],
      {
        timeout: CHURN.TIMEOUT_MS,
        maxBuffer: CHURN.MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
    );

    const parsed = parseGitLogNames(stdout);
    // `--max-count` 用尽且仓库提交数确实更多时，统计是不完整的——显式标出来，
    // 面板据此说明「只覆盖最近 N 个提交」。
    const truncated = parsed.commitCount >= CHURN.MAX_COMMITS;

    if (parsed.commitCount === 0 && Object.keys(parsed.byFile).length === 0) {
      const result = empty();
      result.revision = revision;
      return result;
    }

    return {
      byFile: parsed.byFile,
      commitCount: parsed.commitCount,
      revision,
      truncated,
      available: true,
      error: null,
    };
  } catch (e) {
    const reason = describeError(e);
    log.warn('collectGitChurn failed', { workspacePath, reason });
    return failed(reason);
  }
}
