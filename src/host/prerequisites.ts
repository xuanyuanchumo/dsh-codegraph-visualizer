import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../shared/Logger.ts';
import { POLLING } from '../shared/constants.ts';
import type { PrerequisiteStatus } from '../shared/prerequisiteStatus.ts';
import { parsePackageJson } from '../adapters/DependencyAdapter.ts';
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

/**
 * 内置 **AST 分析通道**的探针。由宿主在构造共享 `TreeSitterAdapter` 之后登记
 * （`src/host/routes.ts`），因为 `checkPrerequisites(ctx)` 是**同步**签名，而解析器初始化
 * （`await import('web-tree-sitter')` + `Parser.init()`）是异步的。把它改成 async 会波及
 * 20 余处调用点（其中 `src/index.ts` 的同步轮询定时器直接读结果），代价远大于收益。
 *
 * 没有登记时一律判 `false`：**不知道不等于有**。这条方向是有意的 —— 把缺省写成 `true`
 * 正是本轮要修的缺陷（`docs/需求分析.md` §61.10）。
 */
let astSourceProbe: (() => boolean) | null = null;

/**
 * 登记 AST 通道探针。返回注销函数，调用方（`registerRoutes`）必须把它接进 `ctx.effect`
 * 的清理链：模块级状态在插件卸载后仍指向已 `destroy()` 的适配器时，下一次 `apply()`
 * 会读到上一轮的实例（同一进程内的 HMR / profile 重载场景）。
 */
export function setAstSourceProbe(probe: (() => boolean) | null): () => void {
  astSourceProbe = probe;
  return () => { if (astSourceProbe === probe) astSourceProbe = null; };
}

/**
 * 内置**图数据通道**的自检。
 *
 * 内置的图产出只有 manifest 依赖图（`package.json` / `Cargo.toml` / `go.mod`，由
 * `DependencyAdapter` 的纯函数解析，经 `/dependencies` 供给客户端「依赖」视图）。
 * `fetchMergedGraph` 的 `auto` 分支在外部源全空时**只记日志、不产节点**
 * （`src/tools.ts:132-134`）—— 所以「内置自动分析」不是一个图数据源，不能算进这个位。
 *
 * 判据是**跑一遍解析器**，不是写 `true`：本函数存在的全部理由就是不让第二个恒真式出现。
 * 解析器是纯函数，输入是一段固定 JSON，因此结果对同一份代码是常量 —— 但它每次调用都重算：
 * 缓存能力快照是本仓反复记录的缺陷放大器（`CLAUDE.md` 的「能力快照会放大缺陷」），而
 * 一次 `JSON.parse` 的成本远低于一次快照误判的代价。
 *
 * 导出是为了让它**可被证伪**：若它只在 `checkPrerequisites` 内部被调用，把实现换成
 * `return true` 不会有任何用例变红（2026-10-29 实测：变异 M5 换掉后 36 条用例全绿）。
 * 一个不能被证伪的探针与写死 `true` 没有区别，只是多了一层看起来很像检查的代码。
 *
 * `parser` 参数只为**测试可注入**而存在（默认就是生产用的那个纯函数）。为什么不改成
 * `vi.spyOn(DependencyAdapter)`：ESM 静态导入的绑定在调用点已经固化，spy 只能改模块
 * 命名空间对象、改不到 `prerequisites.ts` 里的那份引用 —— 那样写出来的"探针失败"用例
 * 会**永远绿**（测的是一个没被真正调用的替身）。注入点是唯一能被证伪的形态。
 */
export function probeGraphSource(parser: (content: string) => { nodes: unknown[]; edges: unknown[] } = parsePackageJson): boolean {
  try {
    const graph = parser('{"name":"__capability_probe__","dependencies":{"x":"1.0.0"}}');
    // 两个条件都要满足：只产节点不产边（或反之）说明解析器只完成了一半，
    // 那种状态画不出一张可用的依赖图，不该被算作「图通道存在」。
    return graph.nodes.length > 0 && graph.edges.length > 0;
  } catch (e) {
    log.warn('probeGraphSource failed', e);
    return false;
  }
}

/**
 * 能力位（`docs/需求分析.md` §61.10 的修法）。字段语义见
 * `src/shared/prerequisiteStatus.ts` 的模块头——那里是宿主与客户端**共用**的唯一来源。
 *
 * 历史：修前两处分支都写死 `builtin: true`，`/health` 恒 healthy、客户端空态无条件声称
 * 「内置分析可用」。cycle-111 拆位时 `builtin` 曾作为 `astSource` 的派生别名保留一个
 * 兼容窗口，cycle-118 按判据（`docs/agents/09` §9.4）移除。
 */
export function checkPrerequisites(ctx: Context, apiCompat?: ApiCompatLayer): PrerequisiteStatus {
  // AST 探针自身的失败不能把整条 `checkPrerequisites` 打成异常分支：那样 `codegraph` / `lens`
  // 的真实探测结果会一起被丢掉，一个适配器的问题就变成「所有上游都不可用」。
  let astSource = false;
  try {
    astSource = astSourceProbe ? astSourceProbe() === true : false;
  } catch (e) {
    log.warn('checkPrerequisites: astSource probe failed', e);
    astSource = false;
  }
  const graphSource = probeGraphSource();

  try {
    return {
      codegraph: isToolPresent(ctx, apiCompat, 'codegraphStatus', CODEGRAPH_TOOL_EVIDENCE),
      lens: isToolPresent(ctx, apiCompat, 'lensAnalyze', LENS_TOOL_EVIDENCE),
      astSource,
      graphSource,
    };
  } catch (e) {
    log.warn('checkPrerequisites failed', e);
    // 异常分支同样要如实报告两个内置通道：它们与 `ctx.tools` 无关，不该被上游探测的
    // 失败牵连成「内置也不可用」。`graphSource` 的自检在 try 之外已算好。
    return { codegraph: false, lens: false, astSource, graphSource };
  }
}

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
