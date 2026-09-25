import { normalize, isAbsolute, sep } from 'node:path';
import { platform } from 'node:os';

const isCaseInsensitive = platform() === 'win32';

function normalizeForComparison(p: string): string {
  const n = normalize(p);
  return isCaseInsensitive ? n.toLowerCase() : n;
}

export class SecurityManager {
  private allowedWorkspaceRoots: string[] = [];

  setAllowedWorkspaceRoots(roots: string[]): void {
    this.allowedWorkspaceRoots = roots.map(r => normalizeForComparison(r));
  }

  isPathAllowed(path: string): boolean {
    if (!path) return false;
    const normalized = normalize(path);
    if (normalized.includes('..')) return false;
    if (!isAbsolute(normalized)) {
      return false;
    }
    if (this.allowedWorkspaceRoots.length === 0) return false;
    const cmpPath = normalizeForComparison(normalized);
    return this.allowedWorkspaceRoots.some((root) =>
      cmpPath === root ||
      cmpPath.startsWith(root + sep)
    );
  }

  reset(): void {
    this.allowedWorkspaceRoots = [];
  }
}

export function createSecurityManager(): SecurityManager {
  return new SecurityManager();
}
