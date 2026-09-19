import { normalize, isAbsolute, sep } from 'node:path';

export class SecurityManager {
  private allowedWorkspaceRoots: string[] = [];

  setAllowedWorkspaceRoots(roots: string[]): void {
    this.allowedWorkspaceRoots = roots.map(r => normalize(r));
  }

  isPathAllowed(path: string): boolean {
    if (!path) return false;
    const normalized = normalize(path);
    if (normalized.includes('..')) return false;
    if (!isAbsolute(normalized)) {
      if (normalized === '.' && this.allowedWorkspaceRoots.length > 0) return true;
      return false;
    }
    if (this.allowedWorkspaceRoots.length === 0) return false;
    return this.allowedWorkspaceRoots.some((root) =>
      normalized === root ||
      normalized.startsWith(root + sep)
    );
  }

  reset(): void {
    this.allowedWorkspaceRoots = [];
  }
}

const defaultManager = new SecurityManager();

export function setAllowedWorkspaceRoots(roots: string[]): void {
  defaultManager.setAllowedWorkspaceRoots(roots);
}

export function isPathAllowed(path: string): boolean {
  return defaultManager.isPathAllowed(path);
}

export function resetSecurityManager(): void {
  defaultManager.reset();
}
