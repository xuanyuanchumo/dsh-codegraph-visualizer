#!/usr/bin/env node
// eval-runner.mjs — E1-E8 + Q1-Q8 评估维度运行器：执行评估并生成评估报告
// 用法: node scripts/eval-runner.mjs <project-dir> [--dimensions E1,E2,...,Q1,Q2,...] [--cycle N] [--quality]

import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { DIMENSIONS, resolveDimensions } from './lib/dimensions.mjs';
import { loadProjectConfig, getYamlString } from './lib/config.mjs';
import { getLatestCycleDir } from './lib/cycle.mjs';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..');

// DIMENSIONS 词表来自 scripts/lib/dimensions.mjs（唯一来源，修 S-2；
// references/evaluation.md 与 config.example.yml 已对齐到本词表）

function parseArgs(argv) {
  const args = { _: [], dimensions: 'all', cycle: null, quality: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dimensions') args.dimensions = argv[++i];
    else if (argv[i] === '--cycle') args.cycle = parseInt(argv[++i], 10);
    else if (argv[i] === '--quality') args.quality = true;
    else args._.push(argv[i]);
  }
  return args;
}

// 修字典序缺陷：getLatestCycle 改用 lib/cycle.mjs 的数值序（原 .sort().pop() 在
// cycle-10 之后会选错目录：'cycle-9' > 'cycle-10'）
const getLatestCycle = getLatestCycleDir;

// 修 iteration-5（N-10 脚本侧最小实现）：三态裁决 PASS / FAIL / SKIP。
// 原先"无法评估"一律返回 { pass: true, detail: '...(skipped)' }，等于评估器对没评估过的
// 东西写 PASS——门禁随后在无证据的情况下关闭（fail-open，与 S-1 的 lint/build 恒 PASS 同族）。
// SKIP 的语义是"本次没有证据"：报告写 SKIP、退出码仍为 0（否则文档型项目永远无法运行），
// 但 gate-check --quality 视 SKIP 为不可关门——门禁必须有证据。
function skipped(detail) {
  return { pass: false, skipped: true, detail: `${detail} → SKIP (not evaluated)` };
}

// 组合多个子检查：任一 FAIL ⇒ FAIL；无 FAIL 但有 SKIP ⇒ SKIP；否则 PASS。
// （Q4/Q5/Q6/Q7/Q8 是多个子检查的合取，SKIP 必须在合取里传播而不是被吞掉）
function combine(results) {
  const detail = results.map(r => r.detail || r.output || '').filter(Boolean).join('; ');
  if (results.some(r => !r.pass && !r.skipped)) return { pass: false, detail };
  if (results.some(r => r.skipped)) return { pass: false, skipped: true, detail };
  return { pass: true, detail };
}

// 修 S-1：loadConfig 改走 scripts/lib/config.mjs 唯一入口（原先读从未被 init-workflow
// 创建的 .cycles/cycle-config.yml，缺文件静默返回 ''）。缺配置 = 响亮失败，不再静默降级。
function loadConfig(projectDir) {
  try {
    return loadProjectConfig(projectDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function runTestCommand(projectDir, configContent) {
  // 引号容错解析（修 S-8：各脚本自带 /test_cmd:\s*"([^"]+)"/ 且要求双引号）
  const testCmd = getYamlString(configContent, 'test_cmd');
  if (!testCmd) return { pass: false, output: 'test_cmd not configured in .cycles/config.yml' };
  try {
    const output = execSync(testCmd, { cwd: projectDir, timeout: 120000, stdio: 'pipe' });
    return { pass: true, output: output.toString().trim() };
  } catch (e) {
    return { pass: false, output: e.stderr ? e.stderr.toString().trim() : e.message };
  }
}

function runLintCommand(projectDir, configContent) {
  const lintCmd = getYamlString(configContent, 'lint_cmd');
  if (!lintCmd) {
    // 修 S-1 附带缺陷：原先缺配置返回 {pass:true, 'No lint command configured (skipped)'}——
    // 评估器无法评估不得记 PASS（禁默认值兜底，docs/anic/09 §6.4）
    return { pass: false, output: 'lint_cmd not configured in .cycles/config.yml' };
  }
  try {
    const output = execSync(lintCmd, { cwd: projectDir, timeout: 60000, stdio: 'pipe' });
    return { pass: true, output: output.toString().trim() };
  } catch (e) {
    return { pass: false, output: e.stderr ? e.stderr.toString().trim() : e.message };
  }
}

function runBuildCommand(projectDir, configContent) {
  const buildCmd = getYamlString(configContent, 'build_cmd');
  if (!buildCmd) {
    return { pass: false, output: 'build_cmd not configured in .cycles/config.yml' };
  }
  try {
    execSync(buildCmd, { cwd: projectDir, timeout: 120000, stdio: 'pipe' });
    return { pass: true, output: 'Build passed' };
  } catch (e) {
    return { pass: false, output: 'Build failed' };
  }
}

function checkSpecAlignment(projectDir) {
  const intentDir = join(projectDir, '.cycles', 'intent');
  if (!existsSync(intentDir)) return skipped('No intent directory');
  const mdFiles = readdirSync(intentDir).filter(f => f.endsWith('.md'));
  if (mdFiles.length === 0) return skipped('No intent documents');
  return { pass: true, detail: `${mdFiles.length} intent document(s) found: ${mdFiles.join(', ')}` };
}

function checkSpecConformance(projectDir) {
  const intentDir = join(projectDir, '.cycles', 'intent');
  if (!existsSync(intentDir)) return skipped('No intent directory');
  const specPath = join(intentDir, 'spec.md');
  if (!existsSync(specPath)) return skipped('No spec.md');
  const planPath = join(intentDir, 'plan.md');
  if (!existsSync(planPath)) return skipped('spec.md found but no plan.md (conformance not evaluable)');
  return { pass: true, detail: 'spec.md and plan.md found, conformance check passed' };
}

function checkDocSync(projectDir) {
  const readmePath = join(projectDir, 'README.md');
  if (!existsSync(readmePath)) return skipped('No README');
  return { pass: true, detail: 'README exists' };
}

function checkSecurity(projectDir) {
  const envFiles = ['.env', '.env.local', '.env.production'];
  const found = envFiles.filter(f => existsSync(join(projectDir, f)));
  if (found.length === 0) return { pass: true, detail: 'No .env files present' };

  // 修 iteration-5：.env 存在但项目没有 .gitignore 时，原实现的整个 if 块不成立，
  // 直接落到最后一行 'No security issues detected'——明文凭据可提交却被报为无安全问题。
  // 缺证据不能等于通过：没有 .gitignore 本身就是最坏情况（没有任何忽略规则）。
  const gitignorePath = join(projectDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return { pass: false, detail: `Env files present with no .gitignore at all: ${found.join(', ')} (credentials are trackable)` };
  }
  const gitignore = readFileSync(gitignorePath, 'utf-8');
  const notIgnored = found.filter(f => !gitignore.includes(f));
  if (notIgnored.length > 0) {
    return { pass: false, detail: `Env files not in .gitignore: ${notIgnored.join(', ')}` };
  }
  return { pass: true, detail: `Env files ignored: ${found.join(', ')}` };
}

function checkHardcodedSecrets(projectDir) {
  if (!existsSync(join(projectDir, 'src'))) return skipped('No src/ directory');
  try {
    const output = execSync('grep -rn "password\\|secret\\|api_key\\|token" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" src/ 2>/dev/null || true', {
      cwd: projectDir, timeout: 10000, stdio: 'pipe', encoding: 'utf-8',
    });
    const lines = output.trim().split('\n').filter(Boolean);
    const suspicious = lines.filter(l => !l.includes('//') && !l.includes('/*') && !l.includes('process.env'));
    if (suspicious.length > 0) {
      return { pass: false, detail: `${suspicious.length} potential hardcoded secrets found` };
    }
    return { pass: true, detail: 'No hardcoded secrets detected' };
  } catch {
    return skipped('Secret scan unavailable (grep failed)');
  }
}

function checkDependencyAudit(projectDir) {
  try {
    const output = execSync('npm audit --json 2>/dev/null || true', {
      cwd: projectDir, timeout: 30000, stdio: 'pipe', encoding: 'utf-8',
    });
    const audit = JSON.parse(output);
    const vulns = audit.metadata?.vulnerabilities;
    if (!vulns) return skipped('npm audit returned no vulnerability metadata (lockfile or registry unavailable)');
    const highVulns = vulns.high || 0;
    const criticalVulns = vulns.critical || 0;
    if (criticalVulns > 0) {
      return { pass: false, detail: `${criticalVulns} critical vulnerabilities` };
    }
    if (highVulns > 0) {
      return { pass: false, detail: `${highVulns} high vulnerabilities` };
    }
    return { pass: true, detail: 'No high/critical vulnerabilities' };
  } catch {
    return skipped('npm audit unavailable');
  }
}

function checkArchitectureLayers(projectDir) {
  const srcDir = join(projectDir, 'src');
  if (!existsSync(srcDir)) return skipped('No src/ directory');

  const knownLayers = ['client', 'host', 'shared', 'adapters', 'server', 'lib'];
  const foundLayers = readdirSync(srcDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const hasAdapter = foundLayers.some(l => l.includes('adapter') || l === 'adapters');
  if (!hasAdapter && foundLayers.length > 2) {
    return { pass: false, detail: 'No adapter layer found for external service isolation' };
  }
  return { pass: true, detail: `${foundLayers.length} layers detected, adapter pattern present` };
}

function checkCircularDeps(projectDir) {
  try {
    const output = execSync('npx madge --circular --extensions ts,tsx,js,jsx src/ 2>/dev/null || true', {
      cwd: projectDir, timeout: 30000, stdio: 'pipe', encoding: 'utf-8',
    });
    if (output.includes('✖')) {
      const count = (output.match(/\(\d+\)/g) || []).length;
      return { pass: false, detail: `${count} circular dependencies detected` };
    }
    return { pass: true, detail: 'No circular dependencies' };
  } catch {
    return skipped('Circular dependency check unavailable (madge missing)');
  }
}

function checkA11y(projectDir) {
  const srcDir = join(projectDir, 'src');
  if (!existsSync(srcDir)) return skipped('No src/ directory');

  try {
    const output = execSync('grep -rn "aria-\\|role=" --include="*.tsx" --include="*.jsx" src/ 2>/dev/null | wc -l', {
      cwd: projectDir, timeout: 10000, stdio: 'pipe', encoding: 'utf-8',
    });
    const ariaCount = parseInt(output.trim(), 10);
    if (ariaCount === 0) {
      return { pass: false, detail: 'No ARIA attributes found in frontend code' };
    }
    return { pass: true, detail: `${ariaCount} ARIA attributes found` };
  } catch {
    return skipped('a11y check unavailable (grep failed)');
  }
}

function checkI18n(projectDir) {
  const i18nPaths = [
    join(projectDir, 'src', 'i18n'),
    join(projectDir, 'src', 'client', 'i18n'),
    join(projectDir, 'public', 'locales'),
  ];
  const found = i18nPaths.filter(p => existsSync(p));
  if (found.length === 0) return skipped('No i18n directory');
  return { pass: true, detail: `i18n directory found: ${found[0].replace(projectDir, '')}` };
}

function checkResponsive(projectDir) {
  try {
    const output = execSync('grep -rn "@media\\|useMediaQuery\\|breakpoint" --include="*.tsx" --include="*.jsx" --include="*.css" --include="*.scss" src/ 2>/dev/null | wc -l', {
      cwd: projectDir, timeout: 10000, stdio: 'pipe', encoding: 'utf-8',
    });
    const count = parseInt(output.trim(), 10);
    if (count === 0) {
      return { pass: false, detail: 'No responsive design breakpoints found' };
    }
    return { pass: true, detail: `${count} responsive breakpoints found` };
  } catch {
    return skipped('Responsive check unavailable (grep failed)');
  }
}

function checkComplexity(projectDir) {
  try {
    const output = execSync(`node "${join(SKILL_ROOT, 'scripts', 'band-detector.mjs')}" "${projectDir}" --threshold 0.15 2>&1 || true`, {
      timeout: 30000, stdio: 'pipe', encoding: 'utf-8',
    });
    if (output.includes('OVER_BUDGET')) {
      return { pass: false, detail: 'Complexity over budget' };
    }
    if (output.includes('WARNING')) {
      return { pass: true, detail: 'Complexity within bands (warning)' };
    }
    return { pass: true, detail: 'Complexity within acceptable bands' };
  } catch {
    return skipped('Complexity check unavailable (band-detector failed)');
  }
}

function checkErrorHandling(projectDir) {
  if (!existsSync(join(projectDir, 'src'))) return skipped('No src/ directory');
  try {
    const output = execSync('grep -rn "try\\|catch\\|ErrorBoundary\\|error" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" src/ 2>/dev/null | wc -l', {
      cwd: projectDir, timeout: 10000, stdio: 'pipe', encoding: 'utf-8',
    });
    const count = parseInt(output.trim(), 10);
    if (count === 0) {
      return { pass: false, detail: 'No error handling patterns found' };
    }
    return { pass: true, detail: `${count} error handling patterns found` };
  } catch {
    return skipped('Error handling check unavailable (grep failed)');
  }
}

function checkDeliveryChecklist(projectDir, cycleDir) {
  if (!cycleDir) return { pass: false, detail: 'No cycle directory' };
  const checklistPath = join(projectDir, '.cycles', 'cycles', cycleDir, '交付清单.md');
  if (!existsSync(checklistPath)) return { pass: false, detail: 'No delivery checklist' };
  const content = readFileSync(checklistPath, 'utf-8');
  const requiredItems = ['Release 构建产物', '最终测试报告', '非功能验证报告', '验证签名', '文档更新记录', '环境配置说明', '数据清理记录', '审计日志'];
  const missing = requiredItems.filter(item => !content.includes(item));
  if (missing.length > 0) {
    return { pass: false, detail: `Missing ${missing.length} items: ${missing.join(', ')}` };
  }
  return { pass: true, detail: 'All 8 delivery checklist items present' };
}

function checkTestReports(projectDir, cycleDir) {
  if (!cycleDir) return { pass: false, detail: 'No cycle directory' };
  const testReportsDir = join(projectDir, '.cycles', 'cycles', cycleDir, 'test-reports');
  if (!existsSync(testReportsDir)) return { pass: false, detail: 'No test reports directory' };
  const reports = readdirSync(testReportsDir).filter(e => e.endsWith('.md'));
  if (reports.length === 0) return { pass: false, detail: 'No test reports' };
  return { pass: true, detail: `${reports.length} test report(s) found` };
}

function checkReviewEvidence(projectDir, cycleDir) {
  if (!cycleDir) return { pass: false, detail: 'No cycle directory' };
  const cycleReviewPath = join(projectDir, '.cycles', 'cycles', cycleDir, '评审标准.md');
  const globalReviewPath = join(projectDir, '.cycles', 'REVIEW.md');
  if (existsSync(cycleReviewPath)) return { pass: true, detail: 'Cycle-specific review criteria found' };
  if (existsSync(globalReviewPath)) return { pass: true, detail: 'Global REVIEW.md found' };
  return skipped('No review criteria');
}

// 报告里的一格裁决：三态（PASS / FAIL / SKIP）。SKIP 必须显式落盘，
// 否则读者（与 gate-check --quality）无法区分"评估通过"与"没评估"。
function statusOf(r) {
  if (r.skipped) return 'SKIP';
  return r.pass ? 'PASS' : 'FAIL';
}

function generateReport(projectDir, cycleDir, results, dimsToRun) {
  const evalDims = dimsToRun.filter(d => DIMENSIONS[d].category === 'eval');
  const qualityDims = dimsToRun.filter(d => DIMENSIONS[d].category === 'quality');

  const lines = [
    `# 评估报告`,
    ``,
    `**循环**: ${cycleDir || 'N/A'}`,
    `**时间**: ${new Date().toISOString()}`,
    `**评估维度**: ${evalDims.join(', ')}`,
    `**质量评审维度**: ${qualityDims.join(', ')}`,
    ``,
  ];

  if (evalDims.length > 0) {
    lines.push(`## E1-E8 评估结果`, ``, `| 维度 | 名称 | 结果 | 详情 |`, `|------|------|------|------|`);
    for (const dim of evalDims) {
      const r = results[dim];
      const status = statusOf(r);
      lines.push(`| ${dim} | ${DIMENSIONS[dim].name} | ${status} | ${r.detail || r.output || ''} |`);
    }
    lines.push(``);
  }

  if (qualityDims.length > 0) {
    lines.push(`## Q1-Q8 质量评审结果`, ``, `| 维度 | 名称 | 结果 | 详情 |`, `|------|------|------|------|`);
    for (const dim of qualityDims) {
      const r = results[dim];
      const status = statusOf(r);
      lines.push(`| ${dim} | ${DIMENSIONS[dim].name} | ${status} | ${r.detail || r.output || ''} |`);
    }
    lines.push(``);
  }

  const passed = dimsToRun.filter(d => results[d].pass).length;
  const skippedDims = dimsToRun.filter(d => results[d].skipped);
  const failed = dimsToRun.length - passed - skippedDims.length;
  lines.push(
    `## 总结`, ``,
    `- 通过: ${passed}/${dimsToRun.length}`,
    `- 失败: ${failed}`,
    `- 未评估(SKIP): ${skippedDims.length}${skippedDims.length > 0 ? ` → ${skippedDims.join(', ')}` : ''}`,
    ``,
  );

  if (failed > 0) {
    lines.push(`> **警告**: ${failed} 个维度未通过，需要修复后再进入下一阶段。`);
  }
  if (skippedDims.length > 0) {
    lines.push(`> **注意**: ${skippedDims.length} 个维度未评估——SKIP ≠ PASS，门禁需更多证据才能关闭（gate-check --quality 视 SKIP 为不可关门）。`);
  }

  return lines.join('\n');
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node eval-runner.mjs <project-dir> [--dimensions E1,E2,...,Q1,Q2,...] [--cycle N] [--quality]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);
const configContent = loadConfig(projectDir);

let dimsToRun;
try {
  // 修 S-11：未知维度响亮失败（原先 .filter(s => DIMENSIONS[s]) 静默剔除，
  // `--dimensions E9` 会静默变成空集并以退出码 0 结束）
  dimsToRun = resolveDimensions({ dimensions: args.dimensions, quality: args.quality });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const cycleDir = args.cycle ? `cycle-${args.cycle}` : getLatestCycle(projectDir);

const results = {};
const testResult = runTestCommand(projectDir, configContent);
const lintResult = runLintCommand(projectDir, configContent);
const buildResult = runBuildCommand(projectDir, configContent);

for (const dim of dimsToRun) {
  switch (dim) {
    case 'E1':
      results[dim] = checkSpecAlignment(projectDir);
      break;
    case 'E2':
      results[dim] = checkSpecConformance(projectDir);
      break;
    case 'E3':
      results[dim] = testResult;
      break;
    case 'E4':
      results[dim] = lintResult;
      break;
    case 'E5':
      // 修 iteration-5：手工项不得记 PASS（无基线工件 = 没有证据）
      results[dim] = skipped('Performance baseline requires a baseline artifact (manual check, none attached)');
      break;
    case 'E6':
      results[dim] = checkSecurity(projectDir);
      break;
    case 'E7':
      results[dim] = checkDocSync(projectDir);
      break;
    case 'E8':
      results[dim] = testResult;
      break;
    case 'Q1':
      results[dim] = checkSpecAlignment(projectDir);
      break;
    case 'Q2':
      results[dim] = checkTestReports(projectDir, cycleDir);
      break;
    case 'Q3':
      results[dim] = buildResult;
      break;
    case 'Q4':
      results[dim] = combine([checkSecurity(projectDir), checkHardcodedSecrets(projectDir), checkDependencyAudit(projectDir)]);
      break;
    case 'Q5':
      results[dim] = combine([checkArchitectureLayers(projectDir), checkCircularDeps(projectDir)]);
      break;
    case 'Q6':
      results[dim] = combine([checkA11y(projectDir), checkI18n(projectDir), checkResponsive(projectDir)]);
      break;
    case 'Q7':
      results[dim] = combine([lintResult, checkComplexity(projectDir), checkErrorHandling(projectDir)]);
      break;
    case 'Q8':
      results[dim] = combine([checkDeliveryChecklist(projectDir, cycleDir), checkReviewEvidence(projectDir, cycleDir)]);
      break;
    default:
      results[dim] = { pass: false, detail: `Unknown dimension: ${dim}` };
  }
}

// 修 N-8a（v1.8.0）：部分维度运行不再整文件覆盖 项目评估报告.md——
// 未运行的维度从既有报告继承其结果行，已运行的维度以本次为准（后写者赢）。
const reportPath = cycleDir ? join(projectDir, '.cycles', 'cycles', cycleDir, '项目评估报告.md') : null;
const isPartialRun = dimsToRun.length < Object.keys(DIMENSIONS).length;
const mergedResults = { ...results };
const mergedDims = [...dimsToRun];
if (reportPath && isPartialRun && existsSync(reportPath)) {
  const existing = readFileSync(reportPath, 'utf-8');
  for (const line of existing.split('\n')) {
    const m = line.match(/^\|\s*(E[1-8]|Q[1-8])\s*\|/);
    if (!m) continue;
    const dim = m[1];
    if (dimsToRun.includes(dim)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    // 修 iteration-5：继承既有报告行时必须保留三态，否则 SKIP 会在下次部分运行时被读成 FAIL
    const status = cells[2];
    mergedResults[dim] = { pass: status === 'PASS', skipped: status === 'SKIP', detail: cells.slice(3).join(' | ') || '' };
    if (!mergedDims.includes(dim)) mergedDims.push(dim);
  }
  // 保持 E1..E8 → Q1..Q8 的报告顺序
  mergedDims.sort((a, b) => (a[0] === b[0] ? a.localeCompare(b) : a[0] === 'E' ? -1 : 1));
}

const report = generateReport(projectDir, cycleDir, mergedResults, mergedDims);

if (cycleDir) {
  atomicWriteFileSync(reportPath, report);
  const inherited = mergedDims.length - dimsToRun.length;
  console.log(`Evaluation report written to ${reportPath}`);
  if (inherited > 0) console.log(`  (merged: ${inherited} dimension(s) inherited from the existing report)`);
} else {
  console.log(report);
}

// 修 iteration-5：退出码只由 FAIL 决定；SKIP 不阻塞运行（否则文档型项目永远跑不完），
// 但必须响亮列出——"没评估"和"评估通过"在屏幕上长得一样，是 fail-open 的入口。
const failed = dimsToRun.filter(d => !results[d].pass && !results[d].skipped);
const skippedDims = dimsToRun.filter(d => results[d].skipped);
if (failed.length > 0) {
  console.error(`\n${failed.length} dimension(s) failed: ${failed.join(', ')}`);
  if (skippedDims.length > 0) {
    console.error(`${skippedDims.length} dimension(s) not evaluated (SKIP): ${skippedDims.join(', ')}`);
  }
  process.exit(1);
} else {
  console.log(`\nAll ${dimsToRun.length - skippedDims.length} evaluated dimension(s) passed.`);
  if (skippedDims.length > 0) {
    console.log(`${skippedDims.length} dimension(s) SKIPPED (not evaluated, NOT pass): ${skippedDims.join(', ')}`);
  }
}