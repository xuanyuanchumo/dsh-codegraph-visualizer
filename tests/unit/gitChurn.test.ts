/**
 * `src/host/gitChurn.ts` 的**真实 git** 测试（P0-A，cycle-105 真机发现）。
 *
 * 为什么这个文件必须跑真 git，而不是 mock `execFile`：
 *
 * P0-A 的缺陷恰恰藏在「参数怎么传给进程」这一层——`shell: true` 下 Node 把 argv
 * **拼成一条命令行字符串**（Node 自己也会发 DEP0190 警告），于是工作区路径里只要有
 * 一个空格，git 收到的 `-C` 就是一个被截断的路径，命令失败，面板显示「未获取到变更频率」。
 *
 * 一个 mock 掉 `execFile` 的测试**永远看不到这个缺陷**：它验证的是「我们传了哪些参数」，
 * 而不是「这些参数到达 git 时还是不是原样」。这与本仓库反复出现的
 * 「fixture 不得凭空发明外部契约」是同一条纪律的另一面——这里的外部契约就是
 * 真实的进程参数传递语义，只有真进程能证明。
 *
 * 用例刻意用**含空格 + 中文**的临时目录：这两者正是 shell 拼接最容易破坏的字符。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectGitChurn,
  collectGitChurnUncached,
  clearChurnCache,
} from '../../src/host/gitChurn.ts';

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
const DIR_NAME = 'cg churn 测试';

describe.skipIf(!HAS_GIT)('collectGitChurnUncached (real git, P0-A)', () => {
  let repoDir: string;

  beforeAll(() => {
    const parent = mkdtempSync(join(tmpdir(), 'cg-churn-'));
    repoDir = join(parent, DIR_NAME);
    // git init 到带空格 + 中文的目录里。`-C` 传的是 repoDir，正是被 shell 断开的那个值。
    const run = (args: string[]): void => {
      execFileSync('git', ['-C', repoDir, ...args], { stdio: 'ignore', timeout: 15000, windowsHide: true });
    };
    execFileSync('git', ['init', repoDir], { stdio: 'ignore', timeout: 15000, windowsHide: true });
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    writeFileSync(join(repoDir, 'a.txt'), 'hello\n');
    run(['add', '.']);
    run(['commit', '-m', 'first']);
  });

  afterAll(() => {
    if (repoDir) rmSync(join(repoDir, '..'), { recursive: true, force: true });
  });

  it('collects churn from a workspace path containing spaces and non-ASCII characters', async () => {
    clearChurnCache();
    const result = await collectGitChurnUncached(repoDir);

    // 这一条就是 P0-A 的回归断言：`shell: true` 时这里会是 available:false。
    expect(result.available).toBe(true);
    expect(result.commitCount).toBe(1);
    expect(result.byFile['a.txt']).toBe(1);
    // revision 来自 `git rev-parse HEAD`，证明带空格路径下 HEAD 也读到了。
    expect(result.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(result.truncated).toBe(false);
  });

  it('reports the failure reason (not a blank string) for a non-repository path', async () => {
    // 失败时 `error` 必须带上 git 的真实 stderr 首行。真机首调失败时它曾是空字符串，
    // 让「为什么没有数据」完全不可诊断——这与「工具不能删掉自己的证据」同源。
    const emptyDir = mkdtempSync(join(tmpdir(), 'cg-churn-norepo-'));
    try {
      const result = await collectGitChurnUncached(emptyDir);
      expect(result.available).toBe(false);
      expect(typeof result.error).toBe('string');
      expect((result.error ?? '').length).toBeGreaterThan(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('does not cache failures, so a transient error cannot stick for the whole TTL', async () => {
    // 「退化默认值必须拒绝而不是承诺」的另一面：失败不写缓存，否则一次瞬时失败会让
    // 用户在 30 秒内反复看到同一个错误，而期间 git 其实早已恢复。
    clearChurnCache();
    const emptyDir = mkdtempSync(join(tmpdir(), 'cg-churn-nocache-'));
    try {
      const first = await collectGitChurn(emptyDir);
      expect(first.available).toBe(false);
      // 第二次仍要真的去跑一遍（若失败被缓存，这里会直接返回同一个对象引用）。
      const second = await collectGitChurn(emptyDir);
      expect(second).not.toBe(first);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
