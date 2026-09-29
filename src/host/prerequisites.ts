import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';
import { POLLING } from '../shared/constants.ts';

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

export function checkPrerequisites(ctx: Context): { codegraph: boolean; lens: boolean; builtin: boolean } {
  try {
    const cg = ctx.tools.get('codegraph_status') ?? ctx.tools.get('codegraph_graph') ?? ctx.tools.get('codegraph_query');
    const lens = ctx.tools.get('lens_analyze');
    return { codegraph: !!cg, lens: !!lens, builtin: true };
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
  return ctx.workspaceRegistry;
}

export function extractWorkspacePaths(ctx: Context): string[] {
  try {
    const wsr = getWorkspaceRegistry(ctx);
    if (wsr?.list) {
      const workspaces = wsr.list();
      const paths = workspaces.map((w) => w.path).filter((p): p is string => !!p);
      if (paths.length > 0) return paths;
    }
  } catch (e) { log.warn('extractWorkspacePaths: workspaceRegistry failed', e); }
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
      if (paths.length > 0) return paths;
    }
  } catch (e) { log.warn('extractWorkspacePaths: sessions failed', e); }
  return [process.cwd()];
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
