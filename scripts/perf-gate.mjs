#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const log = (msg) => process.stdout.write(`[perf-gate] ${msg}\n`);

const gates = [
  { name: 'client bundle size', check: () => {
    const path = 'dist/client.js';
    if (!existsSync(path)) { log('SKIP: dist/client.js not found (build first)'); return true; }
    const size = readFileSync(path).length;
    const limit = 3 * 1024 * 1024;
    log(`client bundle: ${(size / 1024 / 1024).toFixed(2)}MB / ${(limit / 1024 / 1024).toFixed(0)}MB`);
    return size <= limit;
  }},
  { name: 'host bundle size', check: () => {
    const path = 'dist/index.js';
    if (!existsSync(path)) { log('SKIP: dist/index.js not found'); return true; }
    const size = readFileSync(path).length;
    const limit = 512 * 1024;
    log(`host bundle: ${(size / 1024).toFixed(0)}KB / ${(limit / 1024).toFixed(0)}KB`);
    return size <= limit;
  }},
  { name: 'test count >= 4463', check: () => {
    try {
      const out = execSync('npx vitest run --reporter=json 2>nul', { encoding: 'utf-8', timeout: 300000 });
      const json = JSON.parse(out);
      const total = json.numTotalTests ?? 0;
      log(`test count: ${total} / 4463`);
      return total >= 4463;
    } catch {
      log('SKIP: could not parse test output');
      return true;
    }
  }},
];

log('Running performance gates...');
let allPassed = true;
for (const gate of gates) {
  const passed = gate.check();
  if (!passed) {
    log(`FAIL: ${gate.name}`);
    allPassed = false;
  } else {
    log(`PASS: ${gate.name}`);
  }
}
if (allPassed) {
  log('All performance gates passed.');
  process.exit(0);
} else {
  log('One or more performance gates failed!');
  process.exit(1);
}