import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import {
  DSH_GENERATION_PROBES,
  DSH_LEGACY_GENERATIONS,
  DSH_PROMISED_GENERATIONS,
  DSH_SUPPORTED_RANGE,
  DSH_UNSUPPORTED_PROBE,
} from '../../src/shared/dshGeneration.ts';

/**
 * Guards the DSH plugin-manifest contract this package's metadata is written against.
 *
 * Every expectation below mirrors a concrete reader in the DSH 0.2.0 runtime, verified
 * against the shipped `app.asar`. A regression here is otherwise SILENT: DSH degrades to
 * "no localized title / no icon" rather than failing the boot, and the market shows a
 * generic label. The comments name the exact source line each rule comes from.
 */
interface PluginManifest {
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  files?: string[];
  exports?: Record<string, unknown>;
  icon?: string;
  repository?: { type?: string; url?: string };
  homepage?: string;
  bugs?: { url?: string };
  dsh?: {
    manifestVersion?: number;
    bundle?: { patch?: string };
    client?: { platform?: string; inject?: string[]; entry?: string };
  };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PluginManifest;

/** `@deepseek-ai/dsh-app-boot/lib/index.js:1850` */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
/** `@deepseek-ai/dsh-app-boot/lib/index.js:1852` */
const MAX_ICON_BYTES = 256 * 1024;
/** `@deepseek-ai/dsh-app-boot/lib/index.js:1853-1859` */
const ICON_MEDIA_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Host generations this package claims to support through the adapter layer. The list is
 * imported from the shared generation model rather than restated here, so this file cannot
 * drift away from the thresholds the host/client detectors actually apply.
 *
 * cycle-92：这里刻意用 **DSH_PROMISED_GENERATIONS**（gen2/gen3）而不是全部被建模的代际。
 * 分类器仍然认得 gen1（DSH_LEGACY_GENERATIONS），但 engines.dsh 不再覆盖它——「能识别」
 * 与「被承诺」是两件事，混用会让这条守卫在抬高下限后仍然绿。
 */
const DSH_PROMISED = [...DSH_PROMISED_GENERATIONS];
const DSH_LEGACY = [...DSH_LEGACY_GENERATIONS];

/**
 * Minimal evaluator for the single range shape this package declares (`>=A <B`).
 * Deliberately not a general semver implementation: it asserts the documented
 * generation window instead of pulling a parser in for one assertion.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string] => {
    const [core = '0', pre = ''] = v.split('-', 2);
    return [core.split('.').map(Number), pre];
  };
  const [aCore, aPre] = parse(a);
  const [bCore, bPre] = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (aCore[i] ?? 0) - (bCore[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (aPre === bPre) return 0;
  if (aPre === '') return 1; // a release outranks its prereleases
  if (bPre === '') return -1;
  return aPre < bPre ? -1 : 1;
}

/**
 * 求值 semver 范围是否覆盖某版本——**忠实实现 node-semver 默认模式语义**。
 *
 * cycle-141 第三轮修正：旧实现按空白切分并对每一段无条件求值，既不认识 `||`
 * 分支，也不实现 node-semver 的**预发布元组规则**（带预发布的版本只有在范围内
 * 存在一个同 major.minor.patch 元组、且自身带预发布标签的比较符时才可能匹配）。
 * 后果与 `tests/unit/dshGeneration.test.ts` 的同名助手完全相同：守卫测的是自己，
 * 不是安装门。
 *
 * 与 `dshGeneration.test.ts` 的 `compareWithinRange` 保持**独立实现**（同上注释的
 * 理由）：两边都断言同一件事，复制一份比互相 import 更能暴露「其中一边被改坏」。
 * 本函数默认模式；需要 includePrerelease 语义时传第三参。
 */
function coversVersion(
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
  const v = parse(version);
  return range.split('||').some((branch) => {
    const parts = branch.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const ok = part.startsWith('>=')
        ? compareVersions(version, part.slice(2)) >= 0
        : part.startsWith('<')
          ? compareVersions(version, part.slice(1)) < 0
          : (() => { throw new Error(`manifest.test: unsupported range operator in "${part}"`); })();
      if (!ok) return false;
    }
    if (opts.includePrerelease === true) return true;
    if (v.pre === '') return true;
    return parts.some((part) => {
      const ref = parse(part.replace(/^[<>]=?/, ''));
      return ref.pre !== '' && cmpCore(ref.core, v.core) === 0;
    });
  });
}

const localeDir = join(ROOT, 'locale');
const localeFiles = existsSync(localeDir)
  ? readdirSync(localeDir).filter((name) => name.endsWith('.json'))
  : [];

describe('dsh plugin manifest', () => {
  it('declares manifestVersion 1', () => {
    expect(pkg.dsh?.manifestVersion).toBe(1);
  });

  it('declares engines.dsh covering every promised host generation and nothing beyond it', () => {
    const range = pkg.engines?.dsh;
    expect(typeof range).toBe('string');
    // Exact equality, not just coverage: the value must equal the range the generation model
    // publishes, otherwise the two halves of "which hosts do we support" can disagree.
    expect(range).toBe(DSH_SUPPORTED_RANGE);
    for (const generation of DSH_PROMISED) {
      const probe = DSH_GENERATION_PROBES[generation as keyof typeof DSH_GENERATION_PROBES];
      expect(coversVersion(range as string, probe), `${range} should cover ${generation} (${probe})`).toBe(true);
    }
    // 上界探针必须**成对**：只测「被排除」测不出「上界被改宽」，只测「仍覆盖」测不出
    // 「上界被改窄」。cycle-110 的实证是旧上界 `<0.4.0` 在 includePrerelease 下放行了
    // `0.4.0-rc.1`，所以最近的缺口是**预发布**，探针必须落在预发布上。
    expect(coversVersion(range as string, '0.4.0-rc.1'), `${range} must NOT cover 0.4.0-rc.1 (gen4 prerelease)`).toBe(false);
    expect(coversVersion(range as string, '0.4.0-alpha.1'), `${range} must NOT cover 0.4.0-alpha.1`).toBe(false);
    expect(coversVersion(range as string, '0.4.0'), `${range} must NOT cover 0.4.0`).toBe(false);
    expect(coversVersion(range as string, '1.0.0'), `${range} must NOT cover 1.0.0`).toBe(false);
    // 反向：收紧上界不得误伤 0.3 线的预发布与正式版（这是「改窄」的守卫）。
    for (const version of ['0.3.0-rc.1', '0.3.0-rc.2', '0.3.0', '0.3.7']) {
      expect(coversVersion(range as string, version), `${range} must still cover ${version}`).toBe(true);
    }
  });

  it('excludes every legacy generation from the declared window', () => {
    // 抬高下限的机器守卫：gen1 的代表版本必须落在窗口**外**。若有人把
    // DSH_SUPPORTED_RANGE 改回 >=0.1.7-rc.2，这条立刻变红。
    const range = pkg.engines?.dsh as string;
    expect(DSH_LEGACY.length).toBeGreaterThan(0);
    for (const generation of DSH_LEGACY) {
      expect(
        coversVersion(range, DSH_GENERATION_PROBES[generation as keyof typeof DSH_GENERATION_PROBES]),
        `${range} must NOT cover legacy ${generation}`,
      ).toBe(false);
    }
    // 两个清单必须恰好划分被建模的代际集合，且不相交。
    const modelled = Object.keys(DSH_GENERATION_PROBES).sort();
    expect([...DSH_PROMISED, ...DSH_LEGACY].sort()).toEqual(modelled);
  });

  it('narrows peerDependencies on @deepseek-ai/dsh* to the same floor as engines.dsh', () => {
    // peer 门才是唯一被强制执行的兼容门（dsh-app-boot/README.md:52），engines.dsh 无人读取。
    // 因此「下限抬高」必须同时落在 peer 上，否则声明与实门不一致。
    const peers = (pkg as { peerDependencies?: Record<string, string> }).peerDependencies ?? {};
    for (const key of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools']) {
      const peer = peers[key];
      expect(typeof peer, `${key} must be a peer dependency`).toBe('string');
      expect(peer, `${key} must still accept the 0.2 line`).toContain('^0.2.0-rc.2');
      expect(peer, `${key} must still accept the 0.3 line`).toContain('^0.3.0-rc.2');
      expect(peer, `${key} must drop the 0.1 line`).not.toContain('0.1.');
    }
    const lowerBound = (pkg.engines?.dsh as string).split(' ')[0]!.slice(2);
    expect(lowerBound).toBe('0.2.0-rc.2');
  });

  it('declares the client half as a web-platform module', () => {
    // dsh-client-modules/lib/index.js:714 — any other platform means "no client half".
    expect(pkg.dsh?.client?.platform).toBe('web');
  });

  it('exports ./client, the only authoritative client bundle path', () => {
    // dsh-client-modules/lib/index.js:719 throws when dsh.client is declared without it.
    const client = pkg.exports?.['./client'];
    expect(client).toBeTruthy();
    expect((client as { default?: string }).default).toBe('./dist/client.js');
  });

  it('ships the host bundle patch the dsh.bundle declaration points at', () => {
    const patch = pkg.dsh?.bundle?.patch;
    expect(typeof patch).toBe('string');
    expect(existsSync(join(ROOT, patch as string))).toBe(true);
  });

  it('avoids metadata fields no DSH reader consumes', () => {
    // Zero readers across the 0.2.0 runtime for each of these; the intent they encode
    // now lives in locale/*.json (display text), engines.dsh (host compatibility) and
    // exports["./client"] (client entry).
    for (const dead of ['displayName', 'description', 'category', 'hostVersion', 'permissions', 'optionalPlugins']) {
      expect(pkg.dsh, `dsh.${dead} has no reader in the DSH runtime`).not.toHaveProperty(dead);
    }
    expect(pkg.dsh?.client).not.toHaveProperty('entry');
  });

  it('lists only official DSH packages as client module dependencies', () => {
    // Third-party plugins (dsh-codegraph, dsh-tool-lens, dsh-better-sidebar,
    // dsh-remote-web-ui) are optional integrations, never requirements.
    for (const entry of pkg.dsh?.client?.inject ?? []) {
      expect(entry.startsWith('@deepseek-ai/'), `${entry} must be an official runtime module`).toBe(true);
    }
  });

  it('declares a prepare script so git-based installs build the gitignored dist artifact', () => {
    // dshmarket/lib/verify.js:184-195 flags a "source-only checkout" whose declared
    // entry artifact is missing; dist/ is gitignored, so installs must build it.
    expect(typeof pkg.scripts?.prepare).toBe('string');
  });

  it('publishes the directories its runtime metadata is resolved from', () => {
    for (const entry of ['dist', 'cordis.patch.yml', 'locale', 'assets']) {
      expect(pkg.files, `files[] must ship ${entry}`).toContain(entry);
    }
  });

  it('points at the public repository the market catalog entry will link to', () => {
    // dshmarket/src/regions.ts:80 reads its catalog from a curated index
    // (https://awesome-dsh-plugin.com/plugins.json), so an entry cannot be earned
    // by keywords; the catalog links to a repository and the npm page reads these
    // same fields. Keep them consistent with the configured git remote.
    expect(pkg.repository?.type).toBe('git');
    expect(pkg.repository?.url).toMatch(/^git\+https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/);
    const slug = pkg.repository?.url?.replace(/^git\+https:\/\/github\.com\//, '').replace(/\.git$/, '');
    expect(pkg.homepage).toBe(`https://github.com/${slug}#readme`);
    expect(pkg.bugs?.url).toBe(`https://github.com/${slug}/issues`);
  });
});

describe('localized display metadata', () => {
  it('exports locale/*.json for the ESM resource resolver', () => {
    // dsh-app-boot/lib/index.js:1884-1895 resolves `${pkg}/locale/en.json` through the
    // Node ESM resolver and silently drops metadata on ERR_PACKAGE_PATH_NOT_EXPORTED.
    expect(pkg.exports?.['./locale/*.json']).toBe('./locale/*.json');
  });

  it('ships the en.json anchor every other language file hangs off', () => {
    expect(existsSync(join(localeDir, 'en.json'))).toBe(true);
  });

  it('names the Chinese dictionary with the language id the running host actually asks for', () => {
    // Regression guard from the J0 journey: `dsh-app-boot/lib/index.js:1930-1932` derives the
    // dictionary key as `basename.toLowerCase()`, and the web shell resolves display text with
    // the bare id `zh`. A `zh-CN.json` therefore parses fine but is never selected, and the
    // plugin silently degrades to the package name plus the package.json description.
    // All ten official packages that ship locale files use exactly `en.json` + `zh.json`.
    expect(localeFiles).toContain('en.json');
    expect(localeFiles).toContain('zh.json');
  });

  it('keeps the region-tagged alias for hosts that select by a region-tagged language id', () => {
    expect(localeFiles).toContain('zh-CN.json');
  });

  it('keeps every Chinese dictionary in sync', () => {
    const read = (file: string): unknown =>
      (JSON.parse(readFileSync(join(localeDir, file), 'utf8')) as { meta?: unknown }).meta;
    expect(read('zh.json')).toEqual(read('zh-CN.json'));
  });

  it('uses language ids as file names and non-empty meta text as content', () => {
    for (const file of localeFiles) {
      expect(LANGUAGE_ID.test(file.slice(0, -'.json'.length)), `${file} must use a language id`).toBe(true);
      const parsed = JSON.parse(readFileSync(join(localeDir, file), 'utf8')) as {
        meta?: { title?: unknown; description?: unknown };
      };
      const { title, description } = parsed.meta ?? {};
      expect(typeof title === 'string' && title.length > 0, `${file} needs a non-empty meta.title`).toBe(true);
      expect(
        typeof description === 'string' && description.length > 0,
        `${file} needs a non-empty meta.description`,
      ).toBe(true);
    }
  });
});

describe('plugin icon', () => {
  it('declares a manifest-relative icon inside the package directory', () => {
    const icon = pkg.icon;
    expect(typeof icon).toBe('string');
    // dsh-app-boot/lib/index.js:1863-1869 rejects schemes, absolute paths and escapes.
    expect(/^\.\//.test(icon as string)).toBe(true);
    expect(existsSync(join(ROOT, icon as string))).toBe(true);
    expect(resolve(ROOT, icon as string).startsWith(ROOT)).toBe(true);
  });

  it('uses an extension the runtime maps to a data-uri media type', () => {
    expect(ICON_MEDIA_TYPES[extname(pkg.icon as string).toLowerCase()]).toBeTruthy();
  });

  it('keeps the icon within the runtime size limit', () => {
    // dsh-app-boot/lib/index.js:1872-1874 rejects files above 256 KiB.
    expect(statSync(join(ROOT, pkg.icon as string)).size).toBeLessThanOrEqual(MAX_ICON_BYTES);
  });
});
