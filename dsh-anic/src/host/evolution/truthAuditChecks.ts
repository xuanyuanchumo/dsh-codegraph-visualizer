/** 真实性审计四维检查函数（从 truthAudit.ts 拆出以满足 250 行模块限制）。 */
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import type { TruthAuditResult, AuditFinding } from './truthAudit.ts';

const MAX_FILE_LINES = 250;

function collectTsFiles(dir: string, base: string = ''): { path: string; lines: number }[] {
  const files: { path: string; lines: number }[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) files.push(...collectTsFiles(full, rel));
    else if (entry.endsWith('.ts')) {
      const lines = readFileSync(full, 'utf8').split('\n').length;
      files.push({ path: rel, lines });
    }
  }
  return files;
}

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) count += countFilesRecursive(full);
    else count++;
  }
  return count;
}

export function auditTruthfulness(pluginDir: string): TruthAuditResult {
  const findings: AuditFinding[] = [];
  const requiredDirs = ['src/host/runtime','src/host/evolution','src/host/governance','src/host/llm','src/host/routes','src/shared','src/client/features','src/adapters'];
  const requiredFiles = ['src/host/tools.ts','src/host/config.ts','src/host/logger.ts','src/host/skillInvoker.ts','src/host/selfBootstrap.ts','src/host/dualBootstrap.ts','src/shared/flows.ts','src/shared/errors.ts','src/shared/fs-safe.ts','src/shared/snapshotCore.ts','src/shared/stepTrace.ts','src/adapters/index.ts','src/client/WorkflowGraphPanel.ts','src/client/integrations/WorkflowTabIntegration.ts'];
  let passCount = 0;
  for (const dir of requiredDirs) {
    const exists = existsSync(join(pluginDir, dir));
    findings.push({ check: `dir:${dir}`, status: exists ? 'pass' : 'fail', detail: exists ? 'exists' : 'MISSING' });
    if (exists) passCount++;
  }
  for (const file of requiredFiles) {
    const exists = existsSync(join(pluginDir, file));
    findings.push({ check: `file:${file}`, status: exists ? 'pass' : 'fail', detail: exists ? 'exists' : 'MISSING' });
    if (exists) passCount++;
  }
  const total = requiredDirs.length + requiredFiles.length;
  return { dimension: 'T1_truthfulness', passed: passCount === total, score: Math.round((passCount / total) * 100), findings };
}

export function auditAccuracy(pluginDir: string): TruthAuditResult {
  const findings: AuditFinding[] = [];
  const tsFiles = collectTsFiles(join(pluginDir, 'src'));
  findings.push({ check: 'src .ts file count', status: tsFiles.length > 30 ? 'pass' : 'warn', detail: `${tsFiles.length} files (expect >30)` });
  const testFiles = collectTsFiles(join(pluginDir, 'tests'));
  findings.push({ check: 'test file count', status: testFiles.length >= 8 ? 'pass' : 'warn', detail: `${testFiles.length} files (expect >=8)` });
  const agentsDir = join(pluginDir, 'assets', 'agents');
  const agentCount = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.json')).length : 0;
  findings.push({ check: 'agent card count', status: agentCount === 15 ? 'pass' : 'fail', detail: `${agentCount} cards (expect 15)` });
  const skillCount = existsSync(join(pluginDir, 'assets', 'skill')) ? countFilesRecursive(join(pluginDir, 'assets', 'skill')) : 0;
  findings.push({ check: 'inline skill file count', status: skillCount >= 60 ? 'pass' : 'warn', detail: `${skillCount} files (expect >=60)` });
  let version = 'unknown';
  const pkgPath = join(pluginDir, 'package.json');
  if (existsSync(pkgPath)) { try { version = JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? 'unknown'; } catch { /* ignore */ } }
  findings.push({ check: 'package version', status: version !== '0.0.0' && version !== 'unknown' ? 'pass' : 'fail', detail: `v${version}` });
  const passCount = findings.filter((f) => f.status === 'pass').length;
  return { dimension: 'T2_accuracy', passed: findings.every((f) => f.status !== 'fail'), score: Math.round((passCount / findings.length) * 100), findings };
}

export function auditStructure(pluginDir: string): TruthAuditResult {
  const findings: AuditFinding[] = [];
  const tsFiles = collectTsFiles(join(pluginDir, 'src'));
  const oversized = tsFiles.filter((f) => f.lines > MAX_FILE_LINES);
  for (const file of oversized) findings.push({ check: `file:${file.path}`, status: 'fail', detail: `${file.lines} lines > ${MAX_FILE_LINES} limit` });
  findings.push({ check: 'modular compliance', status: oversized.length === 0 ? 'pass' : 'fail', detail: `${tsFiles.length - oversized.length}/${tsFiles.length} within limit` });
  for (const domain of ['runtime', 'evolution', 'governance', 'llm', 'routes']) {
    const exists = existsSync(join(pluginDir, 'src', 'host', domain));
    findings.push({ check: `domain:host/${domain}`, status: exists ? 'pass' : 'warn', detail: exists ? 'separated' : 'MISSING' });
  }
  const score = Math.round((findings.filter((f) => f.status === 'pass').length / findings.length) * 100);
  return { dimension: 'T3_structure', passed: oversized.length === 0, score, findings };
}

export function auditLogic(pluginDir: string): TruthAuditResult {
  const findings: AuditFinding[] = [];
  const routesDir = join(pluginDir, 'src', 'host', 'routes');
  if (existsSync(routesDir)) {
    for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
      const content = readFileSync(join(routesDir, file), 'utf8');
      const hasReg = content.includes('register') || content.includes('reg(');
      findings.push({ check: `route:${file}`, status: hasReg ? 'pass' : 'warn', detail: hasReg ? 'has registration' : 'no registration' });
    }
  }
  const indexPath = join(pluginDir, 'src', 'host', 'routes', 'index.ts');
  if (existsSync(indexPath)) {
    const importCount = (readFileSync(indexPath, 'utf8').match(/^import\s/gm) ?? []).length;
    findings.push({ check: 'routes/index.ts imports', status: importCount >= 8 ? 'pass' : 'warn', detail: `${importCount} imports (expect >=8)` });
  }
  const toolsPath = join(pluginDir, 'src', 'host', 'tools.ts');
  if (existsSync(toolsPath)) {
    const toolCount = (readFileSync(toolsPath, 'utf8').match(/name:\s*['"]anic_/g) ?? []).length;
    findings.push({ check: 'DSH tool count', status: toolCount >= 9 ? 'pass' : 'warn', detail: `${toolCount} tools (expect >=9)` });
  }
  const score = Math.round((findings.filter((f) => f.status === 'pass').length / findings.length) * 100);
  return { dimension: 'T4_logic', passed: findings.every((f) => f.status !== 'fail'), score, findings };
}
