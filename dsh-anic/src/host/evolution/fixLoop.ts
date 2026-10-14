/**
 * 修复循环（原生实现，替代技能 auto-fix-loop.mjs）。
 * 验证 → 失败模式分析 → 根因诊断 → 修复 → 重新验证。
 * 不自我改码（12 §2.1），只产 tech-debt 提案。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateTechDebt, type EvalResult, type TechDebtEntry } from './patchEngine.ts';

export type FixStep = 'verify' | 'diagnose' | 'fix' | 're-verify' | 'converged' | 'exhausted';
export const MAX_RETRIES = 3;

export interface FixLoopIteration {
  round: number;
  step: FixStep;
  passed: boolean;
  failures?: string[];
  diagnosis?: string;
  proposal?: TechDebtEntry;
  durationMs: number;
}

export interface FixLoopResult {
  iterations: FixLoopIteration[];
  converged: boolean;
  totalRounds: number;
  techDebtGenerated: TechDebtEntry[];
  finalVerdict: 'PASS' | 'FAIL' | 'EXHAUSTED';
}

/** 解析测试报告中的失败行。 */
function parseFailures(report: string): string[] {
  const failures: string[] = [];
  for (const line of report.split('\n')) {
    if (line.includes('FAIL') || line.includes('失败') || line.includes('Error')) {
      failures.push(line.trim());
    }
  }
  return failures;
}

/** 根因诊断（基于失败模式的启发式分析）。 */
function diagnoseFailures(failures: string[]): string {
  if (failures.length === 0) return 'no failures';
  const patterns: Record<string, string> = {
    'TypeError': 'type mismatch — check function signatures and null guards',
    'ReferenceError': 'undefined reference — check imports and variable scope',
    'AssertionError': 'assertion failed — check expected vs actual values',
    'Timeout': 'timeout — check async operations and increase timeout if needed',
    'ENOENT': 'file not found — check file paths and existence guards',
  };
  for (const [pattern, diagnosis] of Object.entries(patterns)) {
    if (failures.some((f) => f.includes(pattern))) return diagnosis;
  }
  return `unclassified failure pattern (${failures.length} failures)`;
}

export function runFixLoop(
  workspaceRoot: string,
  verifyFn: () => { passed: boolean; report: string },
  options?: { maxRetries?: number },
): FixLoopResult {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const iterations: FixLoopIteration[] = [];
  const techDebtGenerated: TechDebtEntry[] = [];
  let converged = false;
  let round = 0;

  while (round < maxRetries && !converged) {
    round++;
    const start = Date.now();

    // Step 1: Verify
    const verifyResult = verifyFn();
    const failures = verifyResult.passed ? [] : parseFailures(verifyResult.report);
    iterations.push({
      round, step: 'verify', passed: verifyResult.passed,
      failures: failures.length > 0 ? failures.slice(0, 10) : undefined,
      durationMs: Date.now() - start,
    });

    if (verifyResult.passed) {
      converged = true;
      iterations.push({ round, step: 'converged', passed: true, durationMs: 0 });
      break;
    }

    // Step 2: Diagnose
    const diagnosis = diagnoseFailures(failures);
    iterations.push({ round, step: 'diagnose', passed: false, diagnosis, durationMs: 0 });

    // Step 3: Fix (generate tech-debt proposal, don't self-modify)
    const evalResults: EvalResult[] = failures.map((f) => ({
      dimension: 'E4',
      score: 0,
      detail: f,
      artifacts: [],
      passed: false,
    }));
    const proposals = generateTechDebt(evalResults);
    const proposal = proposals[0];
    techDebtGenerated.push(...proposals);
    iterations.push({ round, step: 'fix', passed: false, proposal, durationMs: 0 });

    // Step 4: Re-verify
    const reVerify = verifyFn();
    iterations.push({
      round, step: 're-verify', passed: reVerify.passed,
      failures: reVerify.passed ? undefined : parseFailures(reVerify.report).slice(0, 10),
      durationMs: Date.now() - start,
    });

    if (reVerify.passed) {
      converged = true;
      iterations.push({ round, step: 'converged', passed: true, durationMs: 0 });
      break;
    }
  }

  // 持久化 tech-debt
  if (techDebtGenerated.length > 0) {
    const tdDir = join(workspaceRoot, '.cycles', 'tech-debt');
    mkdirSync(tdDir, { recursive: true });
    const tdPath = join(tdDir, `fix-loop-${Date.now()}.json`);
    writeFileSync(tdPath, JSON.stringify(techDebtGenerated, null, 2));
  }

  const finalVerdict: 'PASS' | 'FAIL' | 'EXHAUSTED' = converged ? 'PASS' : round >= maxRetries ? 'EXHAUSTED' : 'FAIL';
  return { iterations, converged, totalRounds: round, techDebtGenerated, finalVerdict };
}
