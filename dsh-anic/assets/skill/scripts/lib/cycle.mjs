// cycle.mjs — cycle 目录定位唯一实现（进化 iteration-1，修字典序缺陷）
// 背景：eval-runner.mjs:48 / gate-check.mjs:33 / multi-agent-gate.mjs:30 都用
// entries.sort().pop() 取"最新 cycle"——字典序下 'cycle-9' > 'cycle-10'，
// cycle 编号到两位数后所有脚本都会选错目录。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function cycleNumber(dirName) {
  const m = dirName.match(/^cycle-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

export function getLatestCycleDir(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  if (!existsSync(cyclesDir)) return null;
  const entries = readdirSync(cyclesDir).filter(e => /^cycle-\d+$/.test(e));
  if (entries.length === 0) return null;
  return entries.sort((a, b) => cycleNumber(a) - cycleNumber(b)).pop();
}

// v1.8.3：列表形态的同一实现（archive-cycle / workflow-state / org-status / auto-fix-loop /
// hitl-audit 各自的 readdirSync+startsWith+sort() 字典序变体全部收敛到这里）。
// 返回数值序排列的 cycle 目录名数组；cyclesDir 不存在时返回 []。
export function listCycleDirNames(cyclesDir) {
  if (!existsSync(cyclesDir)) return [];
  return readdirSync(cyclesDir)
    .filter(e => /^cycle-\d+$/.test(e))
    .sort((a, b) => cycleNumber(a) - cycleNumber(b));
}
