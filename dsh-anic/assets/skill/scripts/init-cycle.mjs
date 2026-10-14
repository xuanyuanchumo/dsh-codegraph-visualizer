#!/usr/bin/env node
// init-cycle.mjs — 初始化循环工作区 cycle-{N}/
// 用法: node scripts/init-cycle.mjs <project-dir> [--cycle N]

import { mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { _: [], cycle: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cycle') args.cycle = parseInt(argv[++i], 10);
    else args._.push(arg);
  }
  return args;
}

function getNextCycleNum(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  if (!existsSync(cyclesDir)) return 1;
  const entries = readdirSync(cyclesDir).filter(e => e.startsWith('cycle-'));
  if (entries.length === 0) return 1;
  const nums = entries.map(e => parseInt(e.replace('cycle-', ''), 10));
  return Math.max(...nums) + 1;
}

function scaffoldCycle(projectDir, cycleNum) {
  const cycleDir = join(projectDir, '.cycles', 'cycles', `cycle-${cycleNum}`);
  const subdirs = ['subplans', 'test-reports'];

  for (const d of subdirs) {
    const p = join(cycleDir, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  const templateDir = join(SKILL_ROOT, 'assets', 'templates');
  const filesToCopy = [
    ['eval-report.md', '项目评估报告.md'],
    ['cycle-plan.md', '当前循环总规划.md'],
    ['task-list.md', '任务清单.md'],
    ['page-state.md', '当前循环页面状态.md'],
    ['audit-log.md', '审计日志.md'],
    ['delivery-checklist.md', '交付清单.md'],
    ['non-functional-report.md', '非功能验证报告.md'],
  ];

  for (const [template, name] of filesToCopy) {
    const src = join(templateDir, template);
    const dst = join(cycleDir, name);
    if (existsSync(src) && !existsSync(dst)) {
      let content = readFileSync(src, 'utf-8');
      content = content.replace(/cycle-\{N\}/g, `cycle-${cycleNum}`);
      atomicWriteFileSync(dst, content);
    }
  }

  console.log(`Initialized cycle-${cycleNum} workspace in ${cycleDir}`);
}


const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node init-cycle.mjs <project-dir> [--cycle N]');
  process.exit(1);
}
const cycleNum = args.cycle || getNextCycleNum(args._[0]);
scaffoldCycle(args._[0], cycleNum);