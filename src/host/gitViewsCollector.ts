/**
 * Π 视图的 git 原始输入采集器（cycle-144，T1）。
 *
 * ## 为什么需要这个模块
 *
 * `/views` 路由自 cycle-141 起支持 `commitLog` / `blameLog` 查询参数，但真机
 * 用户旅程显示时序/所有权视图恒为「不可用」——因为**没有任何调用方采集这两份
 * 输入**（客户端没有、宿主侧也没有），「支持传参」成了一个永远无人传的参数。
 * 这与本仓反复出现的「参数加了、没人传」缺陷同族（CLAUDE.md：把文档说 N 个
 * 调用点当假设去 grep，从不当 spec）。
 *
 * 本模块在宿主侧补上采集端：工作区里跑两条 git 命令，把原始文本喂给既有的
 * `buildTemporalFact` / `buildOwnershipFact`。降级语义不变——git 不可用 /
 * 不是仓库 / 超时时返回 `null`，路由继续走「available: false + 中文原因」
 * 的诚实路径，**绝不编造空数据冒充成功**。
 *
 * ## 复用 gitChurn.ts 的全部纪律（不再各写一份）
 *
 * - `execFile` 无 shell（工作区路径含空格/中文安全，cycle-105 P0-A 教训）；
 * - `windowsHide: true`（不闪控制台窗口）；
 * - 有界 Map + TTL 缓存，**只缓存成功结果**（失败不固化成状态）；
 * - `clearCache()` 供测试与工作区切换；
 * - 失败原因压成一行可读文本。
 *
 * ## 输出格式与解析器逐字对齐
 *
 * - commitLog：`git log --name-only --format=%x1e%H%x1f%ct`——`parseCommitLog`
 *   按 `\x1e` 分段、头 `<hash>\x1f<unix-ts>`（shared/temporal.ts:163）；
 * - blameLog：`git blame --porcelain`——`parseGitBlamePorcelain` 按行解析
 *   `^<hash> <line> <group> <count>` 头（shared/ownership.ts:102）。
 * 采集器与解析器分属 host/shared 两侧，格式漂移会让「采集成功但解析为空」
 * 静默发生，因此测试里用真实 git 仓库往返验证（非 mock 解析器）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scoped } from '../shared/Logger.ts';

const log = scoped('host:views-collector');
const execFileAsync = promisify(execFile);

/** 单条 git 采集结果：原始文本 + 可用性 + 一行可读原因。 */
export interface GitRawInput {
  text: string | null;
  available: boolean;
  reason: string | null;
  /** 采集耗时（毫秒）——白盒披露，面板与审计日志都能看到采集成本。 */
  durationMs: number;
  /** 输出是否被截断（超过字节上限）——截断的输入对解析器仍是合法前缀。 */
  truncated: boolean;
}

/** 采集失败/跳过时的空结果。 */
function unavailable(reason: string, durationMs = 0): GitRawInput {
  return { text: null, available: false, reason, durationMs, truncated: false };
}

/** 采集上限：输出字节与超时。与 gitChurn 的 CHURN 常量同族但独立——
 * blame 在大仓库上比 log 更重（逐行归属），给独立的调参位。 */
const COLLECT = {
  /** git log/blame 单条超时。 */
  TIMEOUT_MS: 8_000,
  /** 输出字节上限（8MB：大型仓库全量 log 的现实量级之上）。 */
  MAX_BUFFER: 8 * 1024 * 1024,
  /** 超出 MAX_BUFFER 后保留的尾部字节数（尾部是最新提交，对 days 窗口最有用）。 */
  TAIL_KEEP: 2 * 1024 * 1024,
} as const;

/** 采集缓存条目。 */
interface CollectorCacheEntry { result: GitRawInput; timestamp: number }

/** 两个采集通道各自的缓存（key = `${workspacePath}::${channel}`）。 */
const collectCache = new Map<string, CollectorCacheEntry>();
const CACHE_MAX = 16;
const CACHE_TTL_MS = 30_000;

/** 清空采集缓存（测试与工作区切换）。 */
export function clearViewsGitCache(): void {
  collectCache.clear();
}

/** 归一化 git 失败原因为一行可读文本（与 gitChurn.describeError 同策略）。 */
function describeError(e: unknown): string {
  if (e instanceof Error) {
    const err = e as { stderr?: string; killed?: boolean; signal?: string; code?: string | number };
    if (err.stderr) {
      const firstLine = err.stderr.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
      if (firstLine.trim()) return firstLine.trim();
    }
    if (err.killed || err.signal) {
      return `git 超时（>${COLLECT.TIMEOUT_MS}ms）或被杀（signal=${err.signal ?? 'unknown'}）`;
    }
    if (err.code === 'ENOENT') return '找不到 git 可执行文件（未安装或不在 PATH 中）';
    const firstMessageLine = e.message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? e.message;
    return firstMessageLine.trim();
  }
  return String(e);
}

/** 输出截断保护：超限时保留尾部（最新提交在尾部）。 */
function clampTail(stdout: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(stdout, 'utf-8') <= COLLECT.MAX_BUFFER) {
    return { text: stdout, truncated: false };
  }
  const buf = Buffer.from(stdout, 'utf-8');
  // 从尾部截 COLLECT.TAIL_KEEP 字节；可能切在多字节字符中间，用 Buffer toString 容错。
  const tail = buf.subarray(buf.length - COLLECT.TAIL_KEEP).toString('utf-8');
  log.warn('git output truncated to tail', { keepBytes: COLLECT.TAIL_KEEP });
  return { text: tail, truncated: true };
}

/**
 * 带缓存的采集入口。显式传参（查询串）绕过缓存——调用方自带的输入以它为准。
 *
 * cycle-146 修复：`fileFilter` 限定 blame 的文件集。真机实证（dsh-anic，1056 个
 * 跟踪文件）：全量逐文件 blame 77 秒——超过客户端 30s 请求预算，面板必然「加载失败」
 * （白盒披露存在但采集墙时间无界）。而消费端 `buildOwnershipMap` 只按图节点的
 * `filePath` 查表，全仓 blame 的其余文件白算。路由传入图节点文件集后采集量与
 * 图规模成正比（50 节点 ≈ 几十个文件 → 亚秒级）。缓存键随 fileFilter 变化：
 * 不同图规模的工作区各自缓存，互不污染。
 */
export async function collectGitRawInput(
  workspacePath: string,
  channel: 'commitLog' | 'blameLog',
  fileFilter?: ReadonlySet<string>,
): Promise<GitRawInput> {
  const filterKey = fileFilter && fileFilter.size > 0 ? [...fileFilter].sort().join('\u0000') : '';
  const cacheKey = `${workspacePath}::${channel}::${filterKey}`;
  const cached = collectCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.result;

  const result = await collectUncached(workspacePath, channel, fileFilter);
  if (result.available) {
    if (collectCache.size >= CACHE_MAX) {
      const oldest = collectCache.keys().next().value;
      if (oldest !== undefined) collectCache.delete(oldest);
    }
    collectCache.set(cacheKey, { result, timestamp: Date.now() });
  }
  return result;
}

/** 无缓存采集实现（测试直接调它验证真实 git 行为）。 */
async function collectUncached(
  workspacePath: string,
  channel: 'commitLog' | 'blameLog',
  fileFilter?: ReadonlySet<string>,
): Promise<GitRawInput> {
  const started = Date.now();
  const baseArgs = ['-C', workspacePath, '-c', 'core.quotepath=false'];
  try {
    if (channel === 'commitLog') {
      const { stdout } = await execFileAsync('git', [...baseArgs, 'log', '--name-only', '--format=%x1e%H%x1f%ct'], {
        timeout: COLLECT.TIMEOUT_MS,
        maxBuffer: COLLECT.MAX_BUFFER * 2,
        windowsHide: true,
      });
      const { text, truncated } = clampTail(stdout);
      const durationMs = Date.now() - started;
      if (!text.trim()) return unavailable('git 输出为空（空仓库或无提交历史）', durationMs);
      return { text, available: true, reason: null, durationMs, truncated };
    }

    // blame：`-- .` 在空路径上会报 `fatal: no such path '' in HEAD`（真机实证），
    // 正确形态是先 ls-files 拿跟踪文件清单，再对文件清单逐个 blame（单条进程，
    // 文件名作为 argv 传递——无 shell 纪律下含空格/中文路径安全）。
    const ls = await execFileAsync('git', [...baseArgs, 'ls-files'], {
      timeout: COLLECT.TIMEOUT_MS,
      maxBuffer: COLLECT.MAX_BUFFER,
      windowsHide: true,
    });
    const tracked = ls.stdout.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
    if (tracked.length === 0) {
      return unavailable('仓库没有跟踪文件（空仓库或全部未跟踪）', Date.now() - started);
    }
    // cycle-146：按图节点文件集过滤——消费端 buildOwnershipMap 只按 node.filePath
    // 查表，跟踪文件全量 blame 的其余文件是白算的墙时间（dsh-anic 实测 77s vs
    // 过滤后亚秒）。归一化对齐 normalizeChurnPath（斜杠方向/前缀），否则键错位
    // 会让过滤后空集、所有权视图永远不可用——比全量慢更糟，所以空集时回退全量。
    let targets = tracked;
    if (fileFilter && fileFilter.size > 0) {
      const wanted = new Set(
        [...fileFilter].map((f) => f.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')),
      );
      const filtered = tracked.filter((f) => wanted.has(f));
      if (filtered.length > 0) targets = filtered;
    }
    // 分批：argv 长度有 OS 上限。但**多文件 blame 在本机 git 2.56（niugit）下
    // 直接报 `fatal: bad revision 'sub/b.ts'`（真机实证）——porcelain 模式只认
    // 单文件**。因此逐文件串行；吞吐靠 TTL 缓存摊平（30s 内的重复请求不重跑），
    // 而不是并行（并行会让大批仓库瞬间起几百个 git 进程）。
    const parts: string[] = [];
    let truncated = false;
    for (const file of targets) {
      const { stdout } = await execFileAsync('git', [...baseArgs, 'blame', '--porcelain', '--', file], {
        timeout: COLLECT.TIMEOUT_MS,
        maxBuffer: COLLECT.MAX_BUFFER,
        windowsHide: true,
      });
      parts.push(stdout);
      // 单文件输出超限只丢该文件的归属，不中止整批（其余文件照常采集）。
      if (Buffer.byteLength(stdout, 'utf-8') > COLLECT.MAX_BUFFER) truncated = true;
    }
    const joined = parts.join('');
    const { text, truncated: tailTruncated } = clampTail(joined);
    const durationMs = Date.now() - started;
    if (!text.trim()) return unavailable('blame 输出为空（文件全部为空或 HEAD 缺失）', durationMs);
    return { text, available: true, reason: null, durationMs, truncated: truncated || tailTruncated };
  } catch (e) {
    const durationMs = Date.now() - started;
    const reason = describeError(e);
    log.info('views git collect failed', { channel, reason, durationMs });
    return unavailable(reason, durationMs);
  }
}

/** 导出采集上限（测试断言与文档引用）。 */
export const VIEWS_COLLECT_LIMITS = COLLECT;
/** 导出缓存参数（测试断言）。 */
export const VIEWS_COLLECT_CACHE = { MAX: CACHE_MAX, TTL_MS: CACHE_TTL_MS };
