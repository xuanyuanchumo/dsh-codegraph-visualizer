import { normalize, isAbsolute } from 'node:path';

let allowedWorkspaceRoots: string[] = [];

export function setAllowedWorkspaceRoots(roots: string[]): void {
  allowedWorkspaceRoots = roots.map(r => normalize(r));
}

export function isPathAllowed(path: string): boolean {
  if (!path || path === '.') return true;
  const normalized = normalize(path);
  if (!isAbsolute(normalized)) return false;
  if (normalized.includes('..')) return false;
  if (allowedWorkspaceRoots.length === 0) return false;
  return allowedWorkspaceRoots.some((root) => normalized === root || normalized.startsWith(root + '\\') || normalized.startsWith(root + '/'));
}