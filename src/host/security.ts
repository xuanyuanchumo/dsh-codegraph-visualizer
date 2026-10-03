import { normalize, isAbsolute, sep } from 'node:path';
import { platform } from 'node:os';

const isCaseInsensitive = platform() === 'win32';

/**
 * Comparison key for a path: normalized, without a trailing separator (so `C:\x\` and `C:\x` are
 * the same root and `root + sep` never becomes a double separator), lower-cased on Windows.
 * A bare drive (`C:`) or filesystem root (`/`) keeps its separator.
 */
function normalizeForComparison(p: string): string {
  const n = normalize(p);
  const trimmed = n.replace(/[\\/]+$/, '');
  const stable = trimmed === '' || /^[a-zA-Z]:$/.test(trimmed) ? n : trimmed;
  return isCaseInsensitive ? stable.toLowerCase() : stable;
}

/**
 * Which host source produced the allowed roots. Reported by the workspace route so a
 * "everything is 403" report can be diagnosed from outside the process instead of
 * inferred from a silent 403 (see docs/需求分析.md §31.7).
 */
export type WorkspaceRootSource = 'registry' | 'sessions' | 'cwd' | 'unknown';

export interface WorkspaceRootsSnapshot {
  roots: string[];
  source: WorkspaceRootSource;
}

export class SecurityManager {
  /** Raw paths as the host reported them; normalization happens at comparison time. */
  private allowedWorkspaceRoots: string[] = [];
  private rootSource: WorkspaceRootSource = 'unknown';

  setAllowedWorkspaceRoots(roots: string[], source: WorkspaceRootSource = 'unknown'): void {
    this.allowedWorkspaceRoots = roots.filter((r) => !!r);
    this.rootSource = source;
  }

  /**
   * Grow the allowlist instead of replacing it.
   *
   * The roots come from host services only (`workspaceRegistry` / `sessions`), never from a
   * request, so widening is safe; shrinking is the dangerous direction because a transiently
   * empty registry would deny every in-flight request (the §31.7 failure mode). A workspace
   * removed at runtime therefore stays readable until the host restarts, which is the
   * conservative choice for a local, read-only analysis plugin.
   */
  addAllowedWorkspaceRoots(roots: string[], source?: WorkspaceRootSource): void {
    const seen = new Set(this.allowedWorkspaceRoots.map(normalizeForComparison));
    let added = false;
    for (const root of roots) {
      if (!root) continue;
      const key = normalizeForComparison(root);
      if (seen.has(key)) continue;
      seen.add(key);
      this.allowedWorkspaceRoots.push(root);
      added = true;
    }
    if (source && (added || this.rootSource === 'unknown')) {
      this.rootSource = source;
    }
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
    return this.allowedWorkspaceRoots.some((root) => {
      const cmpRoot = normalizeForComparison(root);
      return cmpPath === cmpRoot || cmpPath.startsWith(cmpRoot + sep);
    });
  }

  /** Observable view of the allowlist (workspace route / tests). Never redacted: it is local-only. */
  getSnapshot(): WorkspaceRootsSnapshot {
    return { roots: [...this.allowedWorkspaceRoots], source: this.rootSource };
  }

  reset(): void {
    this.allowedWorkspaceRoots = [];
    this.rootSource = 'unknown';
  }
}

export function createSecurityManager(): SecurityManager {
  return new SecurityManager();
}
