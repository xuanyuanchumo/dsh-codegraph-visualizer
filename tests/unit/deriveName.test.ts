import { describe, it, expect } from 'vitest';
import { deriveWorkspaceName } from '../../src/client/utils/deriveName.ts';

describe('deriveWorkspaceName', () => {
  it('should return empty string for empty path', () => {
    expect(deriveWorkspaceName('')).toBe('');
  });

  it('should return empty string for "."', () => {
    expect(deriveWorkspaceName('.')).toBe('');
  });

  it('should extract last segment from Unix path', () => {
    expect(deriveWorkspaceName('/home/user/project')).toBe('project');
  });

  it('should extract last segment from Windows path', () => {
    expect(deriveWorkspaceName('C:\\Users\\dev\\my-project')).toBe('my-project');
  });

  it('should handle trailing slash', () => {
    expect(deriveWorkspaceName('/home/user/project/')).toBe('project');
  });

  it('should handle trailing backslash', () => {
    expect(deriveWorkspaceName('C:\\Users\\dev\\my-project\\')).toBe('my-project');
  });

  it('should handle trailing multiple slashes', () => {
    expect(deriveWorkspaceName('/home/user/project//')).toBe('project');
  });

  it('should handle trailing mixed separators', () => {
    expect(deriveWorkspaceName('/home/user/project/\\')).toBe('project');
  });

  it('should handle mixed separators in path', () => {
    expect(deriveWorkspaceName('C:/Users/dev/my-project')).toBe('my-project');
  });

  it('should return the segment for single-segment path', () => {
    expect(deriveWorkspaceName('project')).toBe('project');
  });
});