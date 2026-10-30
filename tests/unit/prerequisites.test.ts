import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectCodegraphCli,
  checkPrerequisites,
  extractWorkspacePaths,
  findWorkspacePath,
  resolveWorkspaceRoots,
  setAstSourceProbe,
  probeGraphSource,
} from '../../src/host/prerequisites.ts';
import { makePrerequisiteStatus } from '../helpers.ts';
import type { Context } from '@deepseek-ai/cordis';

type MockCtx = Context & {
  tools: { get: ReturnType<typeof vi.fn> };
};

describe('checkPrerequisites', () => {
  it('returns codegraph true when codegraph_status tool exists', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_status' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
    expect(result.lens).toBe(false);
  });

  it('returns codegraph true when codegraph_graph tool exists (fallback)', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_graph' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
  });

  it('returns codegraph true when codegraph_query tool exists (fallback)', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_query' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
  });

  it('returns lens true when lens_analyze tool exists', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'lens_analyze' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.lens).toBe(true);
    expect(result.codegraph).toBe(false);
  });

  it('returns lens true when only lens_impact exists (fallback)', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'lens_impact' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.lens).toBe(true);
    expect(result.codegraph).toBe(false);
  });

  it('detects the upstream plugin through the tool it actually contributes', () => {
    // dsh-codegraph@0.1.3 declares exactly one tool in dsh.plugin.json: contributes.tools =
    // ["mcp__codegraph__codegraph_explore"]. Keying presence off codegraph_status alone
    // reported "prerequisite missing" on a host that had the plugin installed (J0 finding).
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'mcp__codegraph__codegraph_explore' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.codegraph).toBe(true);
    expect(result.lens).toBe(false);
  });

  it('prefers the name resolved by the compat layer', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_status' ? {} : undefined)) },
    } as unknown as MockCtx;
    const apiCompat = {
      getAvailableToolName: vi.fn((_ctx: unknown, key: string) => (key === 'codegraphStatus' ? 'codegraph_status' : null)),
    } as unknown as NonNullable<Parameters<typeof checkPrerequisites>[1]>;
    const result = checkPrerequisites(ctx, apiCompat);
    expect(result.codegraph).toBe(true);
    expect(apiCompat.getAvailableToolName).toHaveBeenCalledWith(ctx, 'codegraphStatus');
  });

  it('falls back to the evidence list when the compat layer resolves nothing', () => {
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'mcp__codegraph__codegraph_explore' ? {} : undefined)) },
    } as unknown as MockCtx;
    const apiCompat = {
      getAvailableToolName: vi.fn(() => null),
    } as unknown as NonNullable<Parameters<typeof checkPrerequisites>[1]>;
    const result = checkPrerequisites(ctx, apiCompat);
    expect(result.codegraph).toBe(true);
  });

  it('returns both upstream bits false when no tools exist', () => {
    const ctx = {
      tools: { get: vi.fn(() => undefined) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual(makePrerequisiteStatus({ graphSource: true }));
  });

  it('returns both upstream bits false when ctx.tools.get throws', () => {
    const ctx = {
      tools: { get: vi.fn(() => { throw new Error('boom'); }) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual(makePrerequisiteStatus({ graphSource: true }));
  });
});

/**
 * 能力位拆分（cycle-111 / P0-N3，出处 `docs/需求分析.md` §61.10）。
 *
 * 修前 `checkPrerequisites` 在**两个分支里都硬编码 `builtin: true`**，于是：
 *   · `/health` 的 `healthy = codegraph || lens || builtin` 恒真，「degraded」永不出现；
 *   · 客户端空态无条件承诺「降级模式 — 使用内置 TreeSitter 和依赖分析」，
 *     而内置的图产出通道只有 manifest 依赖图，`fetchMergedGraph` 的 auto 分支只记日志不产节点。
 *
 * 下面把「AST 分析通道」与「图数据通道」当成两个独立能力来钉。
 */
describe('checkPrerequisites — capability bits (P0-N3)', () => {
  function ctxWithNoTools(): MockCtx {
    return { tools: { get: vi.fn(() => undefined) } } as unknown as MockCtx;
  }

  afterEach(() => {
    // 模块级探针必须复位：它跨用例存活，泄漏一条会让后续用例读到上一个适配器的判断。
    setAstSourceProbe(null);
  });

  it('reports astSource true when the registered probe says the AST channel is up', () => {
    const dispose = setAstSourceProbe(() => true);
    const result = checkPrerequisites(ctxWithNoTools());
    expect(result.astSource).toBe(true);
    dispose();
  });

  it('reports astSource false when the registered probe says the AST channel is down', () => {
    const dispose = setAstSourceProbe(() => false);
    const result = checkPrerequisites(ctxWithNoTools());
    expect(result.astSource).toBe(false);
    dispose();
  });

  it('reports astSource false when no probe has been registered at all', () => {
    // 缺省方向是 false（不知道 ≠ 有）。写成 true 正是本轮要修的缺陷，
    // 而这条用例是唯一能抓住"把缺省改回 true"的地方（那时探针根本没被调用过）。
    setAstSourceProbe(null);
    const result = checkPrerequisites(ctxWithNoTools());
    expect(result.astSource).toBe(false);
  });

  it('keeps the upstream bits honest when the AST probe itself throws', () => {
    // 一个适配器的异常不该把 codegraph/lens 的真实探测结果一起丢掉 ——
    // 那会把「AST 通道坏了」放大成「所有上游都不可用」。
    setAstSourceProbe(() => { throw new Error('probe boom'); });
    const ctx = {
      tools: { get: vi.fn((name: string) => (name === 'codegraph_status' ? {} : undefined)) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result.astSource).toBe(false);
    expect(result.codegraph).toBe(true);
    expect(result.lens).toBe(false);
  });

  it('probeGraphSource really runs the parser instead of returning a constant', () => {
    // 这条用例是 M5 变异的杀手。2026-10-29 实测：把 `checkPrerequisites` 里的
    // `probeGraphSource()` 换成字面量 `true`，**36 条用例全绿** —— 因为其余用例都在
    // 断言"graphSource 为 true"，而恒真式也满足它。能力位的**正面**断言无法区分
    // 「真的探测过」与「写死为真」，所以必须有一条用例能让探针**返回 false**。
    // 下面三条（空产出 / 半产出 / 抛异常）就是那个反向面。
    //
    // 这一条只钉默认参数指向真实解析器：不传参时它在当前环境应为 true。
    const probed = probeGraphSource();
    expect(typeof probed).toBe('boolean');
    expect(probed).toBe(true);
  });

  it('probeGraphSource returns false when the parser produces nothing', () => {
    // 第二面：解析器产出为空 ⇒ 探针必须为 false。这条把「结果真的来自解析器」
    // 从"看起来像"变成"可观测"：把实现写成 `return true` 时它会红。
    //
    // 走**注入**而不是 spy：ESM 静态导入的绑定在 `prerequisites.ts` 的调用点已固化，
    // `vi.spyOn(DependencyAdapter, ...)` 改不到那一份引用 —— 那样写的用例会永远绿。
    expect(probeGraphSource(() => ({ nodes: [], edges: [] }))).toBe(false);
  });

  it('probeGraphSource requires BOTH nodes and edges', () => {
    // 只有一半产出说明解析器没完成工作，画不出一张可用的依赖图。
    // `&&` 与 `||` 在这里只差一个字符，而两者看起来都"合理" —— 各自钉一次。
    expect(probeGraphSource(() => ({ nodes: [{}], edges: [] }))).toBe(false);
    expect(probeGraphSource(() => ({ nodes: [], edges: [{}] }))).toBe(false);
    expect(probeGraphSource(() => ({ nodes: [{}], edges: [{}] }))).toBe(true);
  });

  it('probeGraphSource returns false when the parser throws', () => {
    expect(probeGraphSource(() => { throw new Error('parser exploded'); })).toBe(false);
  });

  it('reports graphSource true because the manifest dependency parser is present', () => {
    // `graphSource` 的判据是**跑一遍** `parsePackageJson` 这段固定输入，不是写死 true。
    // 恒真会让 `/health` 重新变回永不 degraded，所以这条用例钉的是"真的执行了自检"。
    const result = checkPrerequisites(ctxWithNoTools());
    expect(result.graphSource).toBe(true);
  });

  it('reports astSource faithfully (alias era is over, cycle-118)', () => {
    // cycle-111 曾把 `builtin` 作为 `astSource` 的派生别名输出；cycle-118 起别名已移除，
    // `checkPrerequisites` 只产出四个真实位。这条用例钉的是 astSource 本身的保真度。
    const disposeTrue = setAstSourceProbe(() => true);
    expect(checkPrerequisites(ctxWithNoTools()).astSource).toBe(true);
    disposeTrue();
    setAstSourceProbe(() => false);
    expect(checkPrerequisites(ctxWithNoTools()).astSource).toBe(false);
  });

  it('gives the same astSource/graphSource values in the exception branch', () => {
    // 异常分支曾经也硬编码 builtin: true（cycle-111 之前）。两个内置通道与 ctx.tools 无关，
    // 不该被上游探测的失败牵连成"不可用"——但也不该反过来变成 true。
    setAstSourceProbe(() => true);
    const ctx = {
      tools: { get: vi.fn(() => { throw new Error('boom'); }) },
    } as unknown as MockCtx;
    const result = checkPrerequisites(ctx);
    expect(result).toEqual({
      codegraph: false,
      lens: false,
      astSource: true,
      graphSource: true,
    });
  });

  it('unregistering the probe restores the false default', () => {
    const dispose = setAstSourceProbe(() => true);
    expect(checkPrerequisites(ctxWithNoTools()).astSource).toBe(true);
    dispose();
    expect(checkPrerequisites(ctxWithNoTools()).astSource).toBe(false);
  });

  it('a stale dispose does not clear a newer probe', () => {
    // 同一进程内重新加载插件（HMR / profile 重载）会让两轮登记的注销函数同时存在。
    // 旧轮次的 dispose 若无条件清空，会把新轮次刚登记的探针一起抹掉 ——
    // 症状是「重载后 AST 能力位突然变成不可用」，且没有任何报错。
    const disposeOld = setAstSourceProbe(() => false);
    setAstSourceProbe(() => true);
    disposeOld();
    expect(checkPrerequisites(ctxWithNoTools()).astSource).toBe(true);
  });
});

describe('extractWorkspacePaths', () => {
  it('returns paths from workspaceRegistry when available', () => {
    const wsr = { list: () => [{ path: '/repo1' }, { path: '/repo2' }] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/repo1', '/repo2']);
  });

  it('filters out undefined paths from workspaceRegistry', () => {
    const wsr = { list: () => [{ path: '/repo1' }, {}, { path: undefined }] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/repo1']);
  });

  it('falls back to sessions when workspaceRegistry empty', () => {
    const wsr = { list: () => [] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
      sessions: { list: () => [{ header: { cwd: '/sess1' } }, { header: { cwd: '/sess2' } }] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/sess1', '/sess2']);
  });

  it('dedupes session cwd paths', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => [
        { header: { cwd: '/sess1' } },
        { header: { cwd: '/sess1' } },
        { header: { cwd: '/sess2' } },
      ] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual(['/sess1', '/sess2']);
  });

  it('falls back to process.cwd() when no workspace or sessions', () => {
    const ctx = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when workspaceRegistry.list throws', () => {
    const wsr = { list: () => { throw new Error('boom'); } };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('resolveWorkspaceRoots reports which branch produced the roots (§31.7 observability)', () => {
    const wsr = { list: () => [{ path: '/repo1' }] };
    const fromRegistry = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    expect(resolveWorkspaceRoots(fromRegistry)).toEqual({ paths: ['/repo1'], source: 'registry' });

    const emptyRegistry = { list: () => [] };
    const fromSessions = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? emptyRegistry : undefined),
      workspaceRegistry: emptyRegistry,
      sessions: { list: () => [{ header: { cwd: '/sess1' } }] },
    } as unknown as MockCtx;
    expect(resolveWorkspaceRoots(fromSessions)).toEqual({ paths: ['/sess1'], source: 'sessions' });

    const fromCwd = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    expect(resolveWorkspaceRoots(fromCwd)).toEqual({ paths: [process.cwd()], source: 'cwd' });
  });

  it('extractWorkspacePaths stays a thin wrapper over resolveWorkspaceRoots', () => {
    const ctx = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    expect(extractWorkspacePaths(ctx)).toEqual(resolveWorkspaceRoots(ctx).paths);
  });

  it('falls back to process.cwd() when sessions.list throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });

  it('falls back to process.cwd() when sessions have no cwd', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => [{ header: {} }, {}] },
    } as unknown as MockCtx;
    const result = extractWorkspacePaths(ctx);
    expect(result).toEqual([process.cwd()]);
  });
});

describe('findWorkspacePath', () => {
  it('returns first path from workspaceRegistry', () => {
    const wsr = { list: () => [{ path: '/repo1' }, { path: '/repo2' }] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe('/repo1');
  });

  it('falls back to sessions when workspaceRegistry empty', () => {
    const wsr = { list: () => [] };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
      sessions: { list: () => [{ header: { cwd: '/sess1' } }] },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe('/sess1');
  });

  it('falls back to process.cwd() when nothing available', () => {
    const ctx = { tools: { get: vi.fn() }, get: vi.fn(() => undefined) } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when workspaceRegistry throws', () => {
    const wsr = { list: () => { throw new Error('boom'); } };
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn((key: string) => key === 'workspaceRegistry' ? wsr : undefined),
      workspaceRegistry: wsr,
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when sessions throws', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => { throw new Error('boom'); } },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });

  it('falls back to process.cwd() when sessions have no cwd', () => {
    const ctx = {
      tools: { get: vi.fn() },
      get: vi.fn(() => undefined),
      sessions: { list: () => [{ header: {} }] },
    } as unknown as MockCtx;
    expect(findWorkspacePath(ctx)).toBe(process.cwd());
  });
});

describe('detectCodegraphCli', () => {
  it('returns a boolean indicating whether codegraph CLI is available', async () => {
    const result = await detectCodegraphCli();
    expect(typeof result).toBe('boolean');
  });
});