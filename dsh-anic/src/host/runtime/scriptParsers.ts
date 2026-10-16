/**
 * 技能脚本输出解析器 —— cycle-96 按真实输出契约重写（P0-BOOTSTRAP-PARSER）。
 *
 * 旧实现（bootstrapOrchestrator.ts 与 selfBootstrapRoute.ts 各一份，共两份重复）
 * 按虚构格式解析："Overall score: 0.875" / "GATE: PASS" / "Applied: ..."。
 * 三个真实脚本从不输出这些行，后果：
 *   parseEvalScore 恒 0、parseGateVerdict 恒 'unknown'（真实工作区永远走不到
 *   CONVERGED，advanceBootstrap 只认 'PASS'/'approve'）、parseFixApplied 恒 null。
 * 自举链 M10-b 名义上连通，实际从未在真实环境正确裁决过。
 *
 * 真实输出契约（assets/skill/scripts/ 源码为证，行号为 cycle-96 基线）：
 * eval-runner.mjs：
 *   :498 stdout "Evaluation report written to <path>"（cycle 目录存在时）
 *   :515 stdout "\nAll N evaluated dimension(s) passed."（全部通过，exit 0）
 *   :509 stderr "\nN dimension(s) failed: E3, E8, Q8"（有失败，exit 1）
 *   :517 stdout "M dimension(s) SKIPPED (not evaluated, NOT pass): ..."（SKIP ≠ PASS）
 * gate-check.mjs：
 *   :197 status 仅两值（result.pass ? 'PASS' : 'FAIL'）
 *   :198 stdout "[PASS|FAIL] G0: <detail>"（逐门禁行）
 *   :219 stdout "  [PASS|FAIL] G0-Quality: <detail>"（--quality 行，缩进两格；
 *           质量 FAIL 同样拉低总裁决 :220）
 *   :228 stdout "\nAll gates PASSED."（全部通过，exit 0）
 *   :225 stderr "\nGate check FAILED. Fix issues before proceeding."（有失败，exit 1）
 *   :209/:212 "  [LEDGER] ..." 行不含 [PASS]/[FAIL] 前缀，不参与裁决
 * auto-fix-loop.mjs：
 *   :244 stdout "All tests passed. No fixes needed."（无需修复）
 *   :251 stdout "Identified N failure(s):" + :253 "  - <type>: <detail>" 行
 *   :274 stdout "Fix successful. All tests now pass."（修复并验证通过）
 *   :280 stdout "Fix attempt N failed. M failure(s) remain."（修复未通过）
 *
 * 同一语义必须单一实现：两份重复解析只会向坏方向漂移，故合并到本文件。
 */

import type { InvokeResult } from '../skillInvoker.ts';

/** 解析器输入：只需输出双流（测试可直接构造字面量，无需完整 InvokeResult）。 */
export type ScriptOutput = Pick<InvokeResult, 'stdout' | 'stderr'>;

/**
 * eval-runner 裁决 → 1 | 0。
 *
 * 真实 stdout 没有连续分数行；失败路径也不打印通过数，连续分数不可推导
 * （失败清单在 stderr :509，通过总数只在成功路径 :515 出现）。
 * 忠实二值：1 = 全部已评估维度通过（exit 0）；0 = 存在失败维度或输出不可识别。
 * evalScore 在状态机中只作记录（advanceBootstrap 不按它分支），二值即诚实——
 * 宁可少报精度，不可虚构 "0.875" 这种从未存在过的数。
 */
export function parseEvalScore(result: ScriptOutput): number {
  // 失败清单只在 stderr（:509）；stdout 无对应行，只看 stderr 是有意为之
  if (/dimension\(s\) failed:/.test(result.stderr)) return 0;
  if (/All \d+ evaluated dimension\(s\) passed\./.test(result.stdout)) return 1;
  return 0;
}

/**
 * gate-check 裁决 → 'PASS' | 'FAIL' | 'unknown'。
 *
 * 总裁决行优先（--gate all 时的官方裁决）；无总裁决行的部分运行
 * （如 --gate G1）退回逐门禁行统计。'unknown' 保留给完全无法识别的
 * 输出——调用方把它当"未通过"处理（advanceBootstrap 只认 PASS/approve）。
 */
export function parseGateVerdict(result: ScriptOutput): string {
  if (/All gates PASSED\./.test(result.stdout)) return 'PASS';
  if (/Gate check FAILED\./.test(result.stderr)) return 'FAIL';
  // 部分门禁运行无总裁决行：逐门禁行兜底。
  // 质量行（"  [FAIL] G0-Quality:"）同规则命中——质量 FAIL 本就拉低总裁决（:220）。
  // LEDGER 行前缀是 [LEDGER] 不匹配本规则，天然不干扰。
  const gateLines = result.stdout.match(/^[ \t]*\[(PASS|FAIL)\] G\d/gm) ?? [];
  if (gateLines.length === 0) return 'unknown';
  const anyFail = gateLines.some((l) => l.includes('[FAIL]'));
  return anyFail ? 'FAIL' : 'PASS';
}

/**
 * auto-fix-loop 修复描述 → string | null。
 *
 * null = 无需修复（:244）/ 修复未验证通过（:280）/ 输出不可识别；
 * string = "修复并通过: <type1>: <detail1>; <type2>: ..."。
 * 修复描述取最后一次 Identified 清单——多次尝试时，前面尝试的失败
 * 可能已被后续尝试修复，只有最后一段对应最终通过的修复。
 */
export function parseFixApplied(result: ScriptOutput): string | null {
  if (/All tests passed\. No fixes needed\./.test(result.stdout)) return null;
  if (!/Fix successful\. All tests now pass\./.test(result.stdout)) return null;
  // 多次尝试取最后一段 Identified 清单
  const sections = [
    ...result.stdout.matchAll(/Identified \d+ failure\(s\):\r?\n((?:[ \t]*- .+(?:\r?\n|$))+)/g),
  ];
  const last = sections.at(-1);
  if (!last?.[1]) return 'Fix successful. All tests now pass.';
  const items = last[1]
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^-\s+/, ''))
    .filter(Boolean);
  return items.length > 0 ? `修复并通过: ${items.join('; ')}` : 'Fix successful. All tests now pass.';
}
