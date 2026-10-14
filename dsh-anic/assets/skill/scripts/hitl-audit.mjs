#!/usr/bin/env node
// hitl-audit.mjs — L4 HITL 自动审计：H1-H4 检查点自动评估
// 用法: node scripts/hitl-audit.mjs <project-dir> [--gate H1|H2|H3|H4|all]

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadProjectConfig } from './lib/config.mjs';
import { getLatestCycleDir } from './lib/cycle.mjs';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

function parseArgs(argv) {
  const args = { _: [], gate: 'all' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--gate') args.gate = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

function loadConfig(projectDir) {
  // v1.8.3：唯一配置入口（缺配置响亮告知；H3 不依赖配置内容，观察路径允许继续）
  try {
    return loadProjectConfig(projectDir);
  } catch (e) {
    console.error(`[config] ${e.message} (hitl-audit continues; H3 does not use config values)`);
    return '';
  }
}

const getLatestCycle = getLatestCycleDir;

function getGitChangedFiles(projectDir) {
  try {
    const output = execSync('git diff --name-only HEAD~1', {
      cwd: projectDir, timeout: 5000, stdio: 'pipe', encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    try {
      const output = execSync('git status --porcelain', {
        cwd: projectDir, timeout: 5000, stdio: 'pipe', encoding: 'utf-8',
      });
      return output.trim().split('\n').filter(Boolean).map(line => line.substring(3));
    } catch {
      return [];
    }
  }
}

function checkH1(projectDir) {
  const changedFiles = getGitChangedFiles(projectDir);
  const sensitivePatterns = ['.env', 'credentials', 'secret', 'password', 'token', 'api_key'];
  const sensitiveFiles = changedFiles.filter(f =>
    sensitivePatterns.some(p => f.toLowerCase().includes(p))
  );

  if (sensitiveFiles.length > 0) {
    const gitignorePath = join(projectDir, '.gitignore');
    const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    const unprotected = sensitiveFiles.filter(f => {
      const basename = f.split('/').pop();
      return !gitignore.includes(basename) && !gitignore.includes(f);
    });
    if (unprotected.length > 0) {
      return { pass: false, detail: `Sensitive files not in .gitignore: ${unprotected.join(', ')}`, circuit: true };
    }
  }

  const envFiles = ['.env', '.env.local', '.env.production'];
  const foundEnv = envFiles.filter(f => existsSync(join(projectDir, f)));
  if (foundEnv.length > 0) {
    const gitignorePath = join(projectDir, '.gitignore');
    const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    const unprotected = foundEnv.filter(f => !gitignore.includes(f));
    if (unprotected.length > 0) {
      return { pass: false, detail: `Env files not in .gitignore: ${unprotected.join(', ')}`, circuit: true };
    }
  }

  return { pass: true, detail: 'No security-sensitive operations detected', circuit: false };
}

function checkH2(projectDir) {
  const changedFiles = getGitChangedFiles(projectDir);

  const destructivePatterns = ['.gitignore', 'package.json', 'tsconfig', 'migration', 'schema'];
  const destructiveFiles = changedFiles.filter(f =>
    destructivePatterns.some(p => f.toLowerCase().includes(p))
  );

  if (destructiveFiles.length > 0) {
    if (destructiveFiles.length > 10) {
      return { pass: false, detail: `Large impact scope: ${destructiveFiles.length} destructive files changed`, circuit: true };
    }

    const hasGitHistory = existsSync(join(projectDir, '.git'));
    if (!hasGitHistory) {
      return { pass: false, detail: 'No git history for rollback', circuit: true };
    }

    return { pass: true, detail: `Destructive ops detected (${destructiveFiles.length} files), rollback available via git`, circuit: false };
  }

  return { pass: true, detail: 'No destructive operations detected', circuit: false };
}

function checkH3(projectDir, configContent) {
  const cycleDir = getLatestCycle(projectDir);
  if (!cycleDir) return { pass: false, detail: 'No cycle directory', circuit: true };

  const gateLedgerPath = join(projectDir, '.cycles', 'gates', 'ledger.json');
  if (!existsSync(gateLedgerPath)) {
    return { pass: false, detail: 'No gate ledger (G0-G3 not evaluated)', circuit: true };
  }

  const ledger = JSON.parse(readFileSync(gateLedgerPath, 'utf-8'));
  const recentEntries = ledger.entries.slice(-4);
  const passedGates = recentEntries.filter(e => e.result === 'PASS').map(e => e.gate);
  const allGatesPassed = ['G0', 'G1', 'G2', 'G3'].every(g => passedGates.includes(g));

  if (!allGatesPassed) {
    const missing = ['G0', 'G1', 'G2', 'G3'].filter(g => !passedGates.includes(g));
    return { pass: false, detail: `Gates not all green: missing ${missing.join(', ')}`, circuit: true };
  }

  const auditLogPath = join(projectDir, '.cycles', 'cycles', cycleDir, '审计日志.md');
  if (!existsSync(auditLogPath)) {
    return { pass: false, detail: 'No audit log', circuit: true };
  }

  return { pass: true, detail: 'All gates green, audit log present', circuit: false };
}

function checkH4(projectDir) {
  const gateLedgerPath = join(projectDir, '.cycles', 'gates', 'ledger.json');
  if (!existsSync(gateLedgerPath)) {
    return { pass: true, detail: 'No gate ledger (nothing to arbitrate)', circuit: false };
  }

  const ledger = JSON.parse(readFileSync(gateLedgerPath, 'utf-8'));
  if (ledger.entries.length === 0) {
    return { pass: true, detail: 'No gate entries to arbitrate', circuit: false };
  }

  const recent = ledger.entries.slice(-4);
  const conflicts = [];
  for (const entry of recent) {
    if (entry.result === 'FAIL' && !entry.detail) {
      conflicts.push(`${entry.gate}: FAIL without detail`);
    }
  }

  if (conflicts.length > 0) {
    return { pass: false, detail: `Gate arbitration issues: ${conflicts.join('; ')}`, circuit: true };
  }

  return { pass: true, detail: 'Gate evidence sufficient, no conflicts', circuit: false };
}

function recordAuditResult(projectDir, gate, result) {
  const cycleDir = getLatestCycle(projectDir);
  if (!cycleDir) return;

  const auditLogPath = join(projectDir, '.cycles', 'cycles', cycleDir, '审计日志.md');
  const timestamp = new Date().toISOString();
  const entry = `\n| ${timestamp} | ${gate} | ${result.pass ? 'PASS' : 'FAIL'} | ${result.detail} | ${result.circuit ? '熔断' : '正常'} |\n`;

  if (existsSync(auditLogPath)) {
    const content = readFileSync(auditLogPath, 'utf-8');
    if (content.includes('| 时间 | 检查点 | 结果 | 详情 | 状态 |')) {
      atomicWriteFileSync(auditLogPath, content + entry);
    } else {
      const header = `\n## HITL 自动审计记录\n\n| 时间 | 检查点 | 结果 | 详情 | 状态 |\n|---|---|---|---|---|\n`;
      atomicWriteFileSync(auditLogPath, content + header + entry);
    }
  }
}

function recordIncident(projectDir, gate, result) {
  const incidentsDir = join(projectDir, '.cycles', 'incidents');
  if (!existsSync(incidentsDir)) mkdirSync(incidentsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const incidentPath = join(incidentsDir, `incident-${timestamp}.md`);
  const content = `# 事故记录：${gate} 熔断\n\n## 基本信息\n| 字段 | 值 |\n|---|---|\n| 时间 | ${timestamp} |\n| 检查点 | ${gate} |\n| 结果 | FAIL |\n| 详情 | ${result.detail} |\n| 熔断条件 | ${result.circuit ? '触发' : '未触发'} |\n\n## 影响范围\n- 自主级别回退：L4 → L3\n- 需要人类介入诊断\n\n## 恢复条件\n- 根因已定位且修复已验证\n- 人类确认问题已修复\n`;
  atomicWriteFileSync(incidentPath, content);
}

function attemptH1Fix(projectDir, result) {
  if (!result.circuit) return { success: true, action: 'no fix needed' };

  const gitignorePath = join(projectDir, '.gitignore');
  let gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  const patternsToAdd = [];
  if (result.detail.includes('.env')) {
    ['.env', '.env.local', '.env.production', '.env.*'].forEach(p => {
      if (!gitignore.includes(p)) patternsToAdd.push(p);
    });
  }
  if (result.detail.includes('credentials') || result.detail.includes('secret') || result.detail.includes('password')) {
    ['*.credentials', '*.secret', '*.key'].forEach(p => {
      if (!gitignore.includes(p)) patternsToAdd.push(p);
    });
  }

  if (patternsToAdd.length > 0) {
    gitignore += `\n# Auto-added by HITL audit\n${patternsToAdd.join('\n')}\n`;
    atomicWriteFileSync(gitignorePath, gitignore);
    return { success: true, action: `Added ${patternsToAdd.join(', ')} to .gitignore` };
  }

  return { success: false, reason: 'cannot auto-fix: sensitive files need manual review' };
}

function attemptH2Fix(projectDir, result) {
  if (!result.circuit) return { success: true, action: 'no fix needed' };

  if (result.detail.includes('No git history')) {
    try {
      execSync('git init && git add -A && git commit -m "baseline for rollback"', {
        cwd: projectDir, timeout: 10000, stdio: 'pipe', encoding: 'utf-8',
      });
      return { success: true, action: 'Initialized git repo with baseline commit' };
    } catch (e) {
      return { success: false, reason: `git init failed: ${e.message}` };
    }
  }

  if (result.detail.includes('Large impact scope')) {
    return { success: false, reason: 'impact scope too large, requires human judgment to split changes' };
  }

  return { success: false, reason: 'requires manual review' };
}

function attemptH3Fix(projectDir, result) {
  if (!result.circuit) return { success: true, action: 'no fix needed' };

  if (result.detail.includes('No gate ledger')) {
    return { success: false, reason: 'gate ledger missing, run gate-check.mjs first' };
  }

  if (result.detail.includes('Gates not all green')) {
    const missingMatch = result.detail.match(/missing\s+(.+)/);
    const missingGates = missingMatch ? missingMatch[1] : 'all';
    return { success: false, reason: `gates ${missingGates} not passed, run gate-check.mjs --gate ${missingGates}` };
  }

  if (result.detail.includes('No audit log')) {
    const cycleDir = getLatestCycle(projectDir);
    if (cycleDir) {
      const auditLogPath = join(projectDir, '.cycles', 'cycles', cycleDir, '审计日志.md');
      if (!existsSync(auditLogPath)) {
        atomicWriteFileSync(auditLogPath, `# 审计日志\n\n| 时间 | 检查点 | 结果 | 详情 | 状态 |\n|---|---|---|---|---|\n`);
        return { success: true, action: 'Created audit log file' };
      }
    }
    return { success: false, reason: 'no cycle directory for audit log' };
  }

  return { success: false, reason: 'requires manual review' };
}

function attemptH4Fix(projectDir, result) {
  if (!result.circuit) return { success: true, action: 'no fix needed' };

  if (result.detail.includes('FAIL without detail')) {
    const ledgerPath = join(projectDir, '.cycles', 'gates', 'ledger.json');
    if (!existsSync(ledgerPath)) return { success: false, reason: 'no gate ledger' };

    // v1.8.3 修（账本只追加，INV-1/INV-9）：entry 的 hash 覆盖 detail 字段——
    // 原先此处直接改写 entry.detail 再整文件回写，每条被改记录立即变成
    // HASH_MISMATCH（H4 的"修复"自毁整条链）。账本不可变：缺失证据必须以
    // 新条目补充（重跑对应门禁 `gate-check.mjs --record` 或 `gate-ledger.mjs append`），
    // 历史记录永不原地改写。
    return {
      success: false,
      reason: 'ledger is append-only: re-run the failing gate with --record (or gate-ledger.mjs append) to add a corrected entry; mutating history would corrupt the hash chain',
    };
  }

  return { success: false, reason: 'requires manual review' };
}

const FIX_FUNCTIONS = {
  H1: attemptH1Fix,
  H2: attemptH2Fix,
  H3: attemptH3Fix,
  H4: attemptH4Fix,
};

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node hitl-audit.mjs <project-dir> [--gate H1|H2|H3|H4|all]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);
const configContent = loadConfig(projectDir);

const gates = {
  H1: () => checkH1(projectDir),
  H2: () => checkH2(projectDir),
  H3: () => checkH3(projectDir, configContent),
  H4: () => checkH4(projectDir),
};

const gatesToCheck = args.gate === 'all' ? ['H1', 'H2', 'H3', 'H4'] : [args.gate];
let allPass = true;
let anyCircuit = false;
const circuitResults = [];

console.log(`=== HITL Audit (Fix-First Strategy) ===`);
console.log(``);

for (const g of gatesToCheck) {
  const result = gates[g]();
  const status = result.pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${g}: ${result.detail}`);
  if (result.circuit) {
    console.log(`  [CIRCUIT BREAKER] ${g} triggered circuit breaker condition`);
    anyCircuit = true;
    circuitResults.push({ gate: g, result });
  }
  if (!result.pass) allPass = false;

  recordAuditResult(projectDir, g, result);
}

console.log(``);

if (anyCircuit) {
  console.log(`=== Phase 1: Diagnose & Attempt Fix ===`);
  let allFixed = true;
  for (const cr of circuitResults) {
    console.log(`  ${cr.gate}: ${cr.result.detail}`);
    const fixFn = FIX_FUNCTIONS[cr.gate];
    if (fixFn) {
      const fixResult = fixFn(projectDir, cr.result);
      if (fixResult.success) {
        console.log(`  [FIXED] ${cr.gate}: ${fixResult.action}`);
      } else {
        console.log(`  [FIX FAILED] ${cr.gate}: ${fixResult.reason}`);
        allFixed = false;
      }
    } else {
      console.log(`  [NO FIX FUNCTION] ${cr.gate}`);
      allFixed = false;
    }
  }
  console.log(``);

  if (allFixed) {
    console.log(`=== Phase 2: Re-audit after fix ===`);
    let stillCircuit = false;
    for (const cr of circuitResults) {
      const reResult = gates[cr.gate]();
      const reStatus = reResult.pass ? 'PASS' : 'FAIL';
      console.log(`  [${reStatus}] ${cr.gate}: ${reResult.detail}`);
      if (reResult.circuit) {
        stillCircuit = true;
        recordIncident(projectDir, cr.gate, reResult);
      }
      recordAuditResult(projectDir, cr.gate, reResult);
    }
    console.log(``);

    if (!stillCircuit) {
      console.log(`All HITL audits PASSED after fix.`);
      process.exit(0);
    }
    console.error(`Some checks still failed after fix attempt.`);
  }

  console.error(`\nCircuit breaker triggered after fix attempts. Autonomy downgrade required (L4 → L3).`);
  console.error('Run: node org-status.mjs <project-dir> auto-fallback');
  process.exit(2);
} else if (!allPass) {
  console.error('\nHITL audit FAILED. Fix issues before proceeding.');
  process.exit(1);
} else {
  console.log('All HITL audits PASSED.');
}