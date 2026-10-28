/**
 * 插件市场可搜索元数据 + 本地索引生成器的契约（cycle-110 / T3）。
 *
 * 市场搜索只吃**索引文件**里的元数据（kb `site/guide/plugin-market.md` §浏览和安装）：
 * 名称、作者、关键词、各语言标题/描述、分类、标签。所以本文件守两段：
 *
 *   1. `package.json` / `locale/*.json` 里那些会被索引用到的字段必须齐全且合法
 *      （少了 `dsh.bundle` 市场根本不会收录，少了 `keywords` 就永远搜不到）；
 *   2. `scripts/plugin-market-index.mjs` 真的会**拒绝**坏元数据、且 `--check`
 *      真的能发现「索引过期」——否则那份 JSON 就是一份自称最新的死文件。
 *
 * 第 2 段在**临时目录副本**里跑：仓库里的 `package.json` 由其它并行任务维护，
 * 直接对活文件跑 `--check` 会把「别人改了版本号」误报成「索引生成器坏了」。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'plugin-market-index.mjs');
const INDEX_FILE = join(ROOT, 'site', 'plugin-market', 'index.json');

interface Pkg {
  name: string;
  version: string;
  keywords?: string[];
  icon?: string;
  author?: string;
  homepage?: string;
  repository?: { type?: string; url?: string };
  engines?: { dsh?: string };
  dsh?: { bundle?: { patch?: string } };
  files?: string[];
}

interface LocalizedText { en?: string; zh?: string }

interface MarketVersion {
  version: string;
  publishTimestamp: number;
  source: { type: string; registry?: string };
  engines?: { dsh?: string };
}

interface MarketPlugin {
  name: string;
  title?: LocalizedText;
  description?: LocalizedText;
  icon?: string;
  author?: string;
  homepage?: string;
  repository?: { url?: string };
  metadata?: { category?: string; labels?: string[]; sortKeys?: Record<string, number> };
  versions: MarketVersion[];
}

interface MarketIndex {
  format: number;
  title?: LocalizedText;
  description?: LocalizedText;
  metadata?: {
    categories?: Record<string, { title: LocalizedText }>;
    labels?: Record<string, { title: LocalizedText }>;
    sortKeys?: Record<string, { title: LocalizedText; order?: string }>;
  };
  plugins: MarketPlugin[];
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Pkg;
const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as MarketIndex;

/** 运行生成器；返回 { code, stderr } 而不是抛错，便于断言失败分支。 */
function runScript(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [join(cwd, 'scripts', 'plugin-market-index.mjs'), ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** 造一份最小可运行的仓库副本（脚本、manifest、本地化、图标、补丁文件）。 */
function makeRepoCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-market-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'locale'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  cpSync(SCRIPT, join(dir, 'scripts', 'plugin-market-index.mjs'));
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  cpSync(join(ROOT, 'locale', 'en.json'), join(dir, 'locale', 'en.json'));
  cpSync(join(ROOT, 'locale', 'zh.json'), join(dir, 'locale', 'zh.json'));
  cpSync(join(ROOT, 'assets', 'icon.svg'), join(dir, 'assets', 'icon.svg'));
  cpSync(join(ROOT, 'cordis.patch.yml'), join(dir, 'cordis.patch.yml'));
  return dir;
}

let tempDirs: string[] = [];

beforeAll(() => { tempDirs = []; });
afterAll(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });

describe('package.json 的市场可搜索元数据', () => {
  it('declares dsh.bundle (otherwise the market never lists the package)', () => {
    expect(pkg.dsh?.bundle?.patch).toBeTruthy();
    expect(existsSync(join(ROOT, pkg.dsh!.bundle!.patch!))).toBe(true);
  });

  it('carries keywords that a market search can actually match', () => {
    const keywords = pkg.keywords ?? [];
    expect(keywords.length).toBeGreaterThanOrEqual(8);
    // 用户会搜的词，不要求全序一致（keywords 由其它并行任务维护）
    for (const seed of ['dsh', 'dsh-plugin', 'codegraph', 'visualizer', 'dependency-graph', 'call-graph']) {
      expect(keywords, `keywords 缺少 ${seed}`).toContain(seed);
    }
  });

  it('declares a relative icon inside the package and ships it', () => {
    expect(pkg.icon?.startsWith('./')).toBe(true);
    expect(existsSync(join(ROOT, pkg.icon!))).toBe(true);
    // dsh-app-boot 按扩展名映射 data-uri 媒体类型
    expect(['.svg', '.png', '.jpg', '.jpeg', '.webp']).toContain(
      pkg.icon!.slice(pkg.icon!.lastIndexOf('.')).toLowerCase(),
    );
  });

  it('keeps both locale files searchable (title AND description, en AND zh)', () => {
    for (const file of ['en.json', 'zh.json']) {
      const meta = (JSON.parse(readFileSync(join(ROOT, 'locale', file), 'utf8')) as {
        meta?: { title?: string; description?: string };
      }).meta;
      expect(meta?.title, `${file} 缺 title`).toBeTruthy();
      expect(meta?.description, `${file} 缺 description`).toBeTruthy();
    }
  });
});

describe('site/plugin-market/index.json 格式自检', () => {
  it('is a format-1 index with at least one plugin', () => {
    expect(index.format).toBe(1);
    expect(Array.isArray(index.plugins)).toBe(true);
    expect(index.plugins.length).toBeGreaterThanOrEqual(1);
  });

  it('declares a localized market title containing en', () => {
    expect(typeof index.title?.en).toBe('string');
    expect(index.title?.en).not.toBe('');
  });

  it('names the package exactly once, and it is this package', () => {
    const names = index.plugins.map((plugin) => plugin.name);
    expect(names).toContain(pkg.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exposes localized title/description for search in both languages', () => {
    const plugin = index.plugins.find((entry) => entry.name === pkg.name)!;
    for (const lang of ['en', 'zh'] as const) {
      expect(typeof plugin.title?.[lang], `title.${lang}`).toBe('string');
      expect(typeof plugin.description?.[lang], `description.${lang}`).toBe('string');
    }
  });

  it('links a relative icon that exists next to the index', () => {
    const plugin = index.plugins.find((entry) => entry.name === pkg.name)!;
    expect(plugin.icon).toBe('icons/icon.svg');
    // 相对图标相对索引 URL 解析 ⇒ 文件必须真的在 index.json 旁边
    expect(existsSync(join(ROOT, 'site', 'plugin-market', plugin.icon!))).toBe(true);
  });

  it('carries versions with the required npm source shape and a real dsh engine range', () => {
    const plugin = index.plugins.find((entry) => entry.name === pkg.name)!;
    expect(plugin.versions.length).toBeGreaterThanOrEqual(1);
    const version = plugin.versions[0]!;
    expect(version.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isInteger(version.publishTimestamp)).toBe(true);
    expect(version.publishTimestamp).toBeGreaterThan(0);
    expect(version.source.type).toBe('npm');
    // 索引里的 engines.dsh 必须与包自身一致（DSH 安装时会再查一次）
    expect(version.engines?.dsh).toBe(pkg.engines?.dsh);
  });

  it('only references categories, labels and sort keys it declares', () => {
    // 校验器规则：metadata.category / labels / sortKeys 的 id 必须是索引已声明的
    const declaredCategories = new Set(Object.keys(index.metadata?.categories ?? {}));
    const declaredLabels = new Set(Object.keys(index.metadata?.labels ?? {}));
    const declaredSortKeys = new Set(Object.keys(index.metadata?.sortKeys ?? {}));
    expect(declaredCategories.size).toBeGreaterThan(0);
    expect(declaredLabels.size).toBeGreaterThan(0);
    for (const plugin of index.plugins) {
      if (plugin.metadata?.category) expect(declaredCategories).toContain(plugin.metadata.category);
      for (const label of plugin.metadata?.labels ?? []) expect(declaredLabels).toContain(label);
      for (const key of Object.keys(plugin.metadata?.sortKeys ?? {})) expect(declaredSortKeys).toContain(key);
    }
  });

  it('keeps the advertised install version in sync with package.json', () => {
    // 版本号更新后必须重新生成；这是一条**可执行**的提醒而不是注释
    const plugin = index.plugins.find((entry) => entry.name === pkg.name)!;
    expect(
      plugin.versions.map((v) => v.version),
      'package.json 版本已变，请运行 node scripts/plugin-market-index.mjs 重新生成索引',
    ).toContain(pkg.version);
  });
});

describe('生成器的守卫（在仓库副本里验证，避免与并行改动互相污染）', () => {
  it('generates an index that passes its own --check', () => {
    const dir = makeRepoCopy();
    tempDirs.push(dir);
    const generate = runScript(dir, ['--offline']);
    expect(generate.code, generate.stderr).toBe(0);
    const check = runScript(dir, ['--offline', '--check']);
    expect(check.code, check.stderr).toBe(0);
    expect(check.stdout).toContain('已是最新');
  });

  it('--check goes red when the metadata moved on (the check is not vacuous)', () => {
    const dir = makeRepoCopy();
    tempDirs.push(dir);
    expect(runScript(dir, ['--offline']).code).toBe(0);

    // 改本地化文本 ⇒ 索引内容过期
    const localePath = join(dir, 'locale', 'en.json');
    const locale = JSON.parse(readFileSync(localePath, 'utf8')) as { meta: { title: string } };
    locale.meta.title = `${locale.meta.title} (edited)`;
    writeFileSync(localePath, JSON.stringify(locale, null, 2), 'utf8');

    const check = runScript(dir, ['--offline', '--check']);
    expect(check.code).not.toBe(0);
    expect(check.stderr).toContain('索引与当前元数据不一致');
  });

  it('refuses to build an index for a package without dsh.bundle', () => {
    const dir = makeRepoCopy();
    tempDirs.push(dir);
    const pkgPath = join(dir, 'package.json');
    const copy = JSON.parse(readFileSync(pkgPath, 'utf8')) as Pkg;
    delete copy.dsh?.bundle;
    writeFileSync(pkgPath, JSON.stringify(copy, null, 2), 'utf8');

    const result = runScript(dir, ['--offline']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('dsh.bundle');
    // 并且不能留下一个「看起来能用」的索引
    expect(existsSync(join(dir, 'site', 'plugin-market', 'index.json'))).toBe(false);
  });

  it('refuses an empty keyword list (nothing would ever match it)', () => {
    const dir = makeRepoCopy();
    tempDirs.push(dir);
    const pkgPath = join(dir, 'package.json');
    const copy = JSON.parse(readFileSync(pkgPath, 'utf8')) as Pkg;
    copy.keywords = [];
    writeFileSync(pkgPath, JSON.stringify(copy, null, 2), 'utf8');

    const result = runScript(dir, ['--offline']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('keywords');
  });
});
