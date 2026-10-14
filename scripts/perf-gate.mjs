#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const log = (msg) => process.stdout.write(`[perf-gate] ${msg}\n`);

// ── 绝对预算（产品验收线，不是历史测量值）────────────────────────────────
// client 3MB / host 512KB 是打包体积的验收上限，与 docs/测试体系.md §4.1 以及
// tests/unit/perfBaselineContract.test.ts 的断言保持同步。
const BUDGET = {
  clientBundleBytes: 3 * 1024 * 1024,
  hostBundleBytes: 512 * 1024,
};

// ── 基线棘轮（P3-R27-02 修复）────────────────────────────────────────────
// 原实现是 `test count >= 4463` —— 一个 2026-10-01 初始提交
// （edf7f90 "ci: add performance gates and E2E tests to CI pipeline"）里就存在的
// 硬编码字面量，仓库里没有任何推导依据，也没有人能说明 4463 是怎么来的。
// 一个无人能解释的下限既无法审查，也无法在它失效时判断该改门禁还是该补测试。
//
// 现在把"下限"改成**已提交的基线记录**：scripts/perf-baseline.json 保存最近一次
// 真实测量值 + 记录日期 + 记录时的 commit。门禁语义 = "测试用例总数不得低于基线"，
// 即只拦截"套件被静默删小"，不拦截正常增长；数字的来源就写在那个文件里，可审计。
//
// 为什么不直接删掉这一档：它是唯一能发现"有人删掉了一批测试文件"的守卫 ——
// 覆盖率阈值看的是比例，整文件删除时比例甚至可能上升。
//
// 为什么 `--update-baseline` 不像 `--update-snapshots` 那样危险：基线是一个
// 单行 JSON 的**已提交文本文件**，改动会完整出现在 review diff 里，而不是悄悄
// 重写一批二进制；更新动作必须由人显式执行并提交。
const BASELINE_PATH = 'scripts/perf-baseline.json';
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

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

/** 读取基线；缺失或字段非法时返回 null，由调用方响亮失败（绝不静默放行）。 */
const loadBaseline = () => {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    if (!Number.isInteger(parsed.testCount) || parsed.testCount <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

const shortCommit = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
};

const measure = () => {
  const clientBundleBytes = existsSync('dist/client.js') ? readFileSync('dist/client.js').length : null;
  const hostBundleBytes = existsSync('dist/index.js') ? readFileSync('dist/index.js').length : null;
  const result = runVitest(['run', '--reporter=json']);
  let testCount = null;
  try {
    testCount = parseReport(result.stdout).numTotalTests ?? 0;
  } catch {
    testCount = null;
  }
  // Test pass/fail is the `pnpm run test` job's business; this gate measures the size of
  // the test suite, so a non-zero exit still yields a real measurement.
  if (!result.ok) log('vitest reported failing tests; measuring the collected test count anyway');
  return { clientBundleBytes, hostBundleBytes, testCount, vitestOk: result.ok, stderr: result.stderr ?? '' };
};

const m = measure();

if (UPDATE_BASELINE) {
  const record = {
    // 由 `node scripts/perf-gate.mjs --update-baseline` 写入；每次更新都会在 review diff 里可见。
    recordedAt: new Date().toISOString().slice(0, 10),
    commit: shortCommit(),
    testCount: m.testCount,
    clientBundleBytes: m.clientBundleBytes,
    hostBundleBytes: m.hostBundleBytes,
  };
  if (m.testCount === null || m.clientBundleBytes === null || m.hostBundleBytes === null) {
    log('FAIL: cannot record a baseline from an incomplete measurement');
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(record, null, 2)}\n`);
  log(`baseline recorded -> ${BASELINE_PATH}`);
  log(`  commit ${record.commit}  tests ${record.testCount}  client ${(record.clientBundleBytes / 1024 / 1024).toFixed(2)}MB  host ${(record.hostBundleBytes / 1024).toFixed(0)}KB`);
  process.exit(0);
}

const baseline = loadBaseline();

// A gate reports { pass, optional }. `optional` is the ONLY case in which a skip counts as
// success; every required gate must genuinely measure and pass, because "nothing was
// built" must not read as "performance is fine".
const gates = [
  { name: 'client bundle size', check: () => {
    if (m.clientBundleBytes === null) { log('FAIL: dist/client.js not found (build first)'); return { pass: false }; }
    log(`client bundle: ${(m.clientBundleBytes / 1024 / 1024).toFixed(2)}MB / ${(BUDGET.clientBundleBytes / 1024 / 1024).toFixed(0)}MB`);
    return { pass: m.clientBundleBytes <= BUDGET.clientBundleBytes };
  }},
  { name: 'host bundle size', check: () => {
    if (m.hostBundleBytes === null) { log('FAIL: dist/index.js not found (build first)'); return { pass: false }; }
    log(`host bundle: ${(m.hostBundleBytes / 1024).toFixed(0)}KB / ${(BUDGET.hostBundleBytes / 1024).toFixed(0)}KB`);
    return { pass: m.hostBundleBytes <= BUDGET.hostBundleBytes };
  }},
  { name: 'test count not below the recorded baseline', check: () => {
    if (m.testCount === null) {
      log('FAIL: could not parse vitest JSON output');
      log(`vitest exit: ${m.vitestOk ? 'ok' : 'non-zero'}`);
      log((m.stderr || '').trim().slice(0, 500));
      return { pass: false };
    }
    if (baseline === null) {
      log(`FAIL: ${BASELINE_PATH} missing or malformed (run: node scripts/perf-gate.mjs --update-baseline)`);
      return { pass: false };
    }
    log(`test count: ${m.testCount} / baseline ${baseline.testCount} (recorded ${baseline.recordedAt} @ ${baseline.commit})`);
    return { pass: m.testCount >= baseline.testCount };
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
