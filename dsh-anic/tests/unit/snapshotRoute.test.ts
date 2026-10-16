/**
 * snapshotRoute + 宿主入口 apply 单元测试。
 *
 * 契约锚点（全部转录自父工程与 DSH 宿主语义，见文件头注释）：
 *   - 路由注册形如 { kind:'exact', path, handler }，经 ctx.effect 承接 disposer
 *     （disposer 不丢弃 = 九条红线；宿主 effect 返回值即清理）；
 *   - 工作区解析链 registry → sessions.header.cwd → process.cwd()，逐请求重解析；
 *   - 200 响应带 no-store + CORS + X-ANIC-Snapshot-Digest；无 .cycles → 404（不是 500）；
 *   - 无 webServer → 返回 null（插件主体不受影响，多代宿主安全降级）；
 *   - apply()：有 effect 走 effect（label 声明 M1 四条路由），无 effect 直接注册。
 *
 * M1 演进说明（本文件的更新理由）：apply() 原先只注册 snapshotRoute 一条路由，M1 全功能面
 * 落地后改为经 routes/index.ts 的 registerAnicRoutes 聚合注册四条
 * （workflow-snapshot / step-trace / self-check / self/init）。**不变量不变**：
 * setup 仍在 effect 内执行、effect 返回的聚合 disposer 仍被宿主承接、且必须一次清干净
 * 全部 webServer 注册（本文件用 toHaveBeenCalledTimes(4) 把"逐个清"钉死，
 * 而不是只看"清过一次"——后者在聚合器只清第一条时会假绿）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSnapshotRoute, SNAPSHOT_ROUTE } from '../../src/host/snapshotRoute.ts';
import { STEP_TRACE_ROUTE } from '../../src/host/routes/stepTraceRoute.ts';
import { SELF_CHECK_ROUTE } from '../../src/host/routes/selfCheckRoute.ts';
import { SELF_INIT_ROUTE } from '../../src/host/routes/selfInitRoute.ts';
import { apply } from '../../src/index.ts';

const CLEANUPS: string[] = [];
function workspaceWithCycles(hasCycles: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'anic-ws-'));
  if (hasCycles) {
    const cycles = join(root, '.cycles');
    mkdirSync(cycles, { recursive: true });
    writeFileSync(join(cycles, 'config.yml'), 'autonomy_level: L2\n');
  }
  CLEANUPS.push(root);
  return root;
}
afterEach((): void => {
  while (CLEANUPS.length > 0) {
    const dir = CLEANUPS.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface CapturedResponse { status: number | null; headers: Record<string, string> | null; body: string | null }
function makeRes(): { res: unknown; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: null, headers: null, body: null };
  const res = {
    writeHead: (status: number, headers: Record<string, string>): void => { captured.status = status; captured.headers = headers; },
    end: (data?: string): void => { captured.body = data ?? null; },
  };
  return { res, captured };
}

interface RegisteredDef { kind: string; path: string; handler: (req: unknown, res: unknown) => void }
interface CtxSpec {
  root?: string;
  registryThrows?: boolean;
  withSessions?: boolean;
  disposerWorks?: boolean;
}
function makeCtx(spec: CtxSpec): { ctx: unknown; registered: RegisteredDef[]; webServerDisposer: () => void } {
  const registered: RegisteredDef[] = [];
  const webServerDisposer = vi.fn();
  const ctx: Record<string, unknown> = {
    webServer: {
      register: (...args: unknown[]): (() => void) => {
        // 两种调用形态：对象 {kind,path,handler} 或三参 (method,path,handler)
        if (typeof args[0] === 'object' && args[0] !== null) {
          registered.push(args[0] as RegisteredDef);
        } else if (typeof args[0] === 'string' && typeof args[1] === 'string') {
          registered.push({ kind: 'exact', path: args[1] as string, handler: args[2] as (req: unknown, res: unknown) => void });
        }
        return spec.disposerWorks === false ? undefined : webServerDisposer;
      },
    },
  };
  if (spec.root !== undefined) {
    if (spec.registryThrows) {
      ctx.workspaceRegistry = { list: (): unknown[] => { throw new Error('registry not mounted'); } };
    } else {
      ctx.workspaceRegistry = { list: (): { path?: string }[] => [{ path: spec.root }] };
    }
    if (spec.withSessions) ctx.sessions = { list: (): { header?: { cwd?: string } }[] => [{ header: { cwd: 'D:\\must-not-be-used' } }] };
  }
  return { ctx, registered, webServerDisposer };
}

describe('registerSnapshotRoute', () => {
  it('注册 exact 路由并返回 webServer 的 disposer（disposer 不丢弃）', () => {
    const { ctx, registered, webServerDisposer } = makeCtx({ root: workspaceWithCycles(true) });
    const disposer = registerSnapshotRoute(ctx);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.kind).toBe('exact');
    expect(registered[0]?.path).toBe(SNAPSHOT_ROUTE);
    expect(disposer).toBe(webServerDisposer);
  });

  it('无 webServer 时返回 null（跳过而非崩溃）', () => {
    expect(registerSnapshotRoute({})).toBeNull();
    expect(registerSnapshotRoute({ webServer: {} })).toBeNull();
  });

  it('200：no-store + CORS + 16 位内容指纹 + 快照计数', () => {
    const root = workspaceWithCycles(true);
    const { ctx, registered } = makeCtx({ root });
    registerSnapshotRoute(ctx);
    const { res, captured } = makeRes();
    registered[0]?.handler({}, res);
    expect(captured.status).toBe(200);
    expect(captured.headers?.['Cache-Control']).toBe('no-store');
    expect(captured.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(captured.headers?.['X-ANIC-Snapshot-Digest']).toMatch(/^[0-9a-f]{16}$/);
    const body = JSON.parse(captured.body ?? '{}') as { counts: { nodes: number }; autonomy: string };
    expect(body.counts.nodes).toBeGreaterThan(0);
    expect(body.autonomy).toBe('L2');
  });

  it('工作区无 .cycles → 404（未 init 项目是可用状态，不是错误）', () => {
    const root = workspaceWithCycles(false);
    const { ctx, registered } = makeCtx({ root });
    registerSnapshotRoute(ctx);
    const { res, captured } = makeRes();
    registered[0]?.handler({}, res);
    expect(captured.status).toBe(404);
    expect(String((JSON.parse(captured.body ?? '{}') as { error: string }).error)).toContain('no .cycles');
  });

  it('解析链：registry 优先于 sessions；registry 抛错落 sessions；两者皆无落 process.cwd', () => {
    const root = workspaceWithCycles(true);
    const mk = (over: { registry?: unknown; sessions?: unknown }): { ctx: unknown; registered: RegisteredDef[] } => {
      const base = makeCtx({ root });
      if ('registry' in over) (base.ctx as Record<string, unknown>).workspaceRegistry = over.registry;
      if ('sessions' in over) (base.ctx as Record<string, unknown>).sessions = over.sessions;
      registerSnapshotRoute(base.ctx);
      return base;
    };
    const ask = (registered: RegisteredDef[]): CapturedResponse => {
      const { res, captured } = makeRes();
      registered[0]?.handler({}, res);
      return captured;
    };
    const wsOf = (c: CapturedResponse): string => decodeURIComponent(String(c.headers?.['X-ANIC-Workspace']));

    // ① 优先级：registry 与 sessions 同在 → registry 赢（sessions 指向必不可能有效的路径作哨兵）
    const prio = mk({ sessions: { list: (): { header?: { cwd?: string } }[] => [{ header: { cwd: 'D:\\must-not-be-used' } }] } });
    expect(ask(prio.registered).status).toBe(200);
    expect(wsOf(ask(prio.registered))).toBe(root);

    // ② registry 抛错 → sessions 兜底（根换成 sessions 提供的另一个有效工作区）
    const root2 = workspaceWithCycles(true);
    const viaSessions = mk({
      registry: { list: (): unknown[] => { throw new Error('registry not mounted'); } },
      sessions: { list: (): { header?: { cwd?: string } }[] => [{ header: { cwd: root2 } }] },
    });
    expect(ask(viaSessions.registered).status).toBe(200);
    expect(wsOf(ask(viaSessions.registered))).toBe(root2);

    // ③ 两者皆无 → process.cwd（用无 .cycles 的临时目录作 cwd → 404 且 workspace=cwd）
    const emptyCwd = mkdtempSync(join(tmpdir(), 'anic-empty-'));
    const origCwd = process.cwd();
    process.chdir(emptyCwd);
    try {
      const viaCwd = mk({ registry: { list: (): unknown[] => { throw new Error('registry not mounted'); } } });
      delete (viaCwd.ctx as Record<string, unknown>).sessions;
      const c3 = ask(viaCwd.registered);
      expect(c3.status).toBe(404);
      expect((JSON.parse(c3.body ?? '{}') as { workspace: string }).workspace).toBe(emptyCwd);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('构建器抛错 → 500 且带 error 字段（响亮失败，不静默 200）', () => {
    const root = workspaceWithCycles(true);
    // workflow-graph.yaml 是目录 → readFileSync EISDIR（existsSync 通过而读取抛错）
    mkdirSync(join(root, '.cycles', 'workflow-graph.yaml'));
    const { ctx, registered } = makeCtx({ root });
    registerSnapshotRoute(ctx);
    const { res, captured } = makeRes();
    registered[0]?.handler({}, res);
    expect(captured.status).toBe(500);
    expect(String((JSON.parse(captured.body ?? '{}') as { error: string }).error)).toMatch(/EISDIR|EPERM|operation/i);
  });
});

describe('宿主入口 apply', () => {
  /** 全部路由（M1 四条 + M2-a 九条 + M2-b 四条 + M4 一条 + M5 四条 + M5-a 四条 + M7 四条 + M8 四条 + cycle-97 一条）。 */
  const ALL_ROUTES = [
    SNAPSHOT_ROUTE, STEP_TRACE_ROUTE, SELF_CHECK_ROUTE, SELF_INIT_ROUTE,
    // cycle-97 动态白盒数据面
    '/anic/api/invocations/live',
    '/anic/cycle/init', '/anic/cycle/advance', '/anic/cycle/close', '/anic/cycle/state', '/anic/cycle/list',
    '/anic/api/ledger', '/anic/api/ledger/append', '/anic/api/ledger/verify',
    '/anic/api/stack-probe',
    '/anic/api/seg-ledger', '/anic/api/seg-ledger/append', '/anic/api/seg-ledger/verify', '/anic/api/seg-ledger/init',
    '/anic/review',
    '/anic/api/trust', '/anic/api/autonomy', '/anic/api/breakers', '/anic/api/tech-debt',
    '/anic/governance/archive', '/anic/governance/budget', '/anic/governance/sweep', '/anic/governance/prune',
    // M7 自举闭环
    '/anic/self/evaluate', '/anic/self/gate-check', '/anic/self/iterate', '/anic/self/status',
    // M8 跨项目技能调用
    '/anic/skill/list', '/anic/skill/invoke', '/anic/evaluate', '/anic/iterate',
    // M11 技能内联 + 原生脚本
    '/anic/skill/install', '/anic/skill/status',
    '/anic/hitl-audit', '/anic/band-detect', '/anic/org-status', '/anic/fact-base', '/anic/plan-sync', '/anic/multi-agent-gate', '/anic/fix-loop',
    // M11 双向自举
    '/anic/self/dual-evaluate', '/anic/self/dual-advance', '/anic/self/dual-status',
    // M11 真实性审计
    '/anic/api/truth-audit',
  ];

  it('有 effect：setup 经 effect 执行并带 label；effect 的返回 disposer 由宿主承接', () => {
    const root = workspaceWithCycles(true);
    const { ctx, registered, webServerDisposer } = makeCtx({ root });
    const effect = vi.fn((fn: () => unknown, label?: string): unknown => {
      const routeDisposer = fn() as unknown;
      return (): void => { if (typeof routeDisposer === 'function') (routeDisposer as () => void)(); };
    });
    (ctx as Record<string, unknown>).effect = effect;
    apply(ctx);
    expect(effect).toHaveBeenCalledTimes(3); // skill(cycle-97) + routes + tools
    // label 必须点明是聚合注册（少一层即功能面缺失）
    expect(effect.mock.calls[0]?.[1]).toContain('dsh-anic: runtime skill');
    expect(effect.mock.calls[1]?.[1]).toContain('dsh-anic: routes');
    expect(effect.mock.calls[1]?.[1]).toContain('snapshot');
    // M1 全功能面：四条路由一次注册齐（少一条即功能面缺失）
    expect(registered.map((r) => r.path).sort()).toEqual([...ALL_ROUTES].sort());
    // effect 返回的清理被宿主拿走：调用 ROUTES 层（results[1]）必须**逐个**清掉
    // 全部注册，而不是只清第一条（聚合器 filter 掉 null 后逐个调用）。
    // results[0] 是 cycle-97 的技能注册层（stub 宿主无 skills → 空清理，另有断言）。
    (effect.mock.results[1]?.value as () => void)();
    expect(webServerDisposer).toHaveBeenCalledTimes(ALL_ROUTES.length);
    // 技能层清理可安全调用（registerRuntimeSkill 返回 null 时不得产生"非函数"爆炸）
    expect(() => { (effect.mock.results[0]?.value as () => void)(); }).not.toThrow();
  });

  it('无 effect：直接注册（不静默丢弃，异常宿主形态兜底）', () => {
    const root = workspaceWithCycles(true);
    const { ctx, registered } = makeCtx({ root });
    apply(ctx);
    expect(registered).toHaveLength(ALL_ROUTES.length);
    expect(registered.map((r) => r.path).sort()).toEqual([...ALL_ROUTES].sort());
  });
});
