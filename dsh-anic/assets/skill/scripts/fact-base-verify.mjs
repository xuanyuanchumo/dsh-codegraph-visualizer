#!/usr/bin/env node
// fact-base-verify.mjs — 事实基座抽验：验证文档引用的路径/命令在仓库真实存在
// 用法: node scripts/fact-base-verify.mjs <project-dir> [--count 5]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

function parseArgs(argv) {
  const args = { _: [], count: 5 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = parseInt(argv[++i], 10);
    else args._.push(argv[i]);
  }
  return args;
}

function extractReferences(projectDir) {
  const refs = [];
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  if (!existsSync(cyclesDir)) return refs;

  const cycleDirs = readdirSync(cyclesDir).filter(e => e.startsWith('cycle-'));
  for (const cd of cycleDirs) {
    const evalReport = join(cyclesDir, cd, '项目评估报告.md');
    if (existsSync(evalReport)) {
      const content = readFileSync(evalReport, 'utf-8');
      const pathPattern = /`([^`]+\.(ts|js|py|go|rs|java|md|json|yaml|yml))`/g;
      let match;
      while ((match = pathPattern.exec(content)) !== null) {
        refs.push({ type: 'path', value: match[1], source: evalReport });
      }
      const cmdPattern = /`(pnpm|npm|yarn|make|cargo|python|node)\s+[^`]+`/g;
      while ((match = cmdPattern.exec(content)) !== null) {
        refs.push({ type: 'command', value: match[1], source: evalReport });
      }
    }
  }
  return refs;
}

function verifyReferences(projectDir, refs, count) {
  const sample = refs.sort(() => Math.random() - 0.5).slice(0, count);
  const results = [];

  for (const ref of sample) {
    if (ref.type === 'path') {
      const fullPath = join(projectDir, ref.value);
      const exists = existsSync(fullPath);
      results.push({ ref, exists, detail: exists ? 'OK' : 'NOT FOUND' });
    } else if (ref.type === 'command') {
      try {
        execSync(`${ref.value} --help`, { cwd: projectDir, timeout: 5000, stdio: 'pipe' });
        results.push({ ref, exists: true, detail: 'OK' });
      } catch {
        results.push({ ref, exists: false, detail: 'COMMAND FAILED' });
      }
    }
  }

  return results;
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node fact-base-verify.mjs <project-dir> [--count 5]');
  process.exit(1);
}

const refs = extractReferences(args._[0]);
if (refs.length === 0) {
  console.log('No references found to verify.');
  process.exit(0);
}

const results = verifyReferences(args._[0], refs, args.count);
const failures = results.filter(r => !r.exists);

console.log(`Fact-base verification: ${results.length - failures.length}/${results.length} passed`);
for (const r of results) {
  const status = r.exists ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${r.ref.type}: ${r.ref.value} (${r.detail})`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} reference(s) not found. Fix documentation before proceeding.`);
  process.exit(1);
}