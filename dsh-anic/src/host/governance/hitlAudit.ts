/**
 * HITL 审计（原生实现，替代技能 hitl-audit.mjs）。
 * H1: 敏感文件检测（git diff + 文件名模式）
 * H2: .gitignore 覆盖检查
 * H3: 破坏性操作检测
 * H4: 账本完整性验证（调用 ledger.verifyLedger）
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyLedger, loadLedger } from '../runtime/ledger.ts';

const SENSITIVE_PATTERNS = [
  /\.env/i, /credentials/i, /secret/i, /password/i, /token/i,
  /api[_-]?key/i, /\.pem$/i, /\.key$/i, /private/i,
];

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i, /DROP\s+TABLE/i, /DELETE\s+FROM/i, /TRUNCATE/i,
  /git\s+push\s+--force/i, /git\s+reset\s+--hard/i,
];

export interface HitlResult {
  check: string;
  passed: boolean;
  detail: string;
  findings?: string[];
}

export function checkH1(workspaceRoot: string): HitlResult {
  let changedFiles: string[] = [];
  try {
    const out = execSync('git diff --name-only HEAD~1', { cwd: workspaceRoot, encoding: 'utf-8', timeout: 5000 });
    changedFiles = out.trim().split('\n').filter(Boolean);
  } catch { /* no git or no commits */ }
  const findings = changedFiles.filter((f) => SENSITIVE_PATTERNS.some((p) => p.test(f)));
  return {
    check: 'H1',
    passed: findings.length === 0,
    detail: findings.length === 0 ? 'no sensitive files in latest commit' : `${findings.length} sensitive file(s) detected`,
    findings: findings.length > 0 ? findings : undefined,
  };
}

export function checkH2(workspaceRoot: string): HitlResult {
  const gitignorePath = join(workspaceRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return { check: 'H2', passed: false, detail: '.gitignore not found' };
  }
  const content = readFileSync(gitignorePath, 'utf-8');
  const required = ['.env', '.cycles/incidents/', 'node_modules'];
  const missing = required.filter((r) => !content.includes(r));
  return {
    check: 'H2',
    passed: missing.length === 0,
    detail: missing.length === 0 ? '.gitignore covers required patterns' : `missing: ${missing.join(', ')}`,
    findings: missing.length > 0 ? missing : undefined,
  };
}

export function checkH3(workspaceRoot: string): HitlResult {
  let diffContent = '';
  try {
    diffContent = execSync('git diff HEAD~1', { cwd: workspaceRoot, encoding: 'utf-8', timeout: 5000 });
  } catch { /* no git */ }
  const findings: string[] = [];
  for (const line of diffContent.split('\n')) {
    if (line.startsWith('+') && DESTRUCTIVE_PATTERNS.some((p) => p.test(line))) {
      findings.push(line.slice(1).trim());
    }
  }
  return {
    check: 'H3',
    passed: findings.length === 0,
    detail: findings.length === 0 ? 'no destructive operations' : `${findings.length} destructive operation(s)`,
    findings: findings.length > 0 ? findings.slice(0, 10) : undefined,
  };
}

export function checkH4(cyclesDir: string): HitlResult {
  const ledgerPath = join(cyclesDir, 'gates', 'ledger.json');
  if (!existsSync(ledgerPath)) {
    return { check: 'H4', passed: true, detail: 'no ledger (fresh workspace)' };
  }
  const ledger = loadLedger(cyclesDir);
  const verification = verifyLedger(cyclesDir);
  return {
    check: 'H4',
    passed: verification.ok,
    detail: verification.ok ? `ledger chain valid (${ledger.length} entries)` : `chain broken at index ${verification.brokenAt}`,
    findings: verification.ok ? undefined : [`broken at entry ${verification.brokenAt}: ${verification.reason}`],
  };
}

export function runHitlAudit(workspaceRoot: string): { checks: HitlResult[]; allPassed: boolean } {
  const cyclesDir = join(workspaceRoot, '.cycles');
  const checks = [checkH1(workspaceRoot), checkH2(workspaceRoot), checkH3(workspaceRoot), checkH4(cyclesDir)];
  return { checks, allPassed: checks.every((c) => c.passed) };
}
