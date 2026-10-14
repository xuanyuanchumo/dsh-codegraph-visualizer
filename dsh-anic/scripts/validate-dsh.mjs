#!/usr/bin/env node
/**
 * dsh-anic DSH 规范符合性门（独立可执行；run-tests 第一步）。
 *
 * 依据 docs/anic/07 §2 的 asar 逐行取证（每条检查注明出处）：
 *   C1  type=module（ESM only 红线）
 *   C2  dsh.manifestVersion=1
 *   C3  dsh.client.platform='web'（规范值，dsh-client-modules:714）
 *   C4  dsh.client.inject 仅官方包（客户端模块图边；B4 防御）
 *   C5  exports['./client'] 存在且指向存在文件（唯一客户端入口权威，缺失即宿主 throw：dsh-client-modules:170-181）
 *   C6  exports['.'] / './package.json' 存在；locale 导出存在
 *   C7  locale en+zh 可解析、meta.title/description 非空、键集对齐
 *   C8  icon 存在、后缀白名单、≤256KiB
 *   C9  dist/client.js 存在、含 __ModuleLoader__.load({id,factory}) 包装、node --check 通过
 *   C10 dist/host.js 存在、node --check 通过、动态 import 得 apply/inject/name
 *   C11 dsh.bundle.patch 若声明则文件存在（本插件未声明 → info）
 *   C12 README.md 存在
 *
 * 用法：node scripts/validate-dsh.mjs [--json]   —— 任何 FAIL 退出 1（响亮失败）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

const results = [];
function check(id, ok, detail, evidence = '') {
  results.push({ id, ok: !!ok, detail, evidence });
  return ok;
}
function nodeCheck(file) {
  const r = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', windowsHide: true });
  return r.status === 0 ? null : String(r.stderr || 'unknown syntax error').slice(0, 400);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
} catch (e) {
  console.error(`[validate-dsh] package.json 不可解析: ${e.message}`);
  process.exit(1);
}

// C1
check('C1', pkg.type === 'module', `type=${pkg.type}`, 'ESM only 红线');
// C2
const manifest = pkg.dsh ?? {};
check('C2', manifest.manifestVersion === 1, `dsh.manifestVersion=${manifest.manifestVersion}`, '当前唯一清单版本');
// C3
const client = manifest.client ?? {};
check('C3', client.platform === 'web', `client.platform=${client.platform}`, 'dsh-client-modules:714 规范值');
// C4
const inject = Array.isArray(client.inject) ? client.inject : null;
check(
  'C4',
  inject !== null && inject.every((s) => /^@deepseek-ai\//.test(s)),
  `client.inject=${JSON.stringify(inject)}`,
  '客户端 inject 是模块图边，只允许官方包（B4）',
);
// C5/C6
const exportsMap = pkg.exports ?? {};
const clientEntry = exportsMap['./client'];
check('C5', typeof clientEntry === 'string' && existsSync(join(PLUGIN_ROOT, clientEntry)), `./client → ${clientEntry}`, 'dsh-client-modules:170-181 缺失即 throw');
check('C6', typeof exportsMap['.'] === 'string' && typeof exportsMap['./package.json'] === 'string' && typeof exportsMap['./locale/*.json'] === 'string', `exports keys=${Object.keys(exportsMap).join(',')}`);
// C7
let localeOk = true;
let localeDetail = '';
try {
  const en = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'locale', 'en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'locale', 'zh.json'), 'utf8'));
  const metaOk = (d) => d && d.meta && typeof d.meta.title === 'string' && d.meta.title.length > 0 && typeof d.meta.description === 'string' && d.meta.description.length > 0;
  const parity = JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(zh).sort());
  localeOk = metaOk(en) && metaOk(zh) && parity;
  localeDetail = `title en="${en?.meta?.title}" zh="${zh?.meta?.title}"；键集对齐=${parity}`;
} catch (e) {
  localeOk = false;
  localeDetail = e.message;
}
check('C7', localeOk, localeDetail, 'i18n 纪律 + locale/meta 形状');
// C8
const ICON_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
let iconDetail = 'icon 字段缺失';
let iconOk = false;
if (typeof pkg.icon === 'string') {
  const iconPath = join(PLUGIN_ROOT, pkg.icon.replace(/^\.\//, ''));
  const ext = extname(iconPath).toLowerCase();
  if (existsSync(iconPath) && ICON_EXTS.includes(ext)) {
    const size = statSync(iconPath).size;
    iconOk = size <= 256 * 1024;
    iconDetail = `${pkg.icon} = ${size} B (≤262144)`;
  } else {
    iconDetail = `${pkg.icon} 不存在或后缀不在白名单（${ext}）`;
  }
}
check('C8', iconOk, iconDetail, 'icon ≤256KiB，.svg/.png/.jpg/.jpeg/.webp');
// C9
const clientJs = join(PLUGIN_ROOT, 'dist', 'client.js');
let c9 = existsSync(clientJs);
let c9Detail = c9 ? '' : 'dist/client.js 不存在';
if (c9) {
  const text = readFileSync(clientJs, 'utf8');
  const wrapped = text.includes('__ModuleLoader__') && text.includes('.load(') && text.includes('factory');
  const syntax = nodeCheck(clientJs);
  c9 = wrapped && !syntax;
  c9Detail = `__ModuleLoader__.load 包装=${wrapped}${syntax ? `；语法: ${syntax}` : ''}`;
}
check('C9', c9, c9Detail, '客户端加载契约（wrap-client-bundle.mjs）');
// C10
const hostJs = join(PLUGIN_ROOT, 'dist', 'host.js');
let c10 = existsSync(hostJs);
let c10Detail = c10 ? '' : 'dist/host.js 不存在';
if (c10) {
  const syntax = nodeCheck(hostJs);
  let runtime = '';
  if (!syntax) {
    try {
      const mod = await import(pathToFileURL(hostJs).href);
      const okApi = typeof mod.apply === 'function';
      const okInject = Array.isArray(mod.inject) && mod.inject.length > 0 && mod.inject.every((s) => typeof s === 'string');
      runtime = `apply=${okApi} inject=${JSON.stringify(mod.inject)}`;
      c10 = okApi && okInject && mod.name === 'dsh-anic';
    } catch (e) {
      runtime = `动态 import 失败: ${e.message}`;
      c10 = false;
    }
  }
  c10Detail = `${syntax ? `语法: ${syntax}` : runtime}`;
}
check('C10', c10, c10Detail, '宿主入口：apply + inject（必需服务清单）');
// C11
if (manifest.bundle?.patch) {
  check('C11', existsSync(join(PLUGIN_ROOT, manifest.bundle.patch)), `bundle.patch=${manifest.bundle.patch}`, '声明的 patch 文件必须存在');
} else {
  results.push({ id: 'C11', ok: true, detail: '未声明 bundle.patch（宿主使用默认配置）—— info', evidence: '' });
}
// C12
check('C12', existsSync(join(PLUGIN_ROOT, 'README.md')), 'README.md 存在', '安装/J0 说明载体');

const failed = results.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ plugin: pkg.name, passed: failed.length === 0, results }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.ok ? '  [PASS]' : '[FAIL]'} ${r.id}  ${r.detail}${r.evidence ? `    # ${r.evidence}` : ''}`);
  }
  console.log('');
  console.log(failed.length === 0
    ? `DSH VALIDATION PASSED — ${results.length} checks（${pkg.name}@${pkg.version}）`
    : `DSH VALIDATION FAILED — ${failed.length}/${results.length}: ${failed.map((f) => f.id).join(', ')}`);
}
process.exit(failed.length === 0 ? 0 : 1);
