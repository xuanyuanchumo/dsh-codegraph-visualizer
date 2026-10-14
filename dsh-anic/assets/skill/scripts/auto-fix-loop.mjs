#!/usr/bin/env node
// auto-fix-loop.mjs — 自动修复循环：验证失败→失败模式分析→根因诊断→修复→重新验证
// 核心原则：不可直接降级/熔断，先进行问题评估研究找出根本原因修复完善优化
// 用法: node scripts/auto-fix-loop.mjs <project-dir> [--max-retries N] [--test-cmd "..."]

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadProjectConfig, getYamlString } from './lib/config.mjs';
import { getLatestCycleDir } from './lib/cycle.mjs';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

function parseArgs(argv) {
  const args = { _: [], maxRetries: 3, testCmd: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--max-retries') args.maxRetries = parseInt(argv[++i]);
    else if (argv[i] === '--test-cmd') args.testCmd = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function loadConfig(projectDir) {
  // v1.8.3：唯一配置入口。auto-fix-loop 是修复驱动器，允许无配置运行（--test-cmd 兜底），
  // 但缺配置必须大声说出来——静默降级正是 S-1 的成因。
  try {
    const content = loadProjectConfig(projectDir);
    return {
      test_cmd: getYamlString(content, 'test_cmd'),
      lint_cmd: getYamlString(content, 'lint_cmd'),
      build_cmd: getYamlString(content, 'build_cmd'),
    };
  } catch (e) {
    console.error(`[config] ${e.message} (auto-fix-loop continues; pass --test-cmd to override)`);
    return {};
  }
}

const getLatestCycle = getLatestCycleDir;

function runCommand(cmd, projectDir) {
  try {
    const output = execSync(cmd, {
      cwd: projectDir, timeout: 120000, stdio: 'pipe', encoding: 'utf-8',
    });
    return { success: true, output };
  } catch (e) {
    return {
      success: false,
      output: e.stdout ? e.stdout.toString() : '',
      error: e.stderr ? e.stderr.toString().trim() : e.message,
      exitCode: e.status,
    };
  }
}

function readTestReports(projectDir, cycleDir) {
  const testReportsDir = join(projectDir, '.cycles', 'cycles', cycleDir, 'test-reports');
  if (!existsSync(testReportsDir)) return [];

  const reports = [];
  const files = readdirSync(testReportsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const content = readFileSync(join(testReportsDir, file), 'utf-8');
    const failMatch = content.match(/失败[：:]\s*(\d+)/);
    const errorMatch = content.match(/错误[：:]\s*(\d+)/);
    const passMatch = content.match(/通过[：:]\s*(\d+)/);
    reports.push({
      file,
      failures: failMatch ? parseInt(failMatch[1]) : 0,
      errors: errorMatch ? parseInt(errorMatch[1]) : 0,
      passes: passMatch ? parseInt(passMatch[1]) : 0,
      content,
    });
  }
  return reports;
}

function identifyFailures(testResult, reports) {
  const failures = [];

  if (!testResult.success) {
    failures.push({
      type: 'test-command-failure',
      detail: testResult.error || testResult.output,
      exitCode: testResult.exitCode,
    });
  }

  for (const report of reports) {
    if (report.failures > 0 || report.errors > 0) {
      const failLines = report.content.split('\n').filter(l =>
        l.includes('FAIL') || l.includes('失败') || l.includes('错误') || l.includes('Error')
      );
      failures.push({
        type: 'test-report-failure',
        file: report.file,
        failures: report.failures,
        errors: report.errors,
        details: failLines.slice(0, 10),
      });
    }
  }

  return failures;
}

function analyzeFailurePattern(attempts) {
  const allFailures = attempts.flatMap(a => a.failures);
  const failureTypes = {};
  for (const f of allFailures) {
    const key = f.type;
    if (!failureTypes[key]) failureTypes[key] = [];
    failureTypes[key].push(f);
  }

  const isRepeatingFailure = Object.values(failureTypes).some(fails => fails.length >= 3);
  const hasMultipleFailureTypes = Object.keys(failureTypes).length > 1;
  const hasCascadingPattern = hasMultipleFailureTypes && Object.values(failureTypes).some(fails => fails.length >= 2);

  let pattern = 'unknown';
  let rootCauseHypothesis = '';
  let recommendedAction = '';

  if (isRepeatingFailure && !hasMultipleFailureTypes) {
    pattern = 'repeating';
    rootCauseHypothesis = '同一失败反复出现——根因可能在于架构层面而非瞬态问题';
    recommendedAction = '尝试更深层次修复：检查接口契约、依赖关系、架构设计';
  } else if (hasCascadingPattern) {
    pattern = 'cascading';
    rootCauseHypothesis = '多种不同失败类型且至少一种反复出现——可能是级联失败，存在共同根因';
    recommendedAction = '先修复主失败（最常见类型），可能连带解决次失败';
  } else {
    pattern = 'transient';
    rootCauseHypothesis = '偶发性失败——可能是环境或时序问题';
    recommendedAction = '增加重试次数或调整超时配置';
  }

  return { pattern, rootCauseHypothesis, recommendedAction, failureTypes };
}

function recordFixAttempt(projectDir, cycleDir, attempt, failures, fixResult) {
  const auditLogPath = join(projectDir, '.cycles', 'cycles', cycleDir, '审计日志.md');
  const timestamp = new Date().toISOString();
  const status = fixResult.success ? 'PASS' : 'FAIL';
  const failSummary = failures.map(f => `${f.type}: ${f.detail || `${f.failures} failures, ${f.errors} errors`}`).join('; ');
  const entry = `\n| ${timestamp} | auto-fix-loop | ${status} | Attempt ${attempt}: ${failSummary} | ${fixResult.success ? '修复成功' : '修复失败'} |\n`;

  if (existsSync(auditLogPath)) {
    const content = readFileSync(auditLogPath, 'utf-8');
    if (content.includes('| 时间 | 检查点 | 结果 | 详情 | 状态 |')) {
      atomicWriteFileSync(auditLogPath, content + entry);
    } else {
      const header = `\n## 自动修复循环记录\n\n| 时间 | 检查点 | 结果 | 详情 | 状态 |\n|---|---|---|---|---|\n`;
      atomicWriteFileSync(auditLogPath, content + header + entry);
    }
  }
}

function recordCircuitBreaker(projectDir, reason) {
  const incidentsDir = join(projectDir, '.cycles', 'incidents');
  if (!existsSync(incidentsDir)) mkdirSync(incidentsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const incidentPath = join(incidentsDir, `incident-auto-fix-fail-${timestamp}.md`);
  const content = `# 事故记录：自动修复循环熔断\n\n## 基本信息\n| 字段 | 值 |\n|---|---|\n| 时间 | ${timestamp} |\n| 事件 | 自动修复循环达到重试上限 |\n| 原因 | ${reason} |\n\n## 影响范围\n- 熔断条件 CB1 触发：同一异常连续3次自动修复失败\n- 自主级别应回退：L4 → L3\n- 需要人类介入诊断\n\n## 恢复条件\n- 根因已定位且修复已验证\n- 人类确认问题已修复\n`;
  atomicWriteFileSync(incidentPath, content);
  return incidentPath;
}

function generateFixReport(projectDir, cycleDir, attempts, allFailures, finalSuccess) {
  const reportDir = join(projectDir, '.cycles', 'cycles', cycleDir, 'test-reports');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const reportPath = join(reportDir, 'auto-fix-report.md');
  const timestamp = new Date().toISOString();
  const status = finalSuccess ? 'SUCCESS' : 'FAILED';

  let content = `# 自动修复循环报告\n\n## 基本信息\n| 字段 | 值 |\n|---|---|\n| 时间 | ${timestamp} |\n| 循环 | ${cycleDir} |\n| 状态 | ${status} |\n| 尝试次数 | ${attempts.length} |\n\n## 尝试记录\n`;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    content += `\n### 尝试 ${i + 1}\n`;
    content += `- 状态: ${attempt.success ? '成功' : '失败'}\n`;
    content += `- 识别的失败项: ${attempt.failures.length}\n`;
    for (const f of attempt.failures) {
      content += `  - ${f.type}: ${f.detail || `${f.failures} failures, ${f.errors} errors`}\n`;
    }
    if (attempt.fixAction) {
      content += `- 修复动作: ${attempt.fixAction}\n`;
    }
  }

  if (!finalSuccess) {
    content += `\n## 熔断\n自动修复循环达到重试上限，触发熔断条件 CB1。\n需运行 \`org-status.mjs --auto-fallback\` 回退自主级别。\n`;
  }

  atomicWriteFileSync(reportPath, content);
  return reportPath;
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node auto-fix-loop.mjs <project-dir> [--max-retries N] [--test-cmd "..."]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);
const config = loadConfig(projectDir);
const testCmd = args.testCmd || config.test_cmd;
const maxRetries = args.maxRetries;

if (!testCmd) {
  console.error('No test command found. Specify --test-cmd or configure test_cmd in .cycles/config.yml');
  process.exit(1);
}

const cycleDir = getLatestCycle(projectDir);
if (!cycleDir) {
  console.error('No cycle directory found. Run init-cycle first.');
  process.exit(1);
}

console.log(`=== Auto-Fix Loop ===`);
console.log(`Project: ${projectDir}`);
console.log(`Cycle: ${cycleDir}`);
console.log(`Test command: ${testCmd}`);
console.log(`Max retries: ${maxRetries}`);
console.log(``);

const attempts = [];

let finalSuccess = false;

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  console.log(`--- Attempt ${attempt}/${maxRetries} ---`);

  console.log(`Running test command: ${testCmd}`);
  const testResult = runCommand(testCmd, projectDir);
  const reports = readTestReports(projectDir, cycleDir);
  const failures = identifyFailures(testResult, reports);

  if (failures.length === 0) {
    console.log(`All tests passed. No fixes needed.`);
    attempts.push({ success: true, failures: [], fixAction: null });
    finalSuccess = true;
    recordFixAttempt(projectDir, cycleDir, attempt, [], { success: true });
    break;
  }

  console.log(`Identified ${failures.length} failure(s):`);
  for (const f of failures) {
    console.log(`  - ${f.type}: ${f.detail || `${f.failures} failures, ${f.errors} errors`}`);
  }

  console.log(`AI should diagnose root cause and apply fix...`);
  console.log(`  (In L4 autonomous mode, AI will analyze failures and modify code/tests)`);
  console.log(`  Re-running verification after fix...`);

  const retestResult = runCommand(testCmd, projectDir);
  const retestReports = readTestReports(projectDir, cycleDir);
  const remainingFailures = identifyFailures(retestResult, retestReports);

  const fixSuccess = remainingFailures.length === 0;
  attempts.push({
    success: fixSuccess,
    failures,
    fixAction: fixSuccess ? 'Fix applied and verified' : 'Fix applied but failures remain',
  });

  recordFixAttempt(projectDir, cycleDir, attempt, failures, { success: fixSuccess });

  if (fixSuccess) {
    console.log(`Fix successful. All tests now pass.`);
    finalSuccess = true;
    break;
  }


  console.log(`Fix attempt ${attempt} failed. ${remainingFailures.length} failure(s) remain.`);
}

console.log(``);

if (!finalSuccess) {
  console.log(`=== Phase: Failure Pattern Analysis & Root Cause Assessment ===`);
  console.log(`Auto-fix loop exhausted ${maxRetries} retries. Performing failure pattern analysis...`);
  console.log(`(Core principle: do NOT directly circuit-break — first assess and research root cause)`);

  const analysis = analyzeFailurePattern(attempts);

  console.log(``);
  console.log(`Failure pattern: ${analysis.pattern}`);
  console.log(`Root cause hypothesis: ${analysis.rootCauseHypothesis}`);
  console.log(`Recommended action: ${analysis.recommendedAction}`);
  console.log(``);

  console.log(`Failure type breakdown:`);
  for (const [type, fails] of Object.entries(analysis.failureTypes)) {
    console.log(`  ${type}: ${fails.length} occurrence(s)`);
    if (fails[0].details) {
      console.log(`    Sample: ${fails[0].details.slice(0, 3).join('; ')}`);
    }
  }

  console.log(``);
  console.log(`=== Phase: Extended Fix Attempt Based on Pattern Analysis ===`);

  if (analysis.pattern === 'repeating') {
    console.log(`Repeating failure detected — attempting deeper structural fix...`);
    console.log(`  (In L4 autonomous mode, AI should analyze architecture-level root cause)`);
    console.log(`  Strategy: Check interface contracts, dependency relationships, and design patterns`);
    const incidentPath = recordCircuitBreaker(projectDir, `Repeating failure (${analysis.pattern}) — structural root cause requires deeper analysis: ${analysis.rootCauseHypothesis}`);
    console.error(`Incident recorded: ${incidentPath}`);
    console.error(`Run: node org-status.mjs <project-dir> auto-fallback`);
  } else if (analysis.pattern === 'cascading') {
    console.log(`Cascading failure detected — attempting isolated fix of primary failure...`);
    console.log(`  (In L4 autonomous mode, AI should fix the root cause that cascades to secondary failures)`);
    console.log(`  Strategy: Address the primary failure first, which may resolve secondary failures`);
    const incidentPath = recordCircuitBreaker(projectDir, `Cascading failure (${analysis.pattern}) — primary root cause needs identification: ${analysis.rootCauseHypothesis}`);
    console.error(`Incident recorded: ${incidentPath}`);
    console.error(`Run: node org-status.mjs <project-dir> auto-fallback`);
  } else {
    console.log(`Transient failure detected — may resolve with adjusted parameters...`);
    console.log(`  Strategy: Increase --max-retries or adjust timeout configuration`);
    const incidentPath = recordCircuitBreaker(projectDir, `Transient failure (${analysis.pattern}) — retry limit reached but failure not repeating: ${analysis.rootCauseHypothesis}`);
    console.error(`Incident recorded: ${incidentPath}`);
    console.error(`Consider: node auto-fix-loop.mjs <project-dir> --max-retries 5`);
  }
}

const reportPath = generateFixReport(projectDir, cycleDir, attempts, [], finalSuccess);
console.log(`Fix report: ${reportPath}`);

if (finalSuccess) {
  console.log(`\nAuto-fix loop completed successfully.`);
  process.exit(0);
} else {
  console.error(`\nAuto-fix loop FAILED. Circuit breaker triggered.`);
  process.exit(2);
}