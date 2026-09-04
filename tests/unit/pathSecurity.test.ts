import { describe, it, expect, beforeEach } from 'vitest';
import { isPathAllowed, setAllowedWorkspaceRoots } from '../../src/index.ts';

describe('isPathAllowed', () => {
  beforeEach(() => {
    setAllowedWorkspaceRoots([]);
  });

  it('should return true for empty string', () => {
    expect(isPathAllowed('')).toBe(true);
  });

  it('should return true for "."', () => {
    expect(isPathAllowed('.')).toBe(true);
  });

  it('should return false for relative path containing ".."', () => {
    expect(isPathAllowed('..')).toBe(false);
    expect(isPathAllowed('../secret')).toBe(false);
  });

  it('should return false for absolute paths when no roots are set (fail-closed)', () => {
    expect(isPathAllowed('C:\\Projects\\my-repo')).toBe(false);
    expect(isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should allow absolute paths within allowed roots', () => {
    setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    expect(isPathAllowed('C:\\Projects\\my-repo')).toBe(true);
    expect(isPathAllowed('C:\\Projects\\my-repo\\src')).toBe(true);
  });

  it('should reject absolute paths outside allowed roots', () => {
    setAllowedWorkspaceRoots(['C:\\Projects\\my-repo']);
    expect(isPathAllowed('C:\\Projects\\other-repo')).toBe(false);
    expect(isPathAllowed('D:\\secret')).toBe(false);
  });
});