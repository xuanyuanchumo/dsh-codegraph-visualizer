#!/usr/bin/env node
/**
 * dsh-anic build — client bundle + host bundle.
 *
 * Client: tsdown → CJS → wrapped into window.__ModuleLoader__.load({...})
 * (the only shape DSH web executes for /plugins/<name>/client.js).
 * react / react-dom stay external — they resolve through the loader's
 * factory.require against the HOST's copies (version skew is the host's
 * business; we must not double-bundle them).
 *
 * Host: tsdown → ESM dist/host.js (exports["."]).
 *
 * 热更新模式：`node scripts/build-client.mjs --watch`
 *   tsdown --watch 持续重建 dist/client-cjs/；fs.watch 监听其输出并在每次重建后
 *   重新 wrap 到 dist/client.js —— 插件以 link: 安装时，dist/client.js 就是宿主
 *   实际加载的文件，保存源码 → 重建 → 重 wrap → 浏览器刷新即生效（bundle 级热更新）。
 *   watch 模式只管 client（host 变更极少，需要时全量 build）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, existsSync, readdirSync, watch, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, '..');
const distDir = join(pluginDir, 'dist');
const cjsDir = join(distDir, 'client-cjs');
const watchMode = process.argv.includes('--watch');

function findTsdown() {
  // tsdown lives in the parent workspace's node_modules (pnpm); walk up.
  let probe = pluginDir;
  for (let i = 0; i < 4; i++) {
    const bin = join(probe, 'node_modules', '.bin', process.platform === 'win32' ? 'tsdown.CMD' : 'tsdown');
    if (existsSync(bin)) return bin;
    probe = join(probe, '..');
  }
  return 'tsdown';
}

const CLIENT_ARGS = [
  'src/client/index.ts',
  '--format', 'cjs',
  '--outDir', 'dist/client-cjs',
  '--platform', 'browser',
  '--external', 'react',
  '--external', 'react-dom',
];

function run(args) {
  const r = spawnSync(findTsdown(), args, { cwd: pluginDir, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[build-client] tsdown failed: ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

function wrapOnce() {
  const files = existsSync(cjsDir) ? readdirSync(cjsDir) : [];
  const cjsFile = files.find((f) => f.endsWith('.cjs') || f.endsWith('.js'));
  if (!cjsFile) {
    console.error('[build-client] no CJS output found in dist/client-cjs');
    return false;
  }
  const r = spawnSync(process.execPath, [
    join(here, 'wrap-client-bundle.mjs'),
    join(cjsDir, cjsFile),
    join(distDir, 'client.js'),
    'dsh-anic',
  ], { stdio: 'inherit' });
  return r.status === 0;
}

function buildHost() {
  run(['src/index.ts', '--format', 'esm', '--outDir', 'dist/host-esm']);
  const hostDir = join(distDir, 'host-esm');
  const hostFile = readdirSync(hostDir).find((f) => f.endsWith('.js'));
  if (!hostFile) {
    console.error('[build-client] no ESM host output found in dist/host-esm');
    process.exit(1);
  }
  renameSync(join(hostDir, hostFile), join(distDir, 'host.js'));
  rmSync(hostDir, { recursive: true, force: true });
}

if (watchMode) {
  rmSync(distDir, { recursive: true, force: true });
  const child = spawn(findTsdown(), [...CLIENT_ARGS, '--watch'], { cwd: pluginDir, stdio: 'inherit', shell: true });
  let timer = null;
  let watcherAttached = false;
  const attachWatcher = () => {
    if (watcherAttached || !existsSync(cjsDir)) return;
    watcherAttached = true;
    watch(cjsDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log('[build-client:watch] client-cjs changed → re-wrapping dist/client.js');
        wrapOnce();
      }, 400);
    });
    console.log('[build-client:watch] watching dist/client-cjs → dist/client.js (link: 安装下保存即热更新)');
  };
  const poll = setInterval(attachWatcher, 500);
  child.on('exit', (code) => {
    clearInterval(poll);
    clearTimeout(timer);
    process.exit(code ?? 0);
  });
} else {
  rmSync(distDir, { recursive: true, force: true });
  run(CLIENT_ARGS);
  if (!wrapOnce()) process.exit(1);
  buildHost();
  rmSync(cjsDir, { recursive: true, force: true });
  console.log('[build-client] done: dist/client.js + dist/host.js');
}
