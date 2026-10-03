// Single source of truth for "which generation of DSH are we running inside".
//
// Why this module exists: the generation window used to be written out four times —
// `src/host/compat/HostVersionDetector.ts`, `src/client/compat/ClientVersionDetector.ts`,
// `tests/unit/manifest.test.ts` (DSH_GENERATIONS) and `package.json` (engines.dsh) — each
// with its own copy of the thresholds. Nothing linked them, so widening the window in one
// place silently desynced the other three (the host half and the client half could classify
// the same host differently, which the two `isGen2()`-style branches act on).
//
// The window is derived from the DSH releases the manifest claims (`engines.dsh`), and
// `tests/unit/dshGeneration.test.ts` fails if the manifest and this module drift apart.
//
// Compatibility is declarative only (dsh-package-manifest/README.md:93: installers do not
// enforce `engines.dsh`), so this module classifies; it never gates loading.

/** DSH host generations this plugin models. `unknown` is a first-class outcome, not an error. */
export type DshGeneration = 'gen1' | 'gen2' | 'gen3' | 'unknown';

/** The generations that actually correspond to a released DSH line. */
export const DSH_GENERATIONS = ['gen1', 'gen2', 'gen3'] as const;

export type DshKnownGeneration = (typeof DSH_GENERATIONS)[number];

export interface DshVersionInfo {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  generation: DshGeneration;
}

/**
 * One representative release per generation. This is the list `engines.dsh` must cover,
 * and the list the host/client detectors must classify identically.
 */
export const DSH_GENERATION_PROBES: Record<DshKnownGeneration, string> = {
  gen1: '0.1.7-rc.2',
  gen2: '0.2.0-rc.2',
  gen3: '0.3.0-rc.2',
};

/** The supported host window, declared in `package.json` as `engines.dsh`. */
export const DSH_SUPPORTED_RANGE = '>=0.1.7-rc.2 <0.4.0';

/** The exclusive upper bound of {@link DSH_SUPPORTED_RANGE}, for drift assertions. */
export const DSH_UNSUPPORTED_PROBE = '0.4.0';

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/;

export function isDshGeneration(value: unknown): value is DshGeneration {
  return value === 'gen1' || value === 'gen2' || value === 'gen3' || value === 'unknown';
}

/**
 * Map a semver major/minor pair onto a generation.
 *
 * gen1 = 0.1.x, gen2 = 0.2.x, gen3 = 0.3.x and every later line (0.4.x, 1.x, …). Later
 * lines land in gen3 on purpose: gen3 is modelled as a forward-compatible superset of
 * gen2, so an unreleased 0.4.x host gets the newest adapter instead of degrading to
 * "unknown", and only a host below the supported floor stays unclassified.
 */
export function generationOfVersion(major: number, minor: number): DshGeneration {
  if (major >= 1) return 'gen3';
  if (major !== 0) return 'unknown';
  if (minor >= 3) return 'gen3';
  if (minor === 2) return 'gen2';
  if (minor === 1) return 'gen1';
  return 'unknown'; // 0.0.x predates the modelled window
}

/** Parse a raw version string (with or without a leading `v`, prerelease optional). */
export function parseDshVersion(raw: string): DshVersionInfo {
  const match = raw.match(VERSION_PATTERN);
  if (!match) {
    return { raw, major: 0, minor: 0, patch: 0, prerelease: null, generation: 'unknown' };
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  return {
    raw,
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
    generation: generationOfVersion(major, minor),
  };
}

/**
 * A version that failed every detector. Shared so the host and client halves report the
 * identical shape for "I could not tell".
 */
export function unknownDshVersion(raw = 'unknown'): DshVersionInfo {
  return { raw, major: 0, minor: 0, patch: 0, prerelease: null, generation: 'unknown' };
}

/** A representative release of the generation, for detection from API shape (no version string). */
export function probeReleaseFor(generation: DshGeneration): string | null {
  return generation === 'unknown' ? null : DSH_GENERATION_PROBES[generation];
}
