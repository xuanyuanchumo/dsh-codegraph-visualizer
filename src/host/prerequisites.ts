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
  // 可选服务（gen2 起）：走 `ctx.get()` 探测，让插件在没有该注册表的宿主上仍然激活。
  //
  // **必须传 `strict = false`（cycle-110 修复）**：`ctx.get(name)` 默认 strict 的含义是
  // 「提供者 fiber 当前活跃」而不是「服务存在」（cordis `lib/index.js:763-772`、
  // `lib/types/reflect.d.ts:16`）。本函数被 `resolveWorkspaceRoots()` 在**每个请求**里调用，
  // 而它第一次运行就发生在 `apply()` 的同一步里 —— 此时 `workspaceRegistry` 的提供者很可能
  // 还停在 loading。用默认值探测会把「稍后可用」永久判成「不存在」，于是工作区根只剩
  // sessions / cwd 两个回退分支，`addAllowedWorkspaceRoots` 也永远只拿到回退来源。
  // 这个缺陷在修之前不会让任何用例变红：回退路径同样能解析出根目录，只有「注册表里有、
  // sessions 里没有」的工作区会被静默丢掉。
  // 由 `tests/unit/generation/serviceProbeContract.test.ts` 的源码形状守卫兜底。
  return ctx.get('workspaceRegistry', false) as WorkspaceRegistryLike;
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
