import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DSH_GENERATION_PROBES,
  DSH_GENERATIONS,
  DSH_LEGACY_GENERATIONS,
  DSH_PROMISED_GENERATIONS,
  DSH_SUPPORTED_RANGE,
  DSH_UNSUPPORTED_PROBE,
  generationOfVersion,
  parseDshVersion,
  probeReleaseFor,
  type DshGeneration,
} from '../../src/shared/dshGeneration.ts';
import { detectHostVersion } from '../../src/host/compat/HostVersionDetector.ts';
import { detectClientVersion } from '../../src/client/compat/ClientVersionDetector.ts';
import {
  FEATURE_FLAGS_BY_GENERATION,
  resolveFeatureFlags,
  createFeatureFlags,
} from '../../src/host/compat/FeatureFlags.ts';
import { TOOL_MAPPING_BY_GENERATION } from '../../src/host/compat/ApiCompatLayer.ts';
import { createHostCapabilityProbe } from '../../src/host/compat/HostCapabilityProbe.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALL_GENERATIONS: DshGeneration[] = ['gen1', 'gen2', 'gen3', 'unknown'];

/**
 * 求值 `>=A <B` 形态的窗口是否覆盖某版本。仅支持本项目声明的那一种形态。
 * 与 `tests/unit/manifest.test.ts` 的同名助手保持独立实现——两边都断言同一件事，
 * 复制一份比互相 import 更能暴露「其中一边被改坏」。
 */
function compareWithinRange(range: string, version: string): boolean {
  const parse = (v: string): [number[], string] => {
    const [core = '0', pre = ''] = v.split('-', 2);
    return [core.split('.').map(Number), pre];
  };
  const cmp = (a: string, b: string): number => {
    const [aCore, aPre] = parse(a);
    const [bCore, bPre] = parse(b);
    for (let i = 0; i < 3; i += 1) {
      const diff = (aCore[i] ?? 0) - (bCore[i] ?? 0);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    if (aPre === bPre) return 0;
    if (aPre === '') return 1;
    if (bPre === '') return -1;
    return aPre < bPre ? -1 : 1;
  };
  return range.split(/\s+/).filter(Boolean).every((part) => (
    part.startsWith('>=') ? cmp(version, part.slice(2)) >= 0 : cmp(version, part.slice(1)) < 0
  ));
}

function hostCtx(overrides: Record<string, unknown> = {}) {
  return { tools: { get: vi.fn(() => undefined) }, ...overrides } as any;
}

/**
 * gen2 客户端最小形状：命中一个 0.2 独有服务。
 *
 * cycle-83 之前这里只给 `slots`，但 `slots`/`sidebarRightTabs`/`documentPreviews`
 * 都是**两代都有**的服务，用它定代会把 gen1 误判成 gen2。真正的 0.2 独有标记只有
 * `pluginNavigation` 与 `userQuestionPanels`（见 `ClientVersionDetector.GEN2_ONLY_SERVICES`）。
 */
function clientCtxGen2() {
  return { slots: { inject: () => {}, register: () => {} }, get: (key: string) => (key === 'pluginNavigation' ? {} : null) } as any;
}

/**
 * gen1 宿主的最小形状：只有 slot 系统在场，且**没有任何** 0.2 独有服务。
 *
 * cycle-83 之前这里探测 `spotlight`，但该服务在任何 DSH 代都不存在（幻影），因此旧夹具
 * 断言的是一条永不执行的分支。现在用两代都存在的 `sidebarRightTabs` 作「身处 0.1 线」的
 * 下界证据（见 `ClientVersionDetector.GEN2_ONLY_SERVICES` 的注释）。
 */
function clientCtxGen1() {
  return { get: (key: string) => (key === 'sidebarRightTabs' ? {} : null) } as any;
}

describe('dshGeneration window', () => {
  it('maps the modelled minor lines onto their generation', () => {
    expect(generationOfVersion(0, 1)).toBe('gen1');
    expect(generationOfVersion(0, 2)).toBe('gen2');
    expect(generationOfVersion(0, 3)).toBe('gen3');
  });

  it('treats every line above the window as gen3 (forward compatibility), not as unknown', () => {
    expect(generationOfVersion(0, 4)).toBe('gen3');
    expect(generationOfVersion(0, 99)).toBe('gen3');
    expect(generationOfVersion(1, 0)).toBe('gen3');
    expect(generationOfVersion(7, 3)).toBe('gen3');
  });

  it('leaves only pre-window and non-0.x majors unclassified', () => {
    expect(generationOfVersion(0, 0)).toBe('unknown');
  });

  it('parses a leading v, a prerelease tag and a plain release identically', () => {
    const bare = parseDshVersion('0.2.0');
    expect(parseDshVersion('v0.2.0')).toMatchObject({ major: 0, minor: 2, patch: 0, prerelease: null });
    expect(bare.generation).toBe('gen2');
    expect(parseDshVersion('0.2.0-rc.2')).toMatchObject({ prerelease: 'rc.2', generation: 'gen2' });
    expect(parseDshVersion('0.3.1-beta.1')).toMatchObject({ patch: 1, prerelease: 'beta.1', generation: 'gen3' });
  });

  it('degrades to unknown for anything unparseable', () => {
    for (const raw of ['', 'unknown', 'next', '0.2', 'x.y.z']) {
      expect(parseDshVersion(raw).generation, raw).toBe('unknown');
      expect(parseDshVersion(raw).raw).toBe(raw);
    }
  });
});

describe('generation model is the single source of truth', () => {
  it('agrees with the manifest window declared in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      engines?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.engines?.dsh).toBe(DSH_SUPPORTED_RANGE);
    expect(DSH_UNSUPPORTED_PROBE).toBe('0.4.0');
    // cycle-92 裁定：宿主下限抬高到 0.2.0-rc.2，peer 门同步去掉 0.1.7 线。
    // 三处（engines.dsh / peerDependencies / DSH_SUPPORTED_RANGE）必须同时收紧，
    // 否则会出现「声明支持 gen1、peer 门却拒绝它」这种自相矛盾的安装体验。
    expect(pkg.engines?.dsh).not.toContain('0.1.');
    for (const key of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools']) {
      expect(pkg.peerDependencies?.[key], `${key} peer range must drop the 0.1 line`).not.toContain('0.1.');
      expect(pkg.peerDependencies?.[key]).toContain('^0.2.0-rc.2');
    }
  });

  it('partitions every modelled generation into exactly one of promised / legacy', () => {
    // 分类器仍然认得 gen1，但承诺窗口只覆盖 gen2+gen3。两清单必须恰好划分全集，
    // 且互不相交——否则「某代算不算被支持」会有两个答案。
    const promised = [...DSH_PROMISED_GENERATIONS] as DshGeneration[];
    const legacy = [...DSH_LEGACY_GENERATIONS] as DshGeneration[];
    expect([...promised, ...legacy].sort()).toEqual([...DSH_GENERATIONS].sort());
    expect(promised.filter((g) => legacy.includes(g))).toEqual([]);
    expect(promised).toContain('gen2');
    expect(promised).toContain('gen3');
    expect(legacy).toEqual(['gen1']);
  });

  it('keeps the promised window and the legacy tolerance in the declared range', () => {
    // 下限必须恰好落在第一个被承诺代际的代表版本上，且**不**覆盖遗留代际。
    // 这条断言是「抬高下限」这件事本身的机器守卫：把 DSH_SUPPORTED_RANGE 改回
    // >=0.1.7-rc.2 会让它立刻变红。
    const lowerBound = DSH_SUPPORTED_RANGE.split(' ')[0]!.slice(2);
    expect(lowerBound).toBe(DSH_GENERATION_PROBES.gen2);
    expect(parseDshVersion(lowerBound).generation).toBe('gen2');
    expect(parseDshVersion(DSH_GENERATION_PROBES.gen1).generation).toBe('gen1');
    expect(compareWithinRange(DSH_SUPPORTED_RANGE, DSH_GENERATION_PROBES.gen1)).toBe(false);
  });

  it('parses every generation probe back to the generation it represents', () => {
    for (const generation of DSH_GENERATIONS) {
      const probe = DSH_GENERATION_PROBES[generation];
      expect(parseDshVersion(probe).generation, `${generation} probe ${probe}`).toBe(generation);
      expect(probeReleaseFor(generation)).toBe(probe);
    }
    expect(probeReleaseFor('unknown')).toBeNull();
  });

  it('classifies the same host the same way on the host and client halves', () => {
    // Same raw string through both detectors must yield the same generation, which is what
    // the two `isGen2()`-style branches act on.
    for (const raw of ['0.1.7-rc.2', '0.2.0-rc.2', '0.3.0-rc.2', '0.4.0', '1.0.0']) {
      const expected = parseDshVersion(raw).generation;
      expect(detectHostVersion(hostCtx({ hostVersion: raw })).generation, raw).toBe(expected);
      // The client half never sees a version string here, so it can only agree on the
      // generations its API-shape markers can express.
      if (expected === 'gen1' || expected === 'gen2') {
        const clientGeneration = expected === 'gen1'
          ? detectClientVersion(clientCtxGen1()).generation
          : detectClientVersion(clientCtxGen2()).generation;
        expect(clientGeneration, raw).toBe(expected);
      }
    }
  });

  it('reports the same unknown shape on both halves when nothing can be detected', () => {
    const host = detectHostVersion(hostCtx());
    const client = detectClientVersion({ get: () => null } as any);
    expect(host.generation).toBe('unknown');
    expect(client.generation).toBe('unknown');
    expect(Object.keys(client).sort()).toEqual(['generation', 'major', 'minor', 'patch', 'raw']);
  });

  it('dates an unversioned host from its API shape on both halves', () => {
    // host: the upstream tool surface
    const host = detectHostVersion(hostCtx({
      tools: { get: (name: string) => (name === 'codegraph_incremental' ? { name } : undefined) },
    }));
    expect(host.generation).toBe('gen2');
    // client: the slots service
    expect(detectClientVersion(clientCtxGen2()).generation).toBe('gen2');
  });

  it('carries an adapter table for every generation the model can report', () => {
    for (const generation of ALL_GENERATIONS) {
      const flags = FEATURE_FLAGS_BY_GENERATION[generation];
      expect(flags, `FeatureFlags missing ${generation}`).toBeTruthy();
      const mapping = TOOL_MAPPING_BY_GENERATION[generation];
      expect(mapping, `ToolNameMapping missing ${generation}`).toBeTruthy();
      // No half-filled row: every capability/tool must be a definite boolean or name.
      expect(Object.values(flags).every((v) => typeof v === 'boolean'), `${generation} flags`).toBe(true);
      expect(
        Object.values(mapping).every((v) => v === null || typeof v === 'string'),
        `${generation} mapping`,
      ).toBe(true);
      expect(mapping.codegraphStatus, `${generation} status tool`).toBeTruthy();
    }
  });
});

describe('capability probing (forward compatibility)', () => {
  const unknownHost = detectHostVersion(hostCtx());

  it('switches an ungranted capability ON when the probe observes it', () => {
    // `incrementalBootstrap` 是 unknown 基线刻意扣留的能力之一（gen1 也没有）。
    const resolution = resolveFeatureFlags(unknownHost, (capability) => (
      capability === 'incrementalBootstrap' ? true : undefined
    ));
    expect(resolution.flags.incrementalBootstrap).toBe(true);
    expect(resolution.source).toBe('generation+probe');
    expect(resolution.probedUpgrades).toEqual(['incrementalBootstrap']);
  });

  it('never switches a granted capability OFF, whatever the probe says', () => {
    const gen2Host = detectHostVersion(hostCtx({ hostVersion: '0.2.0-rc.2' }));
    const resolution = resolveFeatureFlags(gen2Host, () => false);
    expect(resolution.flags).toEqual(FEATURE_FLAGS_BY_GENERATION.gen2);
    expect(resolution.probedUpgrades).toEqual([]);
    expect(resolution.source).toBe('generation');
  });

  it('does not mutate the shared generation table', () => {
    expect(FEATURE_FLAGS_BY_GENERATION.unknown.incrementalBootstrap).toBe(false);
    resolveFeatureFlags(unknownHost, (capability) => (capability === 'incrementalBootstrap' ? true : undefined));
    expect(FEATURE_FLAGS_BY_GENERATION.unknown.incrementalBootstrap).toBe(false);
  });

  it('treats a throwing or inconclusive probe as no evidence', () => {
    expect(createFeatureFlags(unknownHost, () => { throw new Error('probe exploded'); }))
      .toEqual(FEATURE_FLAGS_BY_GENERATION.unknown);
    expect(createFeatureFlags(unknownHost, () => undefined)).toEqual(FEATURE_FLAGS_BY_GENERATION.unknown);
    expect(createFeatureFlags(unknownHost, () => null)).toEqual(FEATURE_FLAGS_BY_GENERATION.unknown);
  });

  it('falls back to the generation table when no probe is supplied', () => {
    expect(createFeatureFlags(unknownHost)).toEqual(FEATURE_FLAGS_BY_GENERATION.unknown);
  });

  it('reports a service or tool as present, and absence as no evidence', () => {
    const withService = createHostCapabilityProbe({ get: (k: string) => (k === 'workspaceRegistry' ? {} : undefined), tools: { get: () => undefined } } as any);
    expect(withService('workspaceRegistry')).toBe(true);
    expect(withService('incrementalBootstrap')).toBeUndefined();

    const withTool = createHostCapabilityProbe({ get: () => undefined, tools: { get: (n: string) => (n === 'codegraph_bootstrap' ? {} : undefined) } } as any);
    expect(withTool('incrementalBootstrap')).toBe(true);

    const empty = createHostCapabilityProbe({ get: () => undefined, tools: { get: () => undefined } } as any);
    expect(empty('workspaceRegistry')).toBeUndefined();
    expect(empty('incrementalBootstrap')).toBeUndefined();
    expect(empty('crossRepo')).toBeUndefined(); // no evidence source modelled
  });

  it('degrades safely when the service or tool registry throws', () => {
    const exploding = createHostCapabilityProbe({
      get: () => { throw new Error('no services'); },
      tools: { get: () => { throw new Error('no tools'); } },
    } as any);
    expect(exploding('workspaceRegistry')).toBeUndefined();
    expect(exploding('incrementalBootstrap')).toBeUndefined();
  });

  it('gives a probe-visible capability to an otherwise unclassified host end to end', () => {
    // No version string, no upstream codegraph tool → generation unknown. The
    // workspaceRegistry service is still visible, so the capability is granted instead of
    // falling to the conservative baseline.
    const ctx = {
      hostVersion: 'garbage',
      get: (k: string) => (k === 'workspaceRegistry' ? {} : undefined),
      tools: { get: () => undefined },
    } as any;
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('unknown');
    const flags = createFeatureFlags(info, createHostCapabilityProbe(ctx));
    expect(flags.workspaceRegistry).toBe(true);
    expect(flags.incrementalBootstrap).toBe(false);
  });
});
