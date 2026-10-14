#!/usr/bin/env node
/**
 * dsh-anic typecheck — 运行 tsconfig.client.json 与 tsconfig.host.json。
 *
 * tsc 不在 dsh-anic 自己的 node_modules（独立性宪章 TD-A1：当前借用父工程
 * node_modules 是过渡态），所以像 build-client.mjs 的 findTsdown 一样向上查找。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, '..');

function findTsc() {
  let probe = pluginDir;
  for (let i = 0; i < 4; i++) {
    const bin = join(probe, 'node_modules', 'typescript', 'bin', 'tsc');
    if (existsSync(bin)) return bin;
    probe = join(probe, '..');
  }
  return null;
}

const tsc = findTsc();
if (!tsc) {
  console.error('[typecheck] tsc not found in any ancestor node_modules/typescript/bin/tsc');
  process.exit(1);
}

const configs = ['tsconfig.client.json', 'tsconfig.host.json'];
let failed = false;
for (const cfg of configs) {
  const r = spawnSync(process.execPath, [tsc, '-p', cfg, '--noEmit'], {
    cwd: pluginDir,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    failed = true;
    console.error(`[typecheck] ${cfg} failed (exit ${r.status})`);
  }
}
process.exit(failed ? 1 : 0);
