import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityManager } from '../../src/host/security.ts';

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
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    expect(sm.isPathAllowed('.')).toBe(false);
  });

  it('should return false for "." when no roots are set (fail-closed)', () => {
    expect(sm.isPathAllowed('.')).toBe(false);
  });

  it('should return false for relative path containing ".."', () => {
    expect(sm.isPathAllowed('..')).toBe(false);
    expect(sm.isPathAllowed('../secret')).toBe(false);
  });

  it('should return false for absolute paths when no roots are set (fail-closed)', () => {
    expect(sm.isPathAllowed('C:\\Projects\\my-repo')).toBe(false);
    expect(sm.isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should allow absolute paths within allowed roots', () => {
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    expect(sm.isPathAllowed('C:\\Projects\\my-repo')).toBe(true);
    expect(sm.isPathAllowed('C:\\Projects\\my-repo\\src')).toBe(true);
  });

  it('should reject absolute paths outside allowed roots', () => {
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    expect(sm.isPathAllowed('C:\\Projects\\other-repo')).toBe(false);
    expect(sm.isPathAllowed('D:\\secret')).toBe(false);
  });

  it('should isolate instances (no global singleton)', () => {
    const sm1 = new SecurityManager();
    const sm2 = new SecurityManager();
    sm1.setAllowedWorkspaceRoots(['/repo1']);
    sm2.setAllowedWorkspaceRoots(['/repo2']);
    expect(sm1.isPathAllowed('/repo1/src')).toBe(true);
    expect(sm1.isPathAllowed('/repo2/src')).toBe(false);
    expect(sm2.isPathAllowed('/repo2/src')).toBe(true);
    expect(sm2.isPathAllowed('/repo1/src')).toBe(false);
  });
});
describe('SecurityManager.reset', () => {
  it('clears all allowed workspace roots', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    expect(sm.isPathAllowed('C:\\Projects\\my-repo\\src')).toBe(true);
    sm.reset();
    expect(sm.isPathAllowed('C:\\Projects\\my-repo\\src')).toBe(false);
  });

  it('allows re-setting roots after reset', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    sm.reset();
    sm.setAllowedWorkspaceRoots(['D:\\other-repo']);
    expect(sm.isPathAllowed('D:\\other-repo\\src')).toBe(true);
    expect(sm.isPathAllowed('C:\\Projects\\my-repo\\src')).toBe(false);
  });
});

// §31.7: the allowlist is re-resolved per request, so it has to grow instead of being replaced —
// a workspace the host registers after boot must become readable, and a transiently empty
// registry must not revoke a workspace that is already allowed.
describe('SecurityManager.addAllowedWorkspaceRoots', () => {
  it('adds to the existing roots instead of replacing them', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\a'], 'registry');
    sm.addAllowedWorkspaceRoots(['D:\\Projects\\b'], 'sessions');
    expect(sm.isPathAllowed('C:\\Projects\\a\\src')).toBe(true);
    expect(sm.isPathAllowed('D:\\Projects\\b\\src')).toBe(true);
  });

  it('never shrinks: an empty re-resolution keeps the previous roots', () => {
    const sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\a'], 'registry');
    sm.addAllowedWorkspaceRoots([]);
    expect(sm.isPathAllowed('C:\\Projects\\a\\src')).toBe(true);
  });

  it('de-duplicates case-insensitively and ignores empty entries', () => {
    const sm = new SecurityManager();
    sm.addAllowedWorkspaceRoots(['C:\\Projects\\Repo'], 'registry');
    sm.addAllowedWorkspaceRoots(['c:\\projects\\repo', '', 'C:\\Projects\\Repo\\']);
    const roots = sm.getSnapshot().roots;
    expect(roots.filter((r) => r.toLowerCase().replace(/\\+$/, '') === 'c:\\projects\\repo')).toHaveLength(1);
    expect(roots).not.toContain('');
  });

  it('reports the source of the allowed roots', () => {
    const sm = new SecurityManager();
    expect(sm.getSnapshot()).toEqual({ roots: [], source: 'unknown' });
    sm.setAllowedWorkspaceRoots(['C:\\Projects\\a'], 'sessions');
    expect(sm.getSnapshot().source).toBe('sessions');
    sm.addAllowedWorkspaceRoots(['D:\\Projects\\b'], 'registry');
    expect(sm.getSnapshot().source).toBe('registry');
  });

  it('keeps the existing source when nothing new is added', () => {
    const sm = new SecurityManager();
    sm.addAllowedWorkspaceRoots(['C:\\Projects\\a'], 'sessions');
    sm.addAllowedWorkspaceRoots(['C:\\Projects\\a'], 'cwd');
    expect(sm.getSnapshot().source).toBe('sessions');
  });

  it('reset also clears the recorded source', () => {
    const sm = new SecurityManager();
    sm.addAllowedWorkspaceRoots(['C:\\Projects\\a'], 'registry');
    sm.reset();
    expect(sm.getSnapshot()).toEqual({ roots: [], source: 'unknown' });
  });
});
