import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Contract guards for docs/需求分析.md §31.7 (workspace path validation).
 *
 * Round 7's J0 found that *every* file route answered 403 on a real host: the allowlist was resolved
 * once in `apply()` and frozen, and relative paths were resolved against whichever workspace the host
 * listed first. The behavioural coverage lives in routes.test.ts / api.test.ts / diagramIndex.test.ts;
 * what is checked here is the structure that keeps the fix in place — a single choke point for AST
 * requests, and a per-request (never boot-time-frozen) allowlist refresh.
 */

const ROOT = path.resolve(__dirname, '../..');

/** Strip whole-line comments so prose that explains a removed workaround cannot satisfy a check. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');
}

function readSource(relative: string): string {
  return codeOnly(fs.readFileSync(path.join(ROOT, relative), 'utf-8'));
}

function clientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src/client'));
  return out;
}

describe('workspace path request contract', () => {
  it('sends the workspace parameter wherever a client builds the AST request', () => {
    const callers = clientSources().filter((file) => fs.readFileSync(file, 'utf-8').includes('/api/v1/codegraph/ast'));
    const names = callers.map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
    // Two call sites exist for a reason: `api.fetchAst` is the shared helper, and
    // `diagram.assembleMicroDiagram` maps HTTP statuses onto user-facing messages itself. Anything
    // new has to justify itself here.
    expect(names.sort()).toEqual([
      'src/client/api/index.ts',
      'src/client/diagram/index.ts',
    ]);
    for (const file of callers) {
      const source = codeOnly(fs.readFileSync(file, 'utf-8'));
      expect(source).toContain("params.set('workspace', workspace)");
      expect(source).toContain('${qs ? `?${qs}` : \'\'}');
    }
  });

  it('keeps the allowed workspace roots refreshed per request instead of frozen at boot', () => {
    const shared = readSource('src/host/routes/shared.ts');
    expect(shared).toContain('ensureWorkspaceRootsAllowed(');
    expect(shared).toContain('resolveWorkspaceRoots(');
    expect(shared).toContain('addAllowedWorkspaceRoots(');
    // Every path-validating entry point refreshes first (the fourth one, resolveAndValidateRelativePath,
    // refreshes through resolveWorkspaceFromRequest).
    expect(shared.match(/ensureWorkspaceRootsAllowed\(ctx, deps\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('resolves relative file paths against the request workspace, not the first listed one', () => {
    const shared = readSource('src/host/routes/shared.ts');
    const body = shared.slice(shared.indexOf('export async function resolveAndValidateRelativePath'));
    const fn = body.slice(0, body.indexOf('\nexport '));
    expect(fn).toContain('resolveWorkspaceFromRequest(req, ctx, deps)');
    expect(fn).not.toContain('findWorkspacePath(ctx)');
  });

  it('still seeds the allowlist at boot so the first request is not fail-closed', () => {
    const index = readSource('src/index.ts');
    expect(index).toContain('setAllowedWorkspaceRoots(');
  });

  it('exposes the allowed roots and their source from the workspace route', () => {
    const status = readSource('src/host/routes/statusRoutes.ts');
    expect(status).toContain('allowedRoots:');
    expect(status).toContain('rootSource:');
  });
});
