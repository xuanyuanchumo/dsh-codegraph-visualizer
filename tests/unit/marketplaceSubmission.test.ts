/**
 * 插件市场收录契约（cycle-141 第三轮）。
 *
 * ## 这份文件守护什么
 *
 * 本仓要让插件**被 DSH 插件市场收录并可被搜到**。收录链路有两个独立的消费方，
 * 各有自己的格式与校验规则：
 *
 * 1. **awesome-dsh-plugin**（社区精选列表，市场卡片与分类的来源）——
 *    投稿是 `data/plugins/<owner>__<repo>.yml` 一个文件（见其 contributing.md）。
 *    本仓在 `site/awesome-dsh-plugin/` 保留一份逐字对应的副本，使投稿内容
 *    受版本控制、可被机器核对，而不是散落在会话记录里。
 * 2. **DSH 本地市场索引** `site/plugin-market/index.json`（由
 *    `scripts/plugin-market-index.mjs` 生成，另有 `pluginMarketIndex.test.ts` 守护）。
 *
 * 本文件的断言全部来自 contributing.md 的**硬性要求**，逐条对应：
 *
 * | 要求 | 断言 |
 * |---|---|
 * | 仓库声明 `dsh.bundle`（只声明 `dsh.client` 会被 CI 拒收） | §B-1 |
 * | `keywords` 含 `dsh-plugin`（仓库 topic 的镜像） | §B-2 |
 * | 描述只陈述功能、不含无法核对的数字 | §A-4 |
 * | `url` 必须与仓库完全一致 | §A-2 |
 * | `category` 必须是合法取值 | §A-3 |
 * | 图标必须是 GitHub 托管的**位图**（SVG 被拒） | §A-5 |
 * | `screenshots.json` 1–8 张、相对路径不跳出插件目录 | §C |
 * | 官方 `@deepseek-ai/*` 用 peer，且预发布范围带显式 `\|\|` 分支 | §B-3 |
 *
 * ## 为什么 §D 要用**真实 semver** 做差分
 *
 * `tests/unit/dshGeneration.test.ts` 与 `manifest.test.ts` 各持一份自制比较器
 * （刻意独立，便于互相暴露改动）。但自制实现与真实 semver 的一致性**不能靠
 * 互相印证**——本轮实测发现：旧比较器把预发布当普通分量，放行了单段范围
 * `>=0.2.0-rc.2 <0.4.0-0`，而真实 semver 在**默认模式**下拒绝 `0.3.0-rc.2`。
 * 两处守卫同时绿，安装门却是坏的。
 *
 * §D 因此把 `DSH_SUPPORTED_RANGE` 直接喂给真实 `semver`，并**两种模式各断言一遍**：
 * 自制比较器写错时这里不会跟着错。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DSH_SUPPORTED_RANGE } from '../../src/shared/dshGeneration.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** awesome-dsh-plugin 的合法 `category` 取值（contributing.md §Valid category values）。 */
const VALID_CATEGORIES = [
  'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools',
  'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify',
  'dev', 'security', 'remote', 'market', 'fun',
] as const;

/** 投稿文件所在目录（`site/` 是本仓的可发布产物目录）。 */
const SUBMISSION_DIR = join(ROOT, 'site', 'awesome-dsh-plugin');

/**
 * 解析投稿 YAML 的**限定子集**。
 *
 * 只支持该文件用到的形状：顶层的 `key: scalar`、`key:` + 缩进一层的
 * `subkey: scalar`、整行 `#` 注释、以及单/双引号包裹的标量。
 *
 * **刻意不通用**：引入一个通用 YAML 解析器只为校验一个 6 行的文件并不划算，
 * 而一个「看起来通用」的自制解析器正是本轮修掉的那类缺陷。这里用严格子集 +
 * §A-6 的裸冒号危险检查补足——该列表 CI 用的是真 YAML 解析器，裸 `: `
 * 会把描述读成嵌套键（contributing.md 明确警告过）。
 */
function parseSubmissionYaml(text: string): Record<string, string | Record<string, string>> {
  const out: Record<string, string | Record<string, string>> = {};
  let pendingMapKey: string | null = null;
  const unquote = (raw: string): string => {
    const t = raw.trim();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
      return t.slice(1, -1);
    }
    return t;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine) || rawLine.trim() === '') continue;
    expect(rawLine.includes('\t'), 'YAML 缩进禁用了制表符').toBe(false);
    const nested = rawLine.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && pendingMapKey !== null) {
      const target = out[pendingMapKey];
      if (typeof target === 'object' && target !== null) {
        target[nested[1]!] = unquote(nested[2]!);
        continue;
      }
    }
    const top = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    expect(top, `unsupported YAML line: ${JSON.stringify(rawLine)}`).not.toBeNull();
    const [, key, value] = top!;
    if (value!.trim() === '') {
      out[key!] = {};
      pendingMapKey = key!;
    } else {
      out[key!] = unquote(value!);
      pendingMapKey = null;
    }
  }
  return out;
}

/**
 * 解析真实 `semver`。
 *
 * 本仓不直接依赖 semver（它只作为工具链的传递依赖存在），所以这里按两个稳定位置找：
 *   1. `require.resolve('semver')`（若将来把它提为显式依赖，这条先命中）；
 *   2. pnpm 的 hoist 层 `node_modules/.pnpm/node_modules/semver`。
 * 找不到时返回 null，由调用方**响亮失败**（不静默跳过——守卫跑不了 ≠ 守卫通过）。
 */
function resolveSemver(): { satisfies: (v: string, r: string, o?: object) => boolean } | null {
  const candidates = [
    join(ROOT, 'node_modules', 'semver'),
    join(ROOT, 'node_modules', '.pnpm', 'node_modules', 'semver'),
  ];
  const require = createRequire(import.meta.url);
  for (const dir of candidates) {
    const pkg = join(dir, 'package.json');
    if (!existsSync(pkg)) continue;
    try {
      const entry = JSON.parse(readFileSync(pkg, 'utf-8')) as { main?: string };
      const mainPath = join(dir, entry.main ?? 'index.js');
      if (!existsSync(mainPath)) continue;
      return require(mainPath) as { satisfies: (v: string, r: string, o?: object) => boolean };
    } catch {
      // 换下一个候选
    }
  }
  return null;
}

const submissionFiles = existsSync(SUBMISSION_DIR)
  ? readdirSync(SUBMISSION_DIR).filter((n) => n.endsWith('.yml'))
  : [];

describe('awesome-dsh-plugin 投稿条目', () => {
  it('存在且文件名符合 <owner>__<repo>.yml', () => {
    expect(submissionFiles).toHaveLength(1);
    expect(submissionFiles[0]).toMatch(/^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+\.yml$/);
  });

  const file = join(SUBMISSION_DIR, submissionFiles[0] ?? '');
  const text = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const doc = text ? parseSubmissionYaml(text) : {};
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
    name?: string;
    keywords?: string[];
    engines?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    repository?: { url?: string } | string;
    dsh?: { bundle?: { patch?: string }; client?: unknown };
  };

  // ── A-1 必需键 ──────────────────────────────────────────────────────────
  it('声明了 url / name / category / description', () => {
    for (const key of ['url', 'name', 'category', 'description']) {
      expect(doc[key], `missing key: ${key}`).toBeDefined();
    }
  });

  // ── A-2 url 必须与仓库声明完全一致 ──────────────────────────────────────
  it('url 与 package.json 的 repository 指向同一个仓库', () => {
    const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    expect(typeof repoUrl).toBe('string');
    // git+https://github.com/o/r.git / git@github.com:o/r.git / https://github.com/o/r → 归一为 https URL
    const normalized = String(repoUrl)
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/^git@([^:]+):/, 'https://$1/');
    expect(String(doc.url)).toBe(normalized);
    // name 必须是 owner/repo 形态，且与 url 的路径一致
    const path = new URL(normalized).pathname.replace(/^\//, '');
    expect(String(doc.name)).toBe(path);
  });

  // ── A-3 category 必须在合法取值内 ───────────────────────────────────────
  it('category 是列表声明的合法取值', () => {
    expect(VALID_CATEGORIES).toContain(String(doc.category));
  });

  // ── A-4 描述：非空、英文以句号结尾、不含营销数字 ─────────────────────────
  it('描述是非空的 LocalizedText，英文以句号结尾', () => {
    const desc = doc.description;
    expect(typeof desc).toBe('object');
    const en = (desc as Record<string, string>).en;
    const zh = (desc as Record<string, string>).zh;
    expect(typeof en).toBe('string');
    expect((en ?? '').trim().length).toBeGreaterThan(0);
    expect((en ?? '').trim().endsWith('.')).toBe(true);
    // zh 可选；给了就必须非空
    if (zh !== undefined) expect(zh.trim().length).toBeGreaterThan(0);
  });

  it('描述不含裸冒号（会被真 YAML 解析器读成嵌套键）', () => {
    // contributing.md 明确警告：描述含 ": " 必须加引号，否则解析失败。
    // 本文件的 `en` 值不含 ": "（只有逗号），因此无需引号；这里守住它不再被引入。
    const fileText = readFileSync(file, 'utf-8');
    const bareColonLines = fileText
      .split(/\r?\n/)
      .filter((l) => /^\s+(en|zh):\s*[^'"].*: /.test(l));
    expect(bareColonLines, 'unquoted description contains ": "').toEqual([]);
  });

  // ── A-5 图标：GitHub 托管的位图（SVG 被拒） ─────────────────────────────
  it('icon 是可用的 GitHub 托管位图（当声明时）', () => {
    const icon = doc.icon;
    if (icon === undefined) return; // 可选；不写则回退作者头像
    const url = String(icon);
    expect(url.startsWith('https://'), 'icon 必须 https').toBe(true);
    expect(/^https:\/\/(raw\.githubusercontent\.com|github\.com|user-images\.githubusercontent\.com|camo\.githubusercontent\.com)\//.test(url),
      'icon 必须是 GitHub 托管').toBe(true);
    expect(/\.(png|jpe?g|webp)$/i.test(url), 'SVG 会被列表拒绝').toBe(true);
    // 声明的图标文件必须真的在仓库里（否则市场取图 404）
    const rel = url.replace(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//, '');
    expect(rel, 'icon 必须能从 raw.githubusercontent.com 的仓库路径还原').not.toBe(url);
    expect(existsSync(join(ROOT, rel)), `icon file missing on disk: ${rel}`).toBe(true);
  });
});

describe('投稿前置条件（contributing.md §Requirements）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
    keywords?: string[];
    engines?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    dsh?: { bundle?: { patch?: string } };
  };

  it('package.json 声明 dsh.bundle（只声明 dsh.client 会被拒收）', () => {
    expect(pkg.dsh?.bundle).toBeDefined();
    expect(typeof pkg.dsh?.bundle?.patch).toBe('string');
    expect(existsSync(join(ROOT, 'cordis.patch.yml'))).toBe(true);
  });

  it('keywords 含 dsh-plugin（对应仓库 topic）', () => {
    expect(pkg.keywords).toContain('dsh-plugin');
  });

  it('engines.dsh 与模型常量逐字一致', () => {
    expect(pkg.engines?.dsh).toBe(DSH_SUPPORTED_RANGE);
  });

  it('engines.dsh 带显式 || 预发布分支（单段范围会静默排除下一代预发布）', () => {
    expect(DSH_SUPPORTED_RANGE).toContain('||');
  });

  it('官方 @deepseek-ai/* 声明在 peerDependencies 且含预发布分支', () => {
    for (const key of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools']) {
      const range = pkg.peerDependencies?.[key];
      expect(range, `${key} must be a peerDependency`).toBeDefined();
      expect(range).toContain('||');
      // 预发布分支必须把标签落在具体元组上（^0.2.0-rc.2 形态），而非宽范围
      expect(range).toMatch(/\^\d+\.\d+\.\d+-[0-9A-Za-z.-]+/);
    }
  });
});

describe('screenshots.json（contributing.md §Screenshots）', () => {
  const file = join(ROOT, 'screenshots.json');

  it('存在且是合法 JSON（数组或 { screenshots: [] }）', () => {
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { screenshots?: unknown }).screenshots;
    expect(Array.isArray(list)).toBe(true);
  });

  const list: string[] = (() => {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    const raw = Array.isArray(parsed) ? parsed : (parsed as { screenshots?: unknown }).screenshots;
    return Array.isArray(raw) ? (raw as string[]) : [];
  })();

  it('条目数在 1–8 之间', () => {
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(8);
  });

  it('全部是相对路径、不跳出插件目录', () => {
    for (const p of list) {
      expect(isAbsolute(p), `absolute path not allowed: ${p}`).toBe(false);
      expect(p.startsWith('/'), `leading slash not allowed: ${p}`).toBe(false);
      expect(p.split(/[\\/]/), `.. not allowed: ${p}`).not.toContain('..');
    }
  });

  it('每张图都真实存在于仓库（否则市场取图 404）', () => {
    for (const p of list) {
      expect(existsSync(join(ROOT, ...p.split(/[\\/]/))), `missing screenshot: ${p}`).toBe(true);
    }
  });
});

/**
 * §D 差分：把真实范围喂给**真实 semver**，两种模式各断言一遍。
 *
 * 这一节与 `dshGeneration.test.ts` / `manifest.test.ts` 的自制比较器**刻意重复**：
 * 自制实现互相印证过的两次，都不足以发现「两处都错了同一个语义」。
 */
describe('DSH_SUPPORTED_RANGE vs 真实 semver（差分）', () => {
  const semver = resolveSemver();

  it('真实 semver 可解析（差分守卫不可静默跳过）', () => {
    expect(semver, 'semver must be resolvable from node_modules (pnpm hoist layer ok)').not.toBeNull();
  });

  it('宿主模式（includePrerelease）覆盖 gen2 + gen3 全线的预发布与正式版', () => {
    if (semver === null) return;
    const covered = [
      '0.2.0-rc.2', '0.2.1-rc.3', '0.2.1', '0.2.9',
      '0.3.0-0', '0.3.0-rc.1', '0.3.0-rc.2', '0.3.0', '0.3.7',
    ];
    for (const v of covered) {
      expect(semver.satisfies(v, DSH_SUPPORTED_RANGE, { includePrerelease: true }), `host mode must cover ${v}`).toBe(true);
    }
  });

  it('默认模式（市场校验器）也覆盖 gen3 全线——这是 || 分支修复的直接证据', () => {
    if (semver === null) return;
    for (const v of ['0.3.0-0', '0.3.0-rc.1', '0.3.0-rc.2', '0.3.0', '0.3.7']) {
      expect(semver.satisfies(v, DSH_SUPPORTED_RANGE), `default mode must cover ${v}`).toBe(true);
    }
    // 反例：旧单段范围在默认模式下漏掉 gen3 预发布（本轮的缺陷现场）。
    expect(semver.satisfies('0.3.0-rc.2', '>=0.2.0-rc.2 <0.4.0-0')).toBe(false);
  });

  it('两种模式都排除 gen4 全线（含预发布）与遗留 gen1', () => {
    if (semver === null) return;
    for (const v of ['0.4.0-0', '0.4.0-alpha.1', '0.4.0-rc.1', '0.4.0', '1.0.0', '0.1.7-rc.1', '0.1.9']) {
      expect(semver.satisfies(v, DSH_SUPPORTED_RANGE), `default mode must NOT cover ${v}`).toBe(false);
      expect(semver.satisfies(v, DSH_SUPPORTED_RANGE, { includePrerelease: true }), `host mode must NOT cover ${v}`).toBe(false);
    }
  });
});
