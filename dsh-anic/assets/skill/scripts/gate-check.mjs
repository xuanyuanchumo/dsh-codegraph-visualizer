#!/usr/bin/env node
// gate-check.mjs — G0-G3 收敛门禁 + 质量门禁自动判定
// 用法: node scripts/gate-check.mjs <project-dir> [--gate G0|G1|G2|G3|all] [--quality] [--record]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadProjectConfig, getYamlString } from './lib/config.mjs';
import { getLatestCycleDir } from './lib/cycle.mjs';
import { parseTaskRows } from './lib/tasks.mjs';
import { appendEntry, loadLedger } from './lib/ledger.mjs';

function parseArgs(argv) {
  const args = { _: [], gate: 'all', quality: false, record: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--gate') args.gate = argv[++i];
    else if (argv[i] === '--quality') args.quality = true;
    else if (argv[i] === '--record') args.record = true; // 修 N-2：门禁结果自动入账本（默认关闭，行为兼容）
    else args._.push(argv[i]);
  }
  return args;
}

// 修 S-1：唯一 config 入口。原先读从未被 init-workflow 创建的 .cycles/cycle-config.yml，
// 且错误提示自相矛盾（"No .cycles/cycle-config.yml found. Run init-workflow first."——
// init-workflow 生成的是 config.yml）。缺配置 = 响亮失败，提示指向正确文件。
function loadConfig(projectDir) {
  try {
    return loadProjectConfig(projectDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// 修字典序缺陷：数值序取最新 cycle（原 .sort().pop() 在 cycle-10 之后选错目录）
const getLatestCycle = getLatestCycleDir;

function checkG0(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  if (!existsSync(cyclesDir)) return { pass: false, detail: 'No .cycles directory' };

  // 修字典序缺陷：统一走 lib/cycle.mjs 数值序（原 .sort().pop() 在 cycle-10 之后选错目录）
  const latestCycle = getLatestCycle(projectDir);
  if (!latestCycle) return { pass: false, detail: 'No cycle workspace' };

  const evalReport = join(cyclesDir, latestCycle, '项目评估报告.md');
  if (!existsSync(evalReport)) return { pass: false, detail: 'No evaluation report' };

  // 修 iteration-5（N-10 脚本侧）：存在性不是完整性。空报告、只有标题的报告、
  // 或维度行全被删掉的报告原先都能关闭 G0。门禁必须有裁决行作为证据。
  const evalContent = readFileSync(evalReport, 'utf-8');
  const verdictRows = evalContent.match(/^\|\s*(E[1-8]|Q[1-8])\s*\|/gm) || [];
  if (verdictRows.length === 0) {
    return { pass: false, detail: `Evaluation report has no dimension verdict rows (${latestCycle}/项目评估报告.md)` };
  }

  return { pass: true, detail: `Evaluation report found in ${latestCycle} (${verdictRows.length} dimension rows)` };
}

function checkG1(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  const latestCycle = getLatestCycle(projectDir);
  if (!latestCycle) return { pass: false, detail: 'No cycle workspace' };
  const taskList = join(cyclesDir, latestCycle, '任务清单.md');

  if (!existsSync(taskList)) return { pass: false, detail: 'No task list' };

  const content = readFileSync(taskList, 'utf-8');
  // 修 N-1（v1.8.0）：G1 从"整文件 includes('待办')"改为解析 P0-P3 任务表行。
  // v1.8.3：解析器抽到 lib/tasks.mjs（archive-cycle isCycleComplete 共用同一实现，
  // 消灭"G1 说完成、归档说没完成"的分叉）。
  const taskRows = parseTaskRows(content);

  if (taskRows.length === 0) return { pass: false, detail: 'No task entries found (fill the task tables in 任务清单.md)' };

  const pending = taskRows.filter(cells => cells[cells.length - 1] !== '完成');
  if (pending.length > 0) return { pass: false, detail: `${pending.length} of ${taskRows.length} tasks not completed` };
  return { pass: true, detail: `All ${taskRows.length} tasks completed` };
}

function checkG2(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  const latestCycle = getLatestCycle(projectDir);
  if (!latestCycle) return { pass: false, detail: 'No cycle workspace' };
  const testReportsDir = join(cyclesDir, latestCycle, 'test-reports');

  if (!existsSync(testReportsDir)) return { pass: false, detail: 'No test reports directory' };

  const reports = readdirSync(testReportsDir).filter(e => e.endsWith('.md'));
  if (reports.length === 0) return { pass: false, detail: 'No test reports' };

  // 修字典序（v1.8.0）：按修改时间取最新报告（原 .sort().pop() 字典序在
  // test-report-10 vs test-report-9 这类文件名上会选错"最新"）
  const latestReport = reports
    .map(f => ({ f, m: statSync(join(testReportsDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0].f;
  const content = readFileSync(join(testReportsDir, latestReport), 'utf-8');

  // 修 iteration-5：报告格式本身是契约（assets/templates/test-report.md §2 汇总表）。
  // 原先"失败/错误 行都不存在"会被解析成 0/0 并判 PASS——自由文本或残缺报告
  // 因此可以关掉 G2。格式无法识别 = 没有证据 = FAIL（不是 0 个失败）。
  if (!/^\|\s*(通过|失败|错误)\s*\|/m.test(content)) {
    return { pass: false, detail: `Test report summary not recognized: ${latestReport} has no 通过/失败 rows (expected the §2 汇总 table)` };
  }

  const failMatch = content.match(/\|\s*失败\s*\|\s*(\d+)\s*\|/);
  const errorMatch = content.match(/\|\s*错误\s*\|\s*(\d+)\s*\|/);

  const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
  const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0;

  if (failures > 0 || errors > 0) {
    return { pass: false, detail: `${failures} failures, ${errors} errors` };
  }
  return { pass: true, detail: `Zero failures, zero errors (${latestReport})` };
}

function checkG3(projectDir, configContent) {
  // 引号容错解析（修 S-8：统一走 lib/config.mjs，不再各自写要求双引号的正则）
  const buildCmd = getYamlString(configContent, 'build_cmd');

  if (!buildCmd) return { pass: false, detail: 'No build command configured' };

  try {
    execSync(buildCmd, { cwd: projectDir, timeout: 120000, stdio: 'pipe' });
    return { pass: true, detail: `Build passed: ${buildCmd}` };
  } catch (e) {
    return { pass: false, detail: `Build failed: ${buildCmd}` };
  }
}

function checkQualityGate(projectDir, configContent, gateId) {
  const cycleDir = getLatestCycle(projectDir);
  if (!cycleDir) return { pass: false, detail: 'No cycle directory' };

  const evalResultsPath = join(projectDir, '.cycles', 'cycles', cycleDir, '项目评估报告.md');
  if (!existsSync(evalResultsPath)) return { pass: false, detail: 'No eval results (run eval-runner first)' };

  const evalContent = readFileSync(evalResultsPath, 'utf-8');

  const qualityChecks = {
    G0: ['Q1', 'Q5'],
    G1: ['Q7'],
    G2: ['Q2'],
    G3: ['Q3', 'Q4'],
  };

  const checks = qualityChecks[gateId] || [];
  const failedChecks = [];
  const unevaluatedChecks = [];

  for (const q of checks) {
    // 修 iteration-5：三态。原先只有 'FAIL' 会被拦下——行缺失（match=null）与
    // SKIP（评估器无法评估）都静默通过，"缺证据=通过"正是 fail-open 的定义。
    const pattern = new RegExp(`^\\| ${q} \\|.*\\|\\s*(PASS|FAIL|SKIP)\\s*\\|`, 'm');
    const match = evalContent.match(pattern);
    if (!match) {
      unevaluatedChecks.push(`${q}(row absent)`);
    } else if (match[1] === 'SKIP') {
      unevaluatedChecks.push(`${q}(SKIP)`);
    } else if (match[1] === 'FAIL') {
      failedChecks.push(q);
    }
  }

  if (failedChecks.length > 0) {
    return { pass: false, detail: `Quality dimensions failed: ${failedChecks.join(', ')}` };
  }
  if (unevaluatedChecks.length > 0) {
    return { pass: false, detail: `Quality dimensions not evaluated — gate cannot close without evidence: ${unevaluatedChecks.join(', ')}` };
  }
  return { pass: true, detail: `Quality dimensions passed: ${checks.join(', ')}` };
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node gate-check.mjs <project-dir> [--gate G0|G1|G2|G3|all] [--quality] [--record]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);
const configContent = loadConfig(projectDir);

const gates = {
  G0: () => checkG0(projectDir),
  G1: () => checkG1(projectDir),
  G2: () => checkG2(projectDir),
  G3: () => checkG3(projectDir, configContent),
};

const gatesToCheck = args.gate === 'all' ? ['G0', 'G1', 'G2', 'G3'] : [args.gate];
let allPass = true;

for (const g of gatesToCheck) {
  const result = gates[g]();
  const status = result.pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${g}: ${result.detail}`);
  if (!result.pass) allPass = false;

  // 修 N-2（v1.8.0）：--record 时把门禁结果写入账本（PASS 与 FAIL 都记——
  // org-status 的 CB2 熔断条件依赖账本里的 FAIL 记录）。带去重：该门最新一条
  // 记录的 (result, detail) 与本次相同时跳过，重复运行不会污染账本。
  if (args.record) {
    const ledger = loadLedger(projectDir);
    const lastForGate = [...ledger.entries].reverse().find(e => e.gate === g);
    const detail = result.detail || 'N/A';
    if (lastForGate && lastForGate.result === status && lastForGate.detail === detail) {
      console.log(`  [LEDGER] ${g} unchanged, not re-recorded`);
    } else {
      const entry = appendEntry(projectDir, g, status, detail);
      console.log(`  [LEDGER] ${g} ${entry.result} recorded (hash ${entry.hash.substring(0, 16)}...)`);
    }
  }

  if (args.quality && result.pass) {
    const qResult = checkQualityGate(projectDir, configContent, g);
    const qStatus = qResult.pass ? 'PASS' : 'FAIL';
    console.log(`  [${qStatus}] ${g}-Quality: ${qResult.detail}`);
    if (!qResult.pass) allPass = false;
  }
}

if (!allPass) {
  console.error('\nGate check FAILED. Fix issues before proceeding.');
  process.exit(1);
} else {
  console.log('\nAll gates PASSED.');
}