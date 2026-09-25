import { normalize, isAbsolute, sep } from 'node:path';

export class SecurityManager {
  private allowedWorkspaceRoots: string[] = [];

  setAllowedWorkspaceRoots(roots: string[]): void {
    this.allowedWorkspaceRoots = roots.map(r => normalize(r).toLowerCase());
  }

  isPathAllowed(path: string): boolean {
    if (!path) return false;
    const normalized = normalize(path);
    if (normalized.includes('..')) return false;
    if (!isAbsolute(normalized)) {

      return false;
    }
    if (this.allowedWorkspaceRoots.length === 0) return false;
    const lowerNormalized = normalized.toLowerCase();
    return this.allowedWorkspaceRoots.some((root) =>
      lowerNormalized === root ||
      lowerNormalized.startsWith(root + sep)
    );
  }

  reset(): void {
    this.allowedWorkspaceRoots = [];
  }
}

export function createSecurityManager(): SecurityManager {
  return new SecurityManager();
}
