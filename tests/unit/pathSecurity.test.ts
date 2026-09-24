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
