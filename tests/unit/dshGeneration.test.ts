import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DSH_GENERATION_PROBES,
  DSH_GENERATIONS,
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

function hostCtx(overrides: Record<string, unknown> = {}) {
  return { tools: { get: vi.fn(() => undefined) }, ...overrides } as any;
}

/** Context shape that makes the client half detect gen2 through the `slots` service. */
function clientCtxGen2() {
  return { slots: { inject: () => {}, register: () => {} }, get: () => null } as any;
}

/** Context shape where only `spotlight` exists — the only 0.1-era marker. */
function clientCtxGen1() {
  return { get: (key: string) => (key === 'spotlight' ? {} : null) } as any;
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
    };
    expect(pkg.engines?.dsh).toBe(DSH_SUPPORTED_RANGE);
    expect(DSH_UNSUPPORTED_PROBE).toBe('0.4.0');
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
    // `remoteWebUi` is one of the two capabilities the unknown baseline withholds.
    const resolution = resolveFeatureFlags(unknownHost, (capability) => (
      capability === 'remoteWebUi' ? true : undefined
    ));
    expect(resolution.flags.remoteWebUi).toBe(true);
    expect(resolution.source).toBe('generation+probe');
    expect(resolution.probedUpgrades).toEqual(['remoteWebUi']);
  });

  it('never switches a granted capability OFF, whatever the probe says', () => {
    const gen2Host = detectHostVersion(hostCtx({ hostVersion: '0.2.0-rc.2' }));
    const resolution = resolveFeatureFlags(gen2Host, () => false);
    expect(resolution.flags).toEqual(FEATURE_FLAGS_BY_GENERATION.gen2);
    expect(resolution.probedUpgrades).toEqual([]);
    expect(resolution.source).toBe('generation');
  });

  it('does not mutate the shared generation table', () => {
    expect(FEATURE_FLAGS_BY_GENERATION.unknown.remoteWebUi).toBe(false);
    resolveFeatureFlags(unknownHost, (capability) => (capability === 'remoteWebUi' ? true : undefined));
    expect(FEATURE_FLAGS_BY_GENERATION.unknown.remoteWebUi).toBe(false);
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
    // No version string, no upstream codegraph tool → generation unknown. The remote-web-ui
    // service is still visible, so the capability is granted instead of falling to the
    // conservative baseline.
    const ctx = {
      hostVersion: 'garbage',
      get: (k: string) => (k === 'remoteWebUI' ? {} : undefined),
      tools: { get: () => undefined },
    } as any;
    const info = detectHostVersion(ctx);
    expect(info.generation).toBe('unknown');
    const flags = createFeatureFlags(info, createHostCapabilityProbe(ctx));
    expect(flags.remoteWebUi).toBe(true);
    expect(flags.incrementalBootstrap).toBe(false);
  });
});
