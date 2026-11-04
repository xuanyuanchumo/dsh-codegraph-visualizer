#!/usr/bin/env node
/**
 * 把 `assets/icon.svg` 光栅化为市场收录要求的位图（cycle-141 第三轮）。
 *
 * ## 为什么需要它
 *
 * `awesome-dsh-plugin/contributing.md` §Icon 明确：市场卡片图标必须是
 * **GitHub 托管的位图**（`png` / `jpg` / `jpeg` / `webp`），**SVG 会被拒绝**——
 * 「列表不会让访客去不可担保的图床取图」，而 SVG 在该列表的校验里也不被接受。
 * 本仓的图标是 `assets/icon.svg`（矢量），因此需要导出一份 PNG 作为投稿图标。
 *
 * ## 用法
 *
 *   node scripts/generate-icon-raster.mjs            # 生成 assets/icon-180.png
 *   node scripts/generate-icon-raster.mjs --check    # 只校验产物是否存在且新鲜
 *
 * ## 产物
 *
 * `assets/icon-180.png`（180×180，透明背景）——投稿条目里以
 * `https://raw.githubusercontent.com/<owner>/<repo>/main/assets/icon-180.png`
 * 引用（`main` 分支上的相对位置，不依赖任何外部图床）。
 *
 * 渲染用 Playwright（仓库已有依赖，E2E 套件同款），不引入新的图形库。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = join(ROOT, 'assets', 'icon.svg');
const OUT_PATH = join(ROOT, 'assets', 'icon-180.png');
const SIZE = 180;

const args = new Set(process.argv.slice(2));

if (args.has('--check')) {
  if (!existsSync(OUT_PATH)) {
    console.error(`[icon-raster] missing ${OUT_PATH} — run: node scripts/generate-icon-raster.mjs`);
    process.exit(1);
  }
  const svgMtime = statSync(SVG_PATH).mtimeMs;
  const pngMtime = statSync(OUT_PATH).mtimeMs;
  if (pngMtime < svgMtime) {
    console.error('[icon-raster] icon-180.png is older than icon.svg — regenerate');
    process.exit(1);
  }
  console.log('[icon-raster] icon-180.png is present and fresh');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.error('[icon-raster] playwright unavailable — cannot rasterize');
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(2);
}

const svg = readFileSync(SVG_PATH, 'utf-8');
// 直接以 SVG 为文档主体；viewBox 是 128×128，缩放到目标尺寸。
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;width:${SIZE}px;height:${SIZE}px;overflow:hidden}
  svg{display:block;width:${SIZE}px;height:${SIZE}px}
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({ type: 'png', omitBackground: true });
  writeFileSync(OUT_PATH, buf);
  console.log(`[icon-raster] wrote ${OUT_PATH} (${buf.length} bytes, ${SIZE}x${SIZE})`);
} finally {
  await browser.close();
}
