#!/usr/bin/env node
/**
 * dsh-anic 测试编排器 —— 一条命令跑完可离线执行的全部层：
 *
 *   [1/3] validate-dsh    DSH 规范符合性门（清单/exports/locale/icon/产物）
 *   [2/3] vitest          单元（snapshotCore/snapshotRoute/apply）+ 契约守卫
 *   [3/3] offline-smoke   机制冒烟（stub 宿主 19 断言）
 *
 * 用法：
 *   node scripts/run-tests.mjs            # 全部离线层
 *   node scripts/run-tests.mjs --live     # 追加 [4/4] j0-probe（需 start-dsh-test.mjs 环境）
 *   node scripts/run-tests.mjs --only=vitest
 *
 * 任一层失败即停后续层（fail-fast）并退出 1；全绿打印汇总表退出 0。
 */
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const live = argv.includes('--live');
const only = argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;

const STEPS = [
  { id: 'validate', cmd: [process.execPath, join(PLUGIN_ROOT, 'scripts', 'validate-dsh.mjs')], label: 'DSH 规范符合性门' },
  { id: 'vitest', cmd: [process.execPath, join(PLUGIN_ROOT, 'scripts', 'run-vitest.mjs')], label: '单元 + 契约守卫 (vitest)' },
  { id: 'smoke', cmd: [process.execPath, join(PLUGIN_ROOT, 'scripts', 'offline-smoke.mjs')], label: '机制冒烟 (stub 宿主)' },
];
if (live) STEPS.push({ id: 'live', cmd: [process.execPath, join(PLUGIN_ROOT, 'scripts', 'j0-probe.mjs')], label: '真实宿主 E2E (J0 probe)' });

const results = [];
let failed = false;
for (const [i, step] of STEPS.entries()) {
  if (only && step.id !== only) continue;
  if (failed && !only) {
    results.push({ ...step, ok: null, note: 'skipped（前序失败）' });
    continue;
  }
  process.stdout.write(`\n=== [${i + 1}/${STEPS.length}] ${step.label} ===\n`);
  const t0 = Date.now();
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), { stdio: 'inherit', cwd: PLUGIN_ROOT, windowsHide: true });
  const ok = (r.status ?? 1) === 0;
  results.push({ ...step, ok, note: `${((Date.now() - t0) / 1000).toFixed(1)}s` });
  if (!ok) failed = true;
}

console.log('\n=== 测试汇总 ===');
for (const r of results) {
  const mark = r.ok === null ? ' ⏭ SKIP ' : r.ok ? ' ✅ PASS' : ' ❌ FAIL';
  console.log(`${mark}  ${r.id.padEnd(9)} ${r.label}  ${r.note ?? ''}`);
}
if (results.every((r) => r.ok === true)) console.log('\nALL GREEN');
process.exit(results.some((r) => r.ok === false) ? 1 : 0);
