import { spawnSync } from 'node:child_process';
import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';

const log = scoped('host');

export interface ContextWithSessions {
  sessions?: { list?: () => Array<{ header?: { cwd?: string } }> };
  workspaceRegistry?: { list?: () => Array<{ path?: string }> };
}

export function detectCodegraphCli(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000, shell: process.platform === 'win32' });
    return r.status === 0;
  } catch (e) {
    log.warn('detectCodegraphCli failed', e);
    return false;
  }
}

export function checkPrerequisites(ctx: Context): { codegraph: boolean; lens: boolean } {
  try {
    const cg = ctx.tools.get('codegraph_status') ?? ctx.tools.get('codegraph_graph') ?? ctx.tools.get('codegraph_query');
    const lens = ctx.tools.get('lens_analyze');
    return { codegraph: !!cg || detectCodegraphCli(), lens: !!lens };
  } catch (e) {
    log.warn('checkPrerequisites failed', e);
    return { codegraph: detectCodegraphCli(), lens: false };
  }
}

export function extractWorkspacePaths(ctx: Context): string[] {
  try {
    const wsr = (ctx as unknown as ContextWithSessions).workspaceRegistry;
    if (wsr?.list) {
      const workspaces = wsr.list();
      const paths = workspaces.map((w) => w.path).filter((p): p is string => !!p);
      if (paths.length > 0) return paths;
    }
  } catch (e) { log.warn('extractWorkspacePaths: workspaceRegistry failed', e); }
  try {
    const sessions = (ctx as unknown as ContextWithSessions).sessions;
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
    const wsr = (ctx as unknown as ContextWithSessions).workspaceRegistry;
    if (wsr?.list) {
      const workspaces = wsr.list();
      if (workspaces.length > 0 && workspaces[0]?.path) {
        return workspaces[0].path;
      }
    }
  } catch (e) { log.warn('findWorkspacePath: workspaceRegistry failed', e); }
  try {
    const sessions = (ctx as unknown as ContextWithSessions).sessions;
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