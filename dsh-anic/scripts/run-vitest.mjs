#!/usr/bin/env node
/**
 * 以父工程 vitest 运行 dsh-anic 单元/契约测试。
 *
 * dsh-anic 是独立插件工程，不自带 node_modules 测试依赖；从本目录向上找到
 * 最近一个含 node_modules/vitest/vitest.mjs 的仓库根即可（link: 安装下即父工程）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let vitestMjs = null;
let cur = PLUGIN_ROOT;
for (let i = 0; i < 6; i++) {
  const candidate = join(cur, 'node_modules', 'vitest', 'vitest.mjs');
  if (existsSync(candidate)) { vitestMjs = candidate; break; }
  const next = dirname(cur);
  if (next === cur) break;
  cur = next;
}
if (!vitestMjs) {
  console.error('[dsh-anic] 找不到 vitest —— 请先在父工程（仓库根）pnpm install。');
  process.exit(2);
}

const extra = process.argv.slice(2);
const res = spawnSync(
  process.execPath,
  [vitestMjs, 'run', '--config', join(PLUGIN_ROOT, 'vitest.config.ts'), '--root', PLUGIN_ROOT, ...extra],
  { stdio: 'inherit', cwd: PLUGIN_ROOT, windowsHide: true },
);
process.exit(res.status ?? 1);
