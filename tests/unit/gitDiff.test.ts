// 旅程覆盖：J19（FR-24 版本对比——宿主侧 git 文件级 diff 采集的真实 git 测试）。
/**
 * `src/host/gitDiff.ts` 的**真实 git** 测试（cycle-105，P0-D）。
 *
 * ## 为什么必须跑真 git
 *
 * 与 `gitChurn.test.ts` 同一条理由：缺陷藏在「参数怎么到达 git」与「git 的输出
 * 到底长什么样」这两处。mock 掉 `execFile` 的测试验证的是「我们传了哪些参数」，
 * 而不是「git 收到之后给出的输出能被我们正确解析」。
 *
 * 尤其 `parseGitRawDiff` 的输入形状是一条**外部契约**：`--raw -z` 在真实仓库里
 * 到底用几个 NUL 分隔、状态字母在哪个位置、重命名被 `--no-renames` 拆成什么样，
 * 这些只有真 git 能回答。`gitFileDiff.test.ts` 里的字面量断言是从这里抄过去的。
 *
 * 用例刻意用**含空格 + 中文**的临时目录：`shell: true` 会在这两处断开（P0-A 的
 * 教训），而 P0-D 的新代码同样要证明自己没踩同一个坑。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectGitFileDiff,
  collectGitFileDiffUncached,
  clearGitDiffCache,
} from '../../src/host/gitDiff.ts';

/** 本机是否真的能用 git；不能时整组跳过，避免在无 git 的 CI 上误报失败。 */
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();

/** 目录名里同时含空格与中文——shell 拼接会在这两处断掉。 */
const DIR_NAME = 'cg diff 测试';

describe.skipIf(!HAS_GIT)('collectGitFileDiffUncached (real git, P0-D)', () => {
  let repoDir: string;
  /** 第一个提交（基线）：只有 `a.txt`。 */
  let firstCommit: string;
  /** 第二个提交：改 `a.txt`、加 `b.txt`、删 `c.txt`。 */
  let secondCommit: string;

  const run = (args: string[]): void => {
    execFileSync('git', ['-C', repoDir, ...args], { stdio: 'ignore', timeout: 15000, windowsHide: true });
  };

  beforeAll(() => {
    const parent = mkdtempSync(join(tmpdir(), 'cg-diff-'));
    repoDir = join(parent, DIR_NAME);
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', repoDir], { stdio: 'ignore', timeout: 15000, windowsHide: true });
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    // 关掉换行转换，否则 Windows 上 `core.autocrlf` 会让「未修改」的文件也显示为已改。
    run(['config', 'core.autocrlf', 'false']);

    writeFileSync(join(repoDir, 'a.txt'), 'one\n');
    writeFileSync(join(repoDir, 'c.txt'), 'gone\n');
    run(['add', '.']);
    run(['commit', '-m', 'first']);
    firstCommit = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();

    writeFileSync(join(repoDir, 'a.txt'), 'one changed\n');
    writeFileSync(join(repoDir, 'b.txt'), 'new\n');
    unlinkSync(join(repoDir, 'c.txt'));
    run(['add', '-A']);
    run(['commit', '-m', 'second']);
    secondCommit = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
  });

  afterAll(() => {
    if (repoDir) rmSync(join(repoDir, '..'), { recursive: true, force: true });
  });

  it('collects file changes from a workspace path containing spaces and non-ASCII characters', async () => {
    clearGitDiffCache();
    const result = await collectGitFileDiffUncached(repoDir, firstCommit, secondCommit);

    // 这一条是 P0-A 教训在本模块的回归断言：`shell: true` 时这里会是 available:false。
    expect(result.available).toBe(true);
    expect(result.error).toBeNull();

    // 三条变更各自的状态必须正确。`--no-renames` + 无重命名，所以是干净的 M/A/D。
    const byPath = Object.fromEntries(result.changes.map((c) => [c.path, c.status]));
    expect(byPath).toEqual({
      'a.txt': 'modified',
      'b.txt': 'added',
      'c.txt': 'removed',
    });
  });

  it('produces paths that match the file: node id namespace', async () => {
    // 端到端证明「git 给的路径」与「画布上的文件节点 id」能对齐：
    // 宿主不做任何改写，客户端 `file:${path}` 就能命中。
    clearGitDiffCache();
    const result = await collectGitFileDiffUncached(repoDir, firstCommit, secondCommit);
    expect(result.changes.map((c) => `file:${c.path}`).sort()).toEqual([
      'file:a.txt', 'file:b.txt', 'file:c.txt',
    ]);
  });

  it('accepts relative refs like HEAD~1 and HEAD', async () => {
    // cycle-105 P0-C 的端到端证明：正则放行 `~`/`^` 之后，git 本身确实接受这些引用。
    // 只改正则不测真 git 的话，无法排除「正则放行了但 git 不认」。
    clearGitDiffCache();
    const result = await collectGitFileDiffUncached(repoDir, 'HEAD~1', 'HEAD');
    expect(result.available).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('reports a readable failure reason for an unknown revision', async () => {
    // 失败必须可见且可诊断：只说「失败」而不说为什么，真机上无从排查。
    // 这条路由的历史失效形态是「空 diff + 200」——假成功，比报错更坏。
    clearGitDiffCache();
    const result = await collectGitFileDiffUncached(repoDir, 'no-such-rev-xyz', 'HEAD');
    expect(result.available).toBe(false);
    expect(result.error).toBeTruthy();
    expect((result.error ?? '').length).toBeGreaterThan(0);
  });

  it('reports a readable failure reason for a non-repository path', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'cg-diff-norepo-'));
    try {
      const result = await collectGitFileDiffUncached(emptyDir, 'HEAD~1', 'HEAD');
      expect(result.available).toBe(false);
      expect((result.error ?? '').length).toBeGreaterThan(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns an empty change list (still available) when the refs are identical', async () => {
    // 成对语义：`available: true` + `changes: []` 才是「两版本真的没差异」，
    // 而 `available: false` 是「这次对比没做成」。两者必须可区分——
    // 混在一起就是把失败渲染成「没有变更」。
    clearGitDiffCache();
    const result = await collectGitFileDiffUncached(repoDir, secondCommit, secondCommit);
    expect(result.available).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('does not cache failures, so a transient error cannot stick for the whole TTL', async () => {
    clearGitDiffCache();
    const emptyDir = mkdtempSync(join(tmpdir(), 'cg-diff-nocache-'));
    try {
      const first = await collectGitFileDiff(emptyDir, 'HEAD~1', 'HEAD');
      expect(first.available).toBe(false);
      // 失败不写缓存：第二次必须重新跑（若被缓存会直接返回同一个对象引用）。
      const second = await collectGitFileDiff(emptyDir, 'HEAD~1', 'HEAD');
      expect(second).not.toBe(first);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('caches successful results per (workspace, from, to) triple', async () => {
    clearGitDiffCache();
    const first = await collectGitFileDiff(repoDir, firstCommit, secondCommit);
    const second = await collectGitFileDiff(repoDir, firstCommit, secondCommit);
    // 同一个三元组命中缓存 ⇒ 返回**同一个对象引用**（不是重新跑一遍得到的新对象）。
    expect(second).toBe(first);

    // 反面：换一个维度就必须重算。只按工作区缓存的实现会让 `A→B` 的结果冒充 `C→D`，
    // 这与本仓库「校验器与被校验对象无关」那一族缺陷同形，只是表现为缓存与请求无关。
    const other = await collectGitFileDiff(repoDir, secondCommit, firstCommit);
    expect(other).not.toBe(first);
    // 反向对比的语义也确实不同：M 变成 M，但 A/D 互换。
    const byPath = Object.fromEntries(other.changes.map((c) => [c.path, c.status]));
    expect(byPath).toEqual({
      'a.txt': 'modified',
      'b.txt': 'removed',
      'c.txt': 'added',
    });
  });

  it('keeps non-ASCII file names intact end to end', async () => {
    // `-z` 的意义正在于此：换行格式下 git 会用 C 风格八进制转义中文路径，
    // 解析那套转义等于重写一遍 quotepath 逻辑。`-z` 给的是原样字节。
    writeFileSync(join(repoDir, '中文 文件.txt'), 'x\n');
    run(['add', '.']);
    run(['commit', '-m', 'third']);
    clearGitDiffCache();
    const result = await collectGitFileDiffUncached(repoDir, secondCommit, 'HEAD');
    expect(result.available).toBe(true);
    expect(result.changes.map((c) => c.path)).toContain('中文 文件.txt');
  });
});
