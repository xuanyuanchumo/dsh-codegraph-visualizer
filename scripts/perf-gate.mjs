#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const log = (msg) => process.stdout.write(`[perf-gate] ${msg}\n`);

// Runs the vitest CLI without a shell, so no cmd-only redirection (such as `2>nul`) is
// needed and the command behaves the same on the ubuntu runner and on Windows. vitest
// exits non-zero when tests fail but still prints the JSON report, so stdout is returned
// either way and the exit status is reported alongside it. The JSON report is over 1MB,
// well past Node's 1MB default buffer, so maxBuffer is raised deliberately.
const runVitest = (args) => {
  const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
  try {
    const stdout = execFileSync(process.execPath, [vitest, ...args], {
      encoding: 'utf-8',
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? '' };
  }
};

// Parses the JSON report, tolerating any banner text vitest may print around it.
const parseReport = (stdout) => {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    return JSON.parse(stdout.slice(start, end + 1));
  }
};

// A gate reports { pass, optional }. `optional` is the ONLY case in which a skip counts as
// success; every required gate must genuinely measure and pass, because "nothing was
// built" must not read as "performance is fine".
const gates = [
  { name: 'client bundle size', check: () => {
    const path = 'dist/client.js';
    if (!existsSync(path)) { log(`FAIL: ${path} not found (build first)`); return { pass: false }; }
    const size = readFileSync(path).length;
    const limit = 3 * 1024 * 1024;
    log(`client bundle: ${(size / 1024 / 1024).toFixed(2)}MB / ${(limit / 1024 / 1024).toFixed(0)}MB`);
    return { pass: size <= limit };
  }},
  { name: 'host bundle size', check: () => {
    const path = 'dist/index.js';
    if (!existsSync(path)) { log(`FAIL: ${path} not found (build first)`); return { pass: false }; }
    const size = readFileSync(path).length;
    const limit = 512 * 1024;
    log(`host bundle: ${(size / 1024).toFixed(0)}KB / ${(limit / 1024).toFixed(0)}KB`);
    return { pass: size <= limit };
  }},
  { name: 'test count >= 4463', check: () => {
    const result = runVitest(['run', '--reporter=json']);
    let total;
    try {
      total = parseReport(result.stdout).numTotalTests ?? 0;
    } catch {
      log('FAIL: could not parse vitest JSON output');
      log(`vitest exit: ${result.ok ? 'ok' : 'non-zero'}`);
      log((result.stderr || result.stdout).trim().slice(0, 500));
      return { pass: false };
    }
    // Test pass/fail is the `pnpm run test` job's business; this gate measures coverage
    // of the test suite's size, so a non-zero exit still yields a real measurement.
    if (!result.ok) {
      log('vitest reported failing tests; measuring the collected test count anyway');
    }
    log(`test count: ${total} / 4463`);
    return { pass: total >= 4463 };
  }},
];

log('Running performance gates...');
let allPassed = true;
for (const gate of gates) {
  let result;
  try {
    result = gate.check();
  } catch (error) {
    log(`FAIL: ${gate.name} threw: ${error.message}`);
    result = { pass: false };
  }
  if (gate.optional === true && result.pass === false) {
    log(`SKIP: ${gate.name} (optional check)`);
    continue;
  }
  if (!result.pass) {
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
