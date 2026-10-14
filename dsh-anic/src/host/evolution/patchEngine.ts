/**
 * M5 PatchEngine — 技术债务提案引擎。
 *
 * 关键纪律：不自我改码（12 §2.1），只产 tech-debt 条目。
 * 评估结果 → TechDebtEntry[] → 写 .cycles/tech-debt/（原子）。
 */

import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// ── 类型 ────────────────────────────────────────────────

export type DebtSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface TechDebtEntry {
  id: string;
  dimension: string; // E1-E8 / Q1-Q8
  severity: DebtSeverity;
  description: string;
  proposedAction: string;
  createdAt: string;
  resolved: boolean;
}

export interface EvalResult {
  dimension: string;
  passed: boolean;
  score?: number;
  detail: string;
}

// ── 核心逻辑 ────────────────────────────────────────────

/** 评估结果 → 技术债务条目（只产提案，不改码） */
export function generateTechDebt(results: EvalResult[]): TechDebtEntry[] {
  const entries: TechDebtEntry[] = [];
  const now = new Date().toISOString();

  for (const r of results) {
    if (r.passed) continue; // 通过的维度不产债务
    const severity = inferSeverity(r);
    entries.push({
      id: `debt-${r.dimension}-${now.slice(0, 10)}`,
      dimension: r.dimension,
      severity,
      description: r.detail,
      proposedAction: proposeAction(r, severity),
      createdAt: now,
      resolved: false,
    });
  }

  return entries;
}

function inferSeverity(r: EvalResult): DebtSeverity {
  if (r.score !== undefined) {
    if (r.score < 30) return 'critical';
    if (r.score < 50) return 'high';
    if (r.score < 70) return 'medium';
    return 'low';
  }
  // 无分数 → 按维度推断
  const criticalDims = ['E3', 'E7', 'Q2', 'Q4']; // 测试覆盖/安全/测试体系/安全合规
  const highDims = ['E4', 'E5', 'Q1', 'Q3']; // 代码质量/性能/功能业务/性能运维
  if (criticalDims.includes(r.dimension)) return 'critical';
  if (highDims.includes(r.dimension)) return 'high';
  return 'medium';
}

function proposeAction(r: EvalResult, severity: DebtSeverity): string {
  const prefix = severity === 'critical'
    ? '【紧急】'
    : severity === 'high'
      ? '【高优】'
      : '';
  return `${prefix}维度 ${r.dimension} 未通过（${r.detail}）。建议：分析根因 → 拆测 → 修复 → 重新验证。本条目仅为提案，PatchEngine 不自动改码（12 §2.1 纪律）。`;
}

/** 写技术债务到 .cycles/tech-debt/（原子写，INV-7） */
export function writeTechDebt(entries: TechDebtEntry[], cyclesDir: string): string[] {
  if (entries.length === 0) return [];
  const debtDir = join(cyclesDir, 'tech-debt');
  mkdirSync(debtDir, { recursive: true });
  const written: string[] = [];
  for (const e of entries) {
    const filePath = join(debtDir, `${e.id}.json`);
    // 原子写：write to temp then rename
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(e, null, 2), 'utf8');
    renameSync(tmp, filePath);
    written.push(filePath);
  }
  return written;
}
