import { describe, it, expect, beforeEach } from 'vitest';
import { platform } from 'node:os';
import { sep } from 'node:path';
import { SecurityManager } from '../../src/host/security.ts';

/**
 * 平台无关的 fixture 路径（CI Linux / 本地 Windows 双跑）。
 *
 * cycle-146 发布时首次在 Linux CI（ubuntu-latest）跑出 8 处红——全部是本文件与
 * viewsRoute/nativeIndex 的 fixture 硬编码 Windows 盘符路径：`SecurityManager` 的
 * 安全边界语义按**运行平台**（`node:path` 的 sep/isAbsolute）判定，`C:\...` 在 POSIX
 * 上不是绝对路径 ⇒ fail-closed 拒绝。产品语义正确，fixture 平台化错误。
 *
 * 修法：fixture 按平台取真实绝对路径域（POSIX `/repo` / Windows `C:\repo`），
 * 断言语义（在内/不在内/fail-closed）不变。
 */
const IS_WIN = platform() === 'win32';
/** 平台原生绝对路径（每测试域一个独立根，避免跨用例串扰） */
const R1 = IS_WIN ? 'C:\\Projects\\my-repo' : '/repo1/my-repo';
const R1_SRC = `${R1}${sep}src`;
const R2 = IS_WIN ? 'C:\\Projects\\other-repo' : '/repo2/other-repo';
const R3 = IS_WIN ? 'D:\\secret' : '/secret';
const RA = IS_WIN ? 'C:\\Projects\\a' : '/repo1/a';
const RB = IS_WIN ? 'D:\\Projects\\b' : '/repo2/b';
/** 反例根：与 R1 同域但必然不同根（POSIX 上大小写敏感，Windows 上用大小写变体） */
const R1_ALT = IS_WIN ? 'C:\\Projects\\other-repo' : '/repo1/other-repo';

describe('SecurityManager.isPathAllowed', () => {
  let sm: SecurityManager;

  beforeEach(() => {
    sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots([]);
  });

  it('should return false for empty string', () => {
    expect(sm.isPathAllowed('')).toBe(false);
  });

  it('should return false for "." (relative paths always rejected)', () => {
    sm.setAllowedWorkspaceRoots([R1]);
    expect(sm.isPathAllowed('.')).toBe(false);
  });

  it('should return false for "." when no roots are set (fail-closed)', () => {
    expect(sm.isPathAllowed('.')).toBe(false);
  });

  it('should return false for relative path containing ".."', () => {
    expect(sm.isPathAllowed('..')).toBe(false);
    expect(sm.isPathAllowed(`..${sep}secret`)).toBe(false);
  });

  it('should return false for absolute paths when no roots are set (fail-closed)', () => {
    expect(sm.isPathAllowed(R1)).toBe(false);
    expect(sm.isPathAllowed(R3)).toBe(false);
  });

  it('should allow absolute paths within allowed roots', () => {
    sm.setAllowedWorkspaceRoots([R1]);
    expect(sm.isPathAllowed(R1)).toBe(true);
    expect(sm.isPathAllowed(R1_SRC)).toBe(true);
  });

  it('should reject absolute paths outside allowed roots', () => {
    sm.setAllowedWorkspaceRoots([R1]);
    expect(sm.isPathAllowed(R1_ALT)).toBe(false);
    expect(sm.isPathAllowed(R3)).toBe(false);
  });

  it('should isolate instances (no global singleton)', () => {
    const A = IS_WIN ? 'C:\\Projects\\r1' : '/repo1';
    const B = IS_WIN ? 'C:\\Projects\\r2' : '/repo2';
    const sm1 = new SecurityManager();
    const sm2 = new SecurityManager();
    sm1.setAllowedWorkspaceRoots([A]);
    sm2.setAllowedWorkspaceRoots([B]);
    expect(sm1.isPathAllowed(`${A}${sep}src`)).toBe(true);
    expect(sm1.isPathAllowed(`${B}${sep}src`)).toBe(false);
    expect(sm2.isPathAllowed(`${B}${sep}src`)).toBe(true);
    expect(sm2.isPathAllowed(`${A}${sep}src`)).toBe(false);
  });
});

describe('SecurityManager.reset', () => {
  it('clears all allowed workspace roots', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots([R1]);
    expect(sm.isPathAllowed(R1_SRC)).toBe(true);
    sm.reset();
    expect(sm.isPathAllowed(R1_SRC)).toBe(false);
  });

  it('allows re-setting roots after reset', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots([R1]);
    sm.reset();
    sm.setAllowedWorkspaceRoots([RB]);
    expect(sm.isPathAllowed(`${RB}${sep}src`)).toBe(true);
    expect(sm.isPathAllowed(R1_SRC)).toBe(false);
  });
});

// §31.7: the allowlist is re-resolved per request, so it has to grow instead of being replaced —
// a workspace the host registers after boot must become readable, and a transiently empty
// registry must not revoke a workspace that is already allowed.
describe('SecurityManager.addAllowedWorkspaceRoots', () => {
  it('adds to the existing roots instead of replacing them', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots([RA], 'registry');
    sm.addAllowedWorkspaceRoots([RB], 'sessions');
    expect(sm.isPathAllowed(`${RA}${sep}src`)).toBe(true);
    expect(sm.isPathAllowed(`${RB}${sep}src`)).toBe(true);
  });

  it('never shrinks: an empty re-resolution keeps the previous roots', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots([RA], 'registry');
    sm.addAllowedWorkspaceRoots([]);
    expect(sm.isPathAllowed(`${RA}${sep}src`)).toBe(true);
  });

  it('de-duplicates case-insensitively and ignores empty entries', () => {
    // Windows 大小写不敏感去重；POSIX 大小写敏感——去重语义按平台各自成立：
    // 这条用例在 POSIX 上验证「完全相同根去重 + 忽略空串 + 尾分隔符变体归一」，
    // 大小写变体的去重是 Windows 专属行为（生产代码 isCaseInsensitive 分支）。
    const base = IS_WIN ? 'C:\\Projects\\Repo' : '/repo1';
    const variant = IS_WIN ? 'c:\\projects\\repo' : '/repo1';
    const trailing = IS_WIN ? 'C:\\Projects\\Repo\\' : '/repo1/';
    const sm = new SecurityManager();
    sm.addAllowedWorkspaceRoots([base], 'registry');
    sm.addAllowedWorkspaceRoots([variant, '', trailing]);
    const roots = sm.getSnapshot().roots;
    const canon = (r: string) => (IS_WIN ? r.toLowerCase().replace(/\\+$/, '') : r.replace(/\/+$/, ''));
    expect(roots.filter((r) => canon(r) === canon(base))).toHaveLength(1);
    expect(roots).not.toContain('');
  });

  it('reports the source of the allowed roots', () => {
    const sm = new SecurityManager();
    expect(sm.getSnapshot()).toEqual({ roots: [], source: 'unknown' });
    sm.setAllowedWorkspaceRoots([RA], 'sessions');
    expect(sm.getSnapshot().source).toBe('sessions');
    sm.addAllowedWorkspaceRoots([RB], 'registry');
    expect(sm.getSnapshot().source).toBe('registry');
  });

  it('keeps the existing source when nothing new is added', () => {
    const sm = new SecurityManager();
    sm.addAllowedWorkspaceRoots([RA], 'sessions');
    sm.addAllowedWorkspaceRoots([RA], 'cwd');
    expect(sm.getSnapshot().source).toBe('sessions');
  });

  it('reset also clears the recorded source', () => {
    const sm = new SecurityManager();
    sm.addAllowedWorkspaceRoots([RA], 'registry');
    sm.reset();
    expect(sm.getSnapshot()).toEqual({ roots: [], source: 'unknown' });
  });
});
