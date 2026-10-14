/**
 * 真实性审计：自举的四项基础目标（用户 m04764）。
 * T1 真实性（文件存在）/ T2 准确性（计数与版本）/ T3 结构性（模块限制）/ T4 逻辑性（注册与导入）。
 * 四维检查函数拆至 truthAuditChecks.ts 以满足 250 行模块限制。
 */
export interface AuditFinding {
  check: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface TruthAuditResult {
  dimension: string;
  passed: boolean;
  score: number;
  findings: AuditFinding[];
}

export interface TruthAuditSummary {
  results: TruthAuditResult[];
  overallScore: number;
  allPassed: boolean;
  totalFindings: number;
  failCount: number;
}

import {
  auditTruthfulness,
  auditAccuracy,
  auditStructure,
  auditLogic,
} from './truthAuditChecks.ts';

export { auditTruthfulness, auditAccuracy, auditStructure, auditLogic };

export function runTruthAudit(pluginDir: string): TruthAuditSummary {
  const results: TruthAuditResult[] = [
    auditTruthfulness(pluginDir),
    auditAccuracy(pluginDir),
    auditStructure(pluginDir),
    auditLogic(pluginDir),
  ];
  const overallScore = Math.round(
    results.reduce((sum, r) => sum + r.score, 0) / results.length,
  );
  const failCount = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.status === 'fail').length,
    0,
  );
  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  return {
    results,
    overallScore,
    allPassed: failCount === 0,
    totalFindings,
    failCount,
  };
}
