import { describe, it, expect } from 'vitest';
import { isForeignRepo } from '../../src/shared/graphScope.ts';

/**
 * `isForeignRepo` 是 P0 跨工作区污染防护的判定原语：所有取数/落库通道最终都收敛到它。
 * 这里把"什么算外来"钉死，避免后续再有人改判定极性（Round 15 的 SSE 漏网正源于此）。
 */
describe('isForeignRepo', () => {
  it('treats a missing identity on either side as not foreign', () => {
    expect(isForeignRepo(null, '/repo/a')).toBe(false);
    expect(isForeignRepo('/repo/a', null)).toBe(false);
    expect(isForeignRepo(undefined, undefined)).toBe(false);
    expect(isForeignRepo('', '/repo/a')).toBe(false);
  });

  it('treats the same workspace as not foreign', () => {
    expect(isForeignRepo('/repo/a', '/repo/a')).toBe(false);
  });

  it('treats a different workspace as foreign', () => {
    expect(isForeignRepo('/repo/a', '/repo/b')).toBe(true);
  });

  it('ignores a separator-only difference', () => {
    expect(isForeignRepo('D:\\Projects\\repo', 'D:/Projects/repo')).toBe(false);
    expect(isForeignRepo('D:/Projects/repo/', 'D:/Projects/repo')).toBe(false);
  });

  it('ignores case only for Windows drive-letter paths', () => {
    expect(isForeignRepo('D:/Projects/Repo', 'd:/projects/repo')).toBe(false);
    expect(isForeignRepo('/Repo/A', '/repo/a')).toBe(true);
  });
});
