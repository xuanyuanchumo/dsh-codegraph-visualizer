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
  DSH_UNSUPPORTED_PROBES,
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
 * 求值一个 semver 范围是否覆盖某版本——**忠实实现 node-semver 的默认模式语义**。
 *
 * ## 为什么不能自己简化（cycle-141 第三轮修正）
 *
 * 本函数此前把预发布标签当普通分量比较（`cmp('0.3.0-rc.2','0.2.0-rc.2') >= 0` 直接通过），
 * 与 node-semver 的真实行为**不一致**。真实规则（`Range.prototype.test` → `testSet`）是：
 *
 * > 带预发布标签的版本，只有在范围里存在一个 **同 major.minor.patch 元组**、
 * > 且**自身带预发布标签**的比较符时，才可能匹配；否则一律 false。
 *
 * 后果：守卫放行了单段范围 `>=0.2.0-rc.2 <0.4.0-0`，而真实 semver 在默认模式下
 * **拒绝** `0.3.0-rc.2`（`semver@7.8.5` 实测 false）⇒ 受支持的 gen3 宿主装不上插件，
 * 而没有任何测试变红。守卫测的是它自己，不是安装门——
 * 这正是本仓「fixture 不得自造外部契约」那条教训的现场。
 *
 * 现在按真实规则实现，并支持 `||` 分支（段内 AND；预发布元组规则**按分支**应用，
 * 与 node-semver 的 `this.set` 数组语义一致）。`includePrerelease` 选项暴露出来，
 * 因为**两种模式都要断言**：宿主实际用 `true`（cycle-110 §3.3 由「插件在
 * 0.2.1-rc.3 上能跑」反推），而市场校验器可能用默认的 `false`。
 *
 * 与 `tests/unit/manifest.test.ts` 的同名助手保持独立实现——两边都断言同一件事，
 * 复制一份比互相 import 更能暴露「其中一边被改坏」。
 */
function compareWithinRange(
  range: string,
  version: string,
  opts: { includePrerelease?: boolean } = {},
): boolean {
  const parse = (v: string): { core: number[]; pre: string } => {
    const [core = '0', pre = ''] = v.split('-', 2);
    return { core: core.split('.').map(Number), pre };
  };
  const cmpCore = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i += 1) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
  };
  const cmp = (a: string, b: string): number => {
    const av = parse(a);
    const bv = parse(b);
    const core = cmpCore(av.core, bv.core);
    if (core !== 0) return core;
    if (av.pre === bv.pre) return 0;
    if (av.pre === '') return 1; // release > prerelease
    if (bv.pre === '') return -1;
    return av.pre < bv.pre ? -1 : 1;
  };

  const v = parse(version);
  // `||` 是 OR；每段内部是 AND；预发布元组规则按段应用。
  return range.split('||').some((branch) => {
    const parts = branch.split(/\s+/).filter(Boolean);
    // 1) 所有比较符必须满足（元组 + 预发布比较）。
    for (const part of parts) {
      const ok = part.startsWith('>=')
        ? cmp(version, part.slice(2)) >= 0
        : part.startsWith('<')
          ? cmp(version, part.slice(1)) < 0
          : false;
      if (!ok) return false;
    }
    // 2) 预发布元组规则（node-semver 默认模式）：version 带预发布时，
    //    本段必须存在一个同元组且自身带预发布标签的比较符。
    if (opts.includePrerelease === true) return true;
    if (v.pre === '') return true;
    return parts.some((part) => {
      const ref = parse(part.replace(/^[<>]=?/, ''));
      return ref.pre !== '' && cmpCore(ref.core, v.core) === 0;
    });
  });
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
    // cycle-110：探针从 `0.4.0` 换成 `0.4.0-rc.1`。理由是 `0.4.0` 在旧上界下**本来就**被拒，
    // 对「上界太宽」这类缺陷不敏感；真正的缺口是 gen4 的**预发布**。
    expect(DSH_UNSUPPORTED_PROBE).toBe('0.4.0-rc.1');
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

  // cycle-110：上界探针必须是**一对**，否则「改宽」和「改窄」都只有一半被守住。
  // 背景：`engines.dsh` 在 0.2.1-alpha.3 起是强制门；旧上界 `<0.4.0` 在
  // includePrerelease 语义下放行 `0.4.0-rc.1`（gen4 预发布），实测见
  // docs/research/dsh-round110-规范与破坏性变更.md §4。
  it('excludes every gen4 probe, including the prerelease the old upper bound let through', () => {
    for (const probe of DSH_UNSUPPORTED_PROBES) {
      expect(compareWithinRange(DSH_SUPPORTED_RANGE, probe), `${DSH_SUPPORTED_RANGE} must NOT cover ${probe}`).toBe(false);
    }
    expect(compareWithinRange(DSH_SUPPORTED_RANGE, '0.4.0-rc.1')).toBe(false);
    expect(compareWithinRange(DSH_SUPPORTED_RANGE, '0.4.0-alpha.1')).toBe(false);
    expect(compareWithinRange(DSH_SUPPORTED_RANGE, '0.4.0-0')).toBe(false);
  });

  it('still covers the whole gen3 line after tightening the upper bound (改窄守卫)', () => {
    // 收紧上界最容易犯的错是顺手把 0.3 的预发布也排掉 —— 那会让受支持的 gen3 宿主
    // 装不上本插件。这一条与上一条必须同时存在。**宿主模式**（includePrerelease: true）
    // 是 cycle-110 §3.3 反推出的实际求值模式。
    const HOST = { includePrerelease: true } as const;
    for (const version of ['0.3.0-rc.1', '0.3.0-rc.2', '0.3.0', '0.3.7']) {
      expect(compareWithinRange(DSH_SUPPORTED_RANGE, version, HOST), `${DSH_SUPPORTED_RANGE} must cover ${version}`).toBe(true);
    }
    // 下限侧的同一对：0.2 线（含本机实跑宿主）必须仍被覆盖，gen1 必须仍被排除。
    for (const version of ['0.2.0-rc.2', '0.2.1-rc.3', '0.2.1', '0.2.9']) {
      expect(compareWithinRange(DSH_SUPPORTED_RANGE, version, HOST), `${DSH_SUPPORTED_RANGE} must cover ${version}`).toBe(true);
    }
    for (const version of ['0.1.7-rc.1', '0.1.7-rc.2', '0.1.9']) {
      expect(compareWithinRange(DSH_SUPPORTED_RANGE, version, HOST), `${DSH_SUPPORTED_RANGE} must NOT cover ${version}`).toBe(false);
    }
  });

  /**
   * cycle-141 第三轮修正：**默认模式**（`includePrerelease: false`）下的 gen3 覆盖。
   *
   * ## 缺陷现场
   *
   * 单段范围 `>=0.2.0-rc.2 <0.4.0-0` 在默认模式下**拒绝** 0.3.0 的全部预发布：
   * node-semver 的预发布元组规则要求「范围内存在一个同 major.minor.patch 元组、
   * 且自身带预发布标签的比较符」，而该范围的两个比较符分别落在 0.2.0 与 0.4.0 元组上，
   * **没有任何一个在 0.3.0 上** ⇒ `0.3.0-rc.1`/`0.3.0-rc.2` 均 `false`（`semver@7.8.5` 实测）。
   *
   * 市场校验器若用默认模式，受支持的 gen3 宿主就装不上本插件
   * （`awesome-dsh-plugin/contributing.md` 对同一个坑给出同一条建议：用显式 `||` 分支）。
   *
   * ## 断言的三件事
   *
   * 1. 新范围在默认模式下覆盖整个 gen3 线（含 `0.3.0-0` 这一 semver 最小预发布）；
   * 2. **反例**：单段旧范围在默认模式下**不**覆盖 `0.3.0-rc.2` —— 这是「真的修好了」的证据，
   *    而不是「守卫恰好放行」；
   * 3. gen4 的全部预发布在两种模式下都仍被排除（收紧没有被放松）。
   */
  it('covers the gen3 prerelease line even in semver DEFAULT mode (the || branch fix)', () => {
    for (const version of ['0.3.0-0', '0.3.0-rc.1', '0.3.0-rc.2', '0.3.0', '0.3.7']) {
      expect(compareWithinRange(DSH_SUPPORTED_RANGE, version), `${DSH_SUPPORTED_RANGE} must cover ${version} in DEFAULT mode`).toBe(true);
    }
    // 反例：旧单段范围在默认模式下漏掉 gen3 预发布。
    expect(compareWithinRange('>=0.2.0-rc.2 <0.4.0-0', '0.3.0-rc.2')).toBe(false);
    expect(compareWithinRange('>=0.2.0-rc.2 <0.4.0-0', '0.3.0-rc.1')).toBe(false);
    // gen4 预发布在两种模式下都必须排除。
    for (const version of ['0.4.0-0', '0.4.0-alpha.1', '0.4.0-rc.1', '0.4.0']) {
      expect(compareWithinRange(DSH_SUPPORTED_RANGE, version), `${DSH_SUPPORTED_RANGE} must NOT cover ${version} in DEFAULT mode`).toBe(false);
    }
  });

  // 本机真实运行宿主。这条用例把「发布线序号」与「本模型的代际」钉在一起：
  // 0.2.1-rc.3 是比 0.2.0-rc.2 更新的**发布**，但按 minor 仍归 gen2。
  // 混用两者会得出「gen3 已真机验证」的错误结论（gen3 = 0.3.x，至今未发布）。
  it('classifies the live host 0.2.1-rc.3 as gen2, not as a new generation', () => {
    const live = parseDshVersion('0.2.1-rc.3');
    expect(live).toMatchObject({ major: 0, minor: 2, patch: 1, prerelease: 'rc.3', generation: 'gen2' });
    expect(DSH_PROMISED_GENERATIONS).toContain(live.generation as 'gen2');
    expect(live.generation).not.toBe('gen3');
    // 而同一条发布线里的 `0.2.1-alpha.3` 已经带来破坏性变更（engines.dsh 判据）——
    // 这正是「代际不是兼容性判据」的证据：两版同属 gen2。
    expect(parseDshVersion('0.2.1-alpha.3').generation).toBe('gen2');
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
