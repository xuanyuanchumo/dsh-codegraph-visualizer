/**
 * 双向自举：插件自举 + 技能自举。
 *
 * 插件侧：评估 dsh-anic 自身代码质量（测试通过率/路由数/类型检查/构建）。
 * 技能侧：评估 ai-native-iteration-cycle 技能迭代效果（eval-runner 得分/门禁通过率）。
 * 双向：插件为技能产 tech-debt 提案，技能为插件产 tech-debt 提案（不互相改码，R-31）。
 */
import { join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { atomicWriteFileSync, safeReadFileSync } from '../shared/fs-safe.ts';
import {
  type BootstrapState,
  initialBootstrapState,
  loadBootstrapState,
  saveBootstrapState,
  advanceBootstrap,
} from './selfBootstrap.ts';
import { runTruthAudit, type TruthAuditSummary } from './evolution/truthAudit.ts';

export type BootstrapTarget = 'plugin' | 'skill';

export interface DualBootstrapState {
  plugin: BootstrapState;
  skill: BootstrapState;
  crossProposals: CrossProposal[];
  /** 真实性审计结果（自举四目标：真实/准确/结构/逻辑）。 */
  truthAudit?: TruthAuditSummary;
}

export interface CrossProposal {
  from: BootstrapTarget;
  to: BootstrapTarget;
  round: number;
  proposal: string;
  severity: 'info' | 'warn' | 'critical';
  timestamp: string;
}

const DUAL_FILE = 'dual-bootstrap.json';

export function loadDualBootstrapState(cyclesDir: string): DualBootstrapState {
  const file = join(cyclesDir, DUAL_FILE);
  const raw = safeReadFileSync(file);
  if (!raw) return { plugin: initialBootstrapState(), skill: initialBootstrapState(), crossProposals: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed.plugin && parsed.skill) return parsed as DualBootstrapState;
  } catch { /* reset */ }
  return { plugin: initialBootstrapState(), skill: initialBootstrapState(), crossProposals: [] };
}

export function saveDualBootstrapState(cyclesDir: string, state: DualBootstrapState): void {
  atomicWriteFileSync(join(cyclesDir, DUAL_FILE), JSON.stringify(state, null, 2));
}

/** 评估插件自身：统计测试数/路由数/源文件数 + 真实性审计 → 综合分。 */
export function evaluatePluginSelf(pluginDir: string): { score: number; details: string; truthAudit: TruthAuditSummary } {
  const srcDir = join(pluginDir, 'src');
  let srcFiles = 0;
  if (existsSync(srcDir)) {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) srcFiles++;
      }
    };
    walk(srcDir);
  }
  const testDir = join(pluginDir, 'tests');
  let testFiles = 0;
  if (existsSync(testDir)) {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) testFiles++;
      }
    };
    walk(testDir);
  }
  const ratio = srcFiles > 0 ? testFiles / srcFiles : 0;
  const truthAudit = runTruthAudit(pluginDir);
  const baseScore = Math.round(Math.min(ratio * 60 + 20, 100));
  const score = Math.round(baseScore * 0.6 + truthAudit.overallScore * 0.4);
  return {
    score,
    details: `srcFiles=${srcFiles} testFiles=${testFiles} ratio=${ratio.toFixed(2)} truthAudit=${truthAudit.overallScore} → score=${score}`,
    truthAudit,
  };
}

/** 评估技能自身：检查 .cycles/ 工件完整性 → 综合分。 */
export function evaluateSkillSelf(cyclesDir: string): { score: number; details: string } {
  let cycles = 0;
  const cyclesParent = join(cyclesDir, 'cycles');
  if (existsSync(cyclesParent)) {
    cycles = readdirSync(cyclesParent).filter((d) => /^cycle-\d+$/.test(d)).length;
  }
  const ledgerPath = join(cyclesDir, 'gates', 'ledger.json');
  const hasLedger = existsSync(ledgerPath);
  const configPath = join(cyclesDir, 'config.yml');
  const hasConfig = existsSync(configPath);
  let score = 0;
  if (hasConfig) score += 30;
  if (hasLedger) score += 30;
  score += Math.min(cycles * 5, 40);
  return { score, details: `cycles=${cycles} ledger=${hasLedger} config=${hasConfig} → score=${score}` };
}

/** 推进双向自举一轮。 */
export function advanceDualBootstrap(
  cyclesDir: string,
  state: DualBootstrapState,
  target: BootstrapTarget,
  evalScore: number,
  gateVerdict: string,
): DualBootstrapState {
  const sideState = state[target];
  const newSide = advanceBootstrap(sideState, evalScore, gateVerdict, null);
  const proposals: CrossProposal[] = [...state.crossProposals];
  if (gateVerdict !== 'PASS' && gateVerdict !== 'approve') {
    proposals.push({
      from: target,
      to: target === 'plugin' ? 'skill' : 'plugin',
      round: newSide.round,
      proposal: `${target} 自举第 ${newSide.round} 轮未通过（score=${evalScore}, verdict=${gateVerdict}），建议对端审查并产 tech-debt 提案`,
      severity: evalScore < 40 ? 'critical' : 'warn',
      timestamp: new Date().toISOString(),
    });
  }
  const newState: DualBootstrapState = {
    plugin: target === 'plugin' ? newSide : state.plugin,
    skill: target === 'skill' ? newSide : state.skill,
    crossProposals: proposals,
    truthAudit: target === 'plugin' ? state.truthAudit : state.truthAudit,
  };
  saveDualBootstrapState(cyclesDir, newState);
  return newState;
}
