import { describe, it, expect } from 'vitest';
import { isPathAllowed } from '../../src/index.ts';

describe('isPathAllowed', () => {
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

  it('should return true when allowedWorkspaceRoots is empty (open mode)', () => {
    expect(isPathAllowed('C:\\Projects\\my-repo')).toBe(true);
  });
});