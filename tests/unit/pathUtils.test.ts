import { describe, it, expect } from 'vitest';
import { getTopLevelDir, sameRepoId } from '../../src/shared/pathUtils.ts';

describe('pathUtils', () => {
  describe('getTopLevelDir', () => {
    it('returns path as-is when parts <= 2', () => {
      expect(getTopLevelDir('src')).toBe('src');
      expect(getTopLevelDir('src/main')).toBe('src/main');
    });

    it('returns / when simplified and parts <= 2', () => {
      expect(getTopLevelDir('src', { simplified: true })).toBe('/');
      expect(getTopLevelDir('src/main', { simplified: true })).toBe('/');
    });

    it('extracts top-level dir from src paths', () => {
      expect(getTopLevelDir('src/client/components/Button.tsx')).toBe('src/client');
    });

    it('extracts top-level dir from lib paths', () => {
      expect(getTopLevelDir('lib/utils/helper.ts')).toBe('lib/utils');
    });

    it('extracts top-level dir from app paths', () => {
      expect(getTopLevelDir('app/routes/home.tsx')).toBe('app/routes');
    });

    it('handles crates paths specially', () => {
      expect(getTopLevelDir('crates/core/src/lib.rs')).toBe('crates/core');
    });

    it('handles Windows drive letter paths', () => {
      expect(getTopLevelDir('C:/Users/test/project/file.ts')).toBe('Users/test');
    });

    it('handles backslash paths by normalizing', () => {
      expect(getTopLevelDir('src\\client\\components\\Button.tsx')).toBe('src/client');
    });

    it('simplified mode returns first 2 parts joined', () => {
      expect(getTopLevelDir('src/client/components/Button.tsx', { simplified: true })).toBe('src/client');
    });

    it('simplified mode with crates returns first 2 parts', () => {
      expect(getTopLevelDir('crates/core/src/lib.rs', { simplified: true })).toBe('crates/core');
    });

    it('handles deeply nested paths', () => {
      expect(getTopLevelDir('a/b/c/d/e/f.ts')).toBe('a/b');
    });

    it('handles paths with only drive letter and one dir', () => {
      expect(getTopLevelDir('C:/Users')).toBe('C:/Users');
    });
  });

  describe('sameRepoId', () => {
    it('treats identical paths as the same workspace', () => {
      expect(sameRepoId('/repo/app', '/repo/app')).toBe(true);
    });

    it('normalises backslashes', () => {
      expect(sameRepoId('D:\\Projects\\app', 'D:/Projects/app')).toBe(true);
    });

    it('ignores a trailing separator', () => {
      expect(sameRepoId('D:/Projects/app/', 'D:\\Projects\\app')).toBe(true);
    });

    it('ignores case for Windows drive-letter paths only', () => {
      expect(sameRepoId('D:/Projects/App', 'd:/projects/app')).toBe(true);
      expect(sameRepoId('/repo/App', '/repo/app')).toBe(false);
    });

    it('separates genuinely different workspaces', () => {
      expect(sameRepoId('D:/Projects/app', 'D:/Projects/other')).toBe(false);
    });

    // A missing identity must never be treated as a match: the host slot would then be read as
    // "same workspace" and diffed against a graph it does not own.
    it('treats a missing identity on either side as different', () => {
      expect(sameRepoId(null, '/repo/app')).toBe(false);
      expect(sameRepoId('/repo/app', undefined)).toBe(false);
      expect(sameRepoId('', '')).toBe(false);
    });
  });
});