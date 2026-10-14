#!/usr/bin/env node
// archive-cycle.mjs — 循环归档：将已完成循环移动到归档目录，清理临时文件
// 用法:
//   归档: node archive-cycle.mjs <project-dir> --cycle <N>
//   清理: node archive-cycle.mjs <project-dir> --clean [--keep <N>]
//   列表: node archive-cycle.mjs <project-dir> --list

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listCycleDirNames } from './lib/cycle.mjs';
import { summarizeTaskRows } from './lib/tasks.mjs';

function parseArgs(argv) {
  const args = { _: [], cycle: null, clean: false, list: false, keep: 5 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--cycle') args.cycle = parseInt(argv[++i], 10);
    else if (argv[i] === '--clean') args.clean = true;
    else if (argv[i] === '--list') args.list = true;
    else if (argv[i] === '--keep') args.keep = parseInt(argv[++i], 10);
    else args._.push(argv[i]);
  }
  return args;
}

function getCycles(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  // v1.8.3：数值序（原 .sort() 字典序在 cycle-10 与 cycle-2 并存时列表顺序错乱）
  return listCycleDirNames(cyclesDir);
}

function getArchivedCycles(projectDir) {
  const archiveDir = join(projectDir, '.cycles', 'archive');
  return listCycleDirNames(archiveDir);
}

function isCycleComplete(projectDir, cycleName) {
  const cyclePath = join(projectDir, '.cycles', 'cycles', cycleName);
  if (!existsSync(cyclePath)) return false;

  const taskListPath = join(cyclePath, '任务清单.md');
  if (!existsSync(taskListPath)) return false;

  // v1.8.3：与 gate-check G1 共用 lib/tasks.mjs 同一解析器。
  // 原先整文件 includes('待办')——init-cycle 模板自带图例"待办 → 进行中 → 完成"，
  // 刚初始化的 cycle 永远被判 in-progress（与 G1 修复前同一自陷家族）。
  const { total, pendingCount } = summarizeTaskRows(readFileSync(taskListPath, 'utf-8'));
  return total > 0 && pendingCount === 0;
}

function archiveCycle(projectDir, cycleNum) {
  const cycleName = `cycle-${cycleNum}`;
  const cyclePath = join(projectDir, '.cycles', 'cycles', cycleName);
  if (!existsSync(cyclePath)) {
    console.error(`Cycle ${cycleName} not found.`);
    process.exit(1);
  }

  if (!isCycleComplete(projectDir, cycleName)) {
    console.error(`Cycle ${cycleName} has pending tasks. Complete all tasks before archiving.`);
    process.exit(1);
  }

  const archiveDir = join(projectDir, '.cycles', 'archive');
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  const archivePath = join(archiveDir, cycleName);
  if (existsSync(archivePath)) {
    console.error(`Cycle ${cycleName} already archived.`);
    process.exit(1);
  }

  renameSync(cyclePath, archivePath);
  console.log(`Archived ${cycleName} to ${archivePath}`);

  // v1.8.3 修（INV-9，docs/anic/05 §4.3 / 08 §3.5）：账本是只追加哈希链。
  // 原先此处按 detail 是否含 cycle-N 删条目并整文件重写账本——被删条目之后
  // 每条 entry 的 previousHash 都指向已删除的条目，下一次 verifyLedger 必报
  // CHAIN_BREAK，整条链从此不可信。归档只移动目录，永不触碰账本；
  // 历史记录的保留由归档目录 + 索引负责，不在账本上做减法。
  console.log('  Ledger untouched (append-only hash chain, INV-9).');
}

function cleanOldArchives(projectDir, keepCount) {
  const archiveDir = join(projectDir, '.cycles', 'archive');
  if (!existsSync(archiveDir)) {
    console.log('No archive directory.');
    return;
  }

  const archived = getArchivedCycles(projectDir);
  if (archived.length <= keepCount) {
    console.log(`Only ${archived.length} archived cycles, keeping all (limit: ${keepCount}).`);
    return;
  }

  const toRemove = archived.slice(0, archived.length - keepCount);
  for (const cycle of toRemove) {
    const path = join(archiveDir, cycle);
    rmSync(path, { recursive: true });
    console.log(`Removed old archive: ${cycle}`);
  }
  console.log(`Cleaned ${toRemove.length} old archive(s), keeping ${keepCount}.`);
}

function listCycles(projectDir) {
  const active = getCycles(projectDir);
  const archived = getArchivedCycles(projectDir);

  console.log(`=== Cycle Inventory ===`);
  console.log(``);
  console.log(`Active Cycles (${active.length}):`);
  for (const c of active) {
    const complete = isCycleComplete(projectDir, c);
    console.log(`  ${c} ${complete ? '[complete]' : '[in-progress]'}`);
  }

  console.log(``);
  console.log(`Archived Cycles (${archived.length}):`);
  for (const c of archived) {
    const archivePath = join(projectDir, '.cycles', 'archive', c);
    const stat = statSync(archivePath);
    console.log(`  ${c} [archived ${stat.mtime.toISOString().substring(0, 10)}]`);
  }

  console.log(``);
  console.log(`=== End of Inventory ===`);
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node archive-cycle.mjs <project-dir> --cycle <N> | --clean [--keep <N>] | --list');
  process.exit(1);
}

const projectDir = resolve(args._[0]);

if (args.list) {
  listCycles(projectDir);
} else if (args.clean) {
  cleanOldArchives(projectDir, args.keep);
} else if (args.cycle) {
  archiveCycle(projectDir, args.cycle);
} else {
  console.error('Must specify --cycle <N>, --clean, or --list');
  process.exit(1);
}