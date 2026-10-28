#!/usr/bin/env node
/**
 * 生成本地插件市场索引 `site/plugin-market/index.json` + `icons/`（cycle-110 / T3）。
 *
 * ## 为什么需要它
 *
 * 插件市场的**搜索**只吃索引里的元数据（名称、作者、关键词、各语言标题/描述、
 * 分类、标签），而索引不是 npm 页面——它必须由作者生成并放到静态主机上
 * （kb `site/guide/plugin-market.md` §发布索引 / §索引格式参考）。
 * 光有 `package.json.keywords` 不会被任何市场搜索命中。
 *
 * 本脚本把三处**已有事实**合成一份合法索引，并在生成前做自检：
 *   1. `package.json` 的 name/version/author/homepage/repository/icon/engines.dsh/
 *      `dsh.bundle`（市场只收录声明了 `dsh.bundle` 的包）；
 *   2. `locale/en.json` + `locale/zh.json` 的 `meta.title` / `meta.description`
 *      ——`LocalizedText` 要求至少含 `en`，这正好是本地化显示的真源；
 *   3. 既有索引里同一版本的 `publishTimestamp`（保证**幂等**：重复运行字节一致，
 *      `--check` 才有意义）。
 *
 * 用法：
 *   node scripts/plugin-market-index.mjs            # 生成（网络可用时补时间戳）
 *   node scripts/plugin-market-index.mjs --offline  # 不访问 npm registry
 *   node scripts/plugin-market-index.mjs --check    # 只校验是否最新，过期退出码 1
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'site', 'plugin-market');
const OUT_FILE = join(OUT_DIR, 'index.json');
const ICON_DIR = join(OUT_DIR, 'icons');

/** 索引支持的图标媒体类型（kb §发布索引：SVG/PNG/JPEG/WebP，≤32KiB 内联时）。 */
const ICON_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** 图标上限（内联 data: URL 的限制；单独文件也沿用同一尺寸）。 */
const MAX_ICON_BYTES = 32 * 1024;

const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline');
const CHECK_ONLY = args.has('--check');

function fail(message) {
  console.error(`[plugin-market-index] ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---- 1. 读元数据并自检 -----------------------------------------------------

const pkg = readJson(join(ROOT, 'package.json'));

if (!pkg.name) fail('package.json 缺少 name');
if (!pkg.version) fail('package.json 缺少 version');
// 市场只收录声明 dsh.bundle 的包：缺了它，索引里会出现一个安装后不生效的条目
if (!pkg.dsh?.bundle?.patch) fail('package.json 缺少 dsh.bundle.patch —— 市场不会收录该包');
if (!existsSync(join(ROOT, pkg.dsh.bundle.patch))) fail(`dsh.bundle.patch 指向的文件不存在: ${pkg.dsh.bundle.patch}`);
if (!Array.isArray(pkg.keywords) || pkg.keywords.length === 0) fail('package.json 缺少 keywords —— 市场搜索会完全命中不到');
if (typeof pkg.icon !== 'string' || !pkg.icon.startsWith('./')) fail('package.json.icon 必须是相对包根路径（dsh-app-boot 拒绝 scheme/绝对路径）');
const iconPath = join(ROOT, pkg.icon);
if (!existsSync(iconPath)) fail(`icon 文件不存在: ${pkg.icon}`);
const iconStat = statSync(iconPath);
if (iconStat.size > MAX_ICON_BYTES) fail(`icon 超过 ${MAX_ICON_BYTES} 字节: ${iconStat.size}`);
const iconExt = pkg.icon.slice(pkg.icon.lastIndexOf('.')).toLowerCase();
if (!ICON_TYPES[iconExt]) fail(`icon 扩展名不受支持: ${iconExt}`);

const readLocale = (file) => {
  const path = join(ROOT, 'locale', file);
  if (!existsSync(path)) fail(`缺少本地化文件 locale/${file}`);
  const meta = readJson(path).meta ?? {};
  if (!meta.title || !meta.description) fail(`locale/${file} 的 meta.title/description 不能为空`);
  return { title: meta.title, description: meta.description };
};
const en = readLocale('en.json');
const zh = readLocale('zh.json');

const dshRange = pkg.engines?.dsh ?? '';
if (!dshRange) fail('package.json 缺少 engines.dsh —— 索引里的版本条目无法声明兼容范围');

const repoUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
if (!repoUrl) fail('package.json 缺少 repository.url');

// ---- 2. 复用既有索引的时间戳（幂等 + --check 的前提） ----------------------

const previous = existsSync(OUT_FILE) ? safeRead(OUT_FILE) : null;

function safeRead(path) {
  try { return readJson(path); } catch { return null; }
}

function previousTimestamp(version) {
  const entries = previous?.plugins?.[0]?.versions ?? [];
  const hit = entries.find((entry) => entry?.version === version);
  return typeof hit?.publishTimestamp === 'number' ? hit.publishTimestamp : null;
}

/**
 * npm registry 的发布时间（Unix 秒）。
 *
 * 失败一律降级为「当前时间」而不是报错：索引的可用性比时间戳精确更重要，
 * 而且本地生成（`--offline`）必须能在没有网络的机器上跑通。
 */
async function fetchPublishTimestamp(version) {
  if (OFFLINE) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const body = await response.json();
    const iso = body?.time?.[version];
    if (!iso) return null;
    const seconds = Math.floor(new Date(iso).getTime() / 1000);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

// ---- 3. 组装索引 -----------------------------------------------------------

const timestamp = previousTimestamp(pkg.version) ?? (await fetchPublishTimestamp(pkg.version)) ?? Math.floor(Date.now() / 1000);

const index = {
  format: 1,
  title: { en: 'DSH Code Graph Visualizer', zh: '代码图谱可视化' },
  description: {
    en: 'Local index for the dsh-codegraph-visualizer plugin (generated by scripts/plugin-market-index.mjs).',
    zh: '代码图谱可视化插件的本地市场索引（由 scripts/plugin-market-index.mjs 生成）。',
  },
  metadata: {
    categories: {
      visualization: { title: { en: 'Visualization', zh: '可视化' } },
    },
    labels: {
      codegraph: { title: { en: 'Code graph', zh: '代码图谱' } },
      dependencies: { title: { en: 'Dependencies', zh: '依赖分析' } },
      architecture: { title: { en: 'Architecture', zh: '架构' } },
      ast: { title: { en: 'AST', zh: '抽象语法树' } },
      callchain: { title: { en: 'Call chain', zh: '调用链' } },
      runtime: { title: { en: 'Runtime', zh: '运行时' } },
    },
    sortKeys: {
      version: { title: { en: 'Version', zh: '版本' }, order: 'desc' },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: en.title, zh: zh.title },
      description: { en: en.description, zh: zh.description },
      // 相对路径：索引与 icons/ 并排发布时按索引 URL 解析（kb 明确支持）
      icon: 'icons/icon.svg',
      author: pkg.author ?? 'unknown',
      ...(typeof pkg.homepage === 'string' ? { homepage: pkg.homepage } : {}),
      repository: { url: repoUrl },
      metadata: {
        category: 'visualization',
        labels: ['codegraph', 'dependencies', 'architecture', 'ast', 'callchain', 'runtime'],
        sortKeys: { version: 1 },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: timestamp,
          source: { type: 'npm' },
          engines: { dsh: dshRange },
        },
      ],
    },
  ],
};

const serialized = `${JSON.stringify(index, null, 2)}\n`;

// ---- 4. 写出或校验 ---------------------------------------------------------

if (CHECK_ONLY) {
  if (!existsSync(OUT_FILE)) fail(`索引不存在，请先运行 node scripts/plugin-market-index.mjs`);
  const current = readFileSync(OUT_FILE, 'utf8');
  const expected = stripTimestamp(serialized);
  if (stripTimestamp(current) !== expected) {
    fail('索引与当前元数据不一致（package.json / locale 改动后需重新生成）');
  }
  console.log('[plugin-market-index] index.json 已是最新');
  process.exit(0);
}

mkdirSync(ICON_DIR, { recursive: true });
copyFileSync(iconPath, join(ICON_DIR, `icon${iconExt}`));
writeFileSync(OUT_FILE, serialized, 'utf8');
console.log(`[plugin-market-index] 写出 ${OUT_FILE}（${serialized.length} 字节，版本 ${pkg.version}，时间戳 ${timestamp}）`);

/**
 * `--check` 比较时把 `publishTimestamp` 抹平。
 *
 * 时间戳是**网络/时钟**的产物：离线机器与 CI 机器上同一份元数据会得到不同的值，
 * 直接比较会让「元数据是否最新」这个真正的问题被一个无关差异掩盖。
 */
function stripTimestamp(text) {
  try {
    const parsed = JSON.parse(text);
    for (const plugin of parsed.plugins ?? []) {
      for (const entry of plugin.versions ?? []) entry.publishTimestamp = 0;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}
