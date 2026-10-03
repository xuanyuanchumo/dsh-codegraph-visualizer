import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';
import { POLLING } from '../shared/constants.ts';
import type { ApiCompatLayer } from './compat/index.ts';
import type { WorkspaceRootSource } from './security.ts';

const log = scoped('host');
const execFileAsync = promisify(execFile);

export async function detectCodegraphCli(): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
    await execFileAsync(cmd, ['--version'], { timeout: POLLING.PREREQ_CHECK_TIMEOUT_MS, shell: process.platform === 'win32' });
    return true;
  } catch (e) {
    log.warn('detectCodegraphCli failed', e);
    return false;
  }
}

/**
 * Tool names that prove the optional upstream plugin is installed.
 *
 * `codegraph_status`/`codegraph_graph`/`codegraph_query` are the surface our adapters talk to.
 * `mcp__codegraph__codegraph_explore` is the only tool the published plugin actually
 * contributes — verified against `dsh-codegraph@0.1.3` in the J0 profile, whose
 * `dsh.plugin.json` declares `contributes.tools: ["mcp__codegraph__codegraph_explore"]`.
 * Detecting presence solely through the `codegraph_status` family reported "prerequisite
 * missing" on a host that had the plugin installed, which also suppressed the client's
 * auto-bootstrap (`src/client/hooks/useAutoBootstrap.ts` gates on `codegraphReady`).
 */
const CODEGRAPH_TOOL_EVIDENCE = [
  'codegraph_status',
  'codegraph_graph',
  'codegraph_query',
  'mcp__codegraph__codegraph_explore',
] as const;

/** The `dsh-tool-lens` surface (absent from the J0 profile, so only its names are known). */
const LENS_TOOL_EVIDENCE = ['lens_analyze', 'lens_impact'] as const;

function isToolPresent(
  ctx: Context,
  apiCompat: ApiCompatLayer | undefined,
  key: 'codegraphStatus' | 'lensAnalyze',
  evidence: readonly string[],
): boolean {
  // Prefer the name the compat layer resolves for the detected generation, then fall back to
  // the full evidence list: a host we could not date may still expose one of these tools.
  if (apiCompat) {
    const resolved = apiCompat.getAvailableToolName(ctx, key);
    if (resolved && ctx.tools.get(resolved)) return true;
  }
  for (const name of evidence) {
    if (ctx.tools.get(name)) return true;
  }
  return false;
}

export function checkPrerequisites(ctx: Context, apiCompat?: ApiCompatLayer): { codegraph: boolean; lens: boolean; builtin: boolean } {
  try {
    return {
      codegraph: isToolPresent(ctx, apiCompat, 'codegraphStatus', CODEGRAPH_TOOL_EVIDENCE),
      lens: isToolPresent(ctx, apiCompat, 'lensAnalyze', LENS_TOOL_EVIDENCE),
      builtin: true,
    };
  } catch (e) {
    log.warn('checkPrerequisites failed', e);
    return { codegraph: false, lens: false, builtin: true };
  }
}

interface WorkspaceEntry {
  path?: string;
}

interface SessionEntry {
  header?: { cwd?: string };
}

type SessionsLike = { list?(): SessionEntry[] } | undefined;
type WorkspaceRegistryLike = { list?(): WorkspaceEntry[] } | undefined;

function getSessions(ctx: Context): SessionsLike {
  return (ctx as unknown as { sessions?: SessionsLike }).sessions;
}

function getWorkspaceRegistry(ctx: Context): WorkspaceRegistryLike {
  // Optional service (gen2-only): probe via ctx.get() so the plugin remains active
  // on hosts that do not provide the workspace registry.
  return ctx.get('workspaceRegistry') as WorkspaceRegistryLike;
}

export interface WorkspaceRootsResolution {
  paths: string[];
  source: WorkspaceRootSource;
}

/**
 * Resolve the workspace roots the host currently knows about, **and say which branch produced
 * them**. The label is the observability half of docs/需求分析.md §31.7: the plugin used to call
 * this once in `apply()` and freeze the result, so a boot-time empty registry silently denied
 * every later file route with a bare 403 and no way to see why. Callers re-resolve per request
 * (`ensureWorkspaceRootsAllowed` in `host/routes/shared.ts`).
 */
export function resolveWorkspaceRoots(ctx: Context): WorkspaceRootsResolution {
  try {
    const wsr = getWorkspaceRegistry(ctx);
    if (wsr?.list) {
      const workspaces = wsr.list();
      const paths = workspaces.map((w) => w.path).filter((p): p is string => !!p);
      if (paths.length > 0) return { paths, source: 'registry' };
    }
  } catch (e) { log.warn('resolveWorkspaceRoots: workspaceRegistry failed', e); }
  try {
    const sessions = getSessions(ctx);
    if (sessions?.list) {
      const all = sessions.list();
      const seen = new Set<string>();
      const paths: string[] = [];
      for (const session of all) {
        const cwd = session?.header?.cwd;
        if (cwd && !seen.has(cwd)) {
          seen.add(cwd);
          paths.push(cwd);
        }
      }
      if (paths.length > 0) return { paths, source: 'sessions' };
    }
  } catch (e) { log.warn('resolveWorkspaceRoots: sessions failed', e); }
  return { paths: [process.cwd()], source: 'cwd' };
}

export function extractWorkspacePaths(ctx: Context): string[] {
  return resolveWorkspaceRoots(ctx).paths;
}

export function findWorkspacePath(ctx: Context): string {
  try {
    const wsr = getWorkspaceRegistry(ctx);
    if (wsr?.list) {
      const workspaces = wsr.list();
      if (workspaces.length > 0 && workspaces[0]?.path) {
        return workspaces[0].path;
      }
    }
  } catch (e) { log.warn('findWorkspacePath: workspaceRegistry failed', e); }
  try {
    const sessions = getSessions(ctx);
    if (sessions?.list) {
      const all = sessions.list();
      for (const session of all) {
        const cwd = session?.header?.cwd;
        if (cwd) return cwd;
      }
    }
  } catch (e) { log.warn('findWorkspacePath: sessions failed', e); }
  return process.cwd();
}
