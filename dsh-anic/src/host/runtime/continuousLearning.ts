/**
 * 持续学习层（M10-e）。
 *
 * 分析 FlowTracker 历史数据，识别模式并生成改进建议。
 * 为大模型自举提供反馈闭环：eval 结果 → 模式识别 → 改进建议 → 下一轮自举。
 *
 * 设计约束：
 * - 纯函数分析（无副作用，无 IO）——输入 FlowTrackerState，输出 SkillHealthReport
 * - 零外部依赖（仅 node:path 用于 workspace 显示截断）
 * - 建议基于阈值，阈值在此文件内集中声明（单一事实源）
 */
import type { FlowTrackerState, FlowRecord } from './flowTracker.ts';

// ── 阈值常量（单一事实源） ──

/** 成功率低于此值标记为 degraded。 */
const DEGRADED_SUCCESS_RATE = 0.8;
/** 超时率高于此值标记为 slow。 */
const SLOW_TIMEOUT_RATE = 0.2;
/** 平均耗时高于此值标记为 expensive。 */
const EXPENSIVE_DURATION_MS = 30000;
/** 样本数低于此值不评估（统计无意义）。 */
const MIN_SAMPLE = 3;
/** workspace 显示截断长度。 */
const WS_DISPLAY_MAX = 60;

// ── 类型定义 ──

export type HealthLevel = 'healthy' | 'degraded' | 'slow' | 'expensive' | 'insufficient' | 'unused';

export interface ScriptHealth {
  /** 脚本名。 */
  script: string;
  /** 健康等级。 */
  level: HealthLevel;
  /** 总调用次数。 */
  total: number;
  /** 成功率（0-1）。 */
  successRate: number;
  /** 超时率（0-1）。 */
  timeoutRate: number;
  /** 平均耗时（ms）。 */
  avgDurationMs: number;
  /** 最近一次调用时间。 */
  lastInvoked?: string;
}

export type SuggestionSeverity = 'info' | 'warn' | 'critical';

export interface ImprovementSuggestion {
  /** 建议 ID。 */
  id: string;
  /** 严重程度。 */
  severity: SuggestionSeverity;
  /** 关联脚本。 */
  script: string;
  /** 建议描述。 */
  description: string;
  /** 建议动作。 */
  action: string;
}

export interface SkillHealthReport {
  /** 按脚本分组的健康报告。 */
  scripts: ScriptHealth[];
  /** 改进建议。 */
  suggestions: ImprovementSuggestion[];
  /** 全局成功率。 */
  overallSuccessRate: number;
  /** 总调用次数。 */
  totalInvocations: number;
  /** 报告生成时间。 */
  generatedAt: string;
}

// ── 纯函数实现 ──

/** 计算单个脚本的健康指标。 */
function computeScriptHealth(script: string, flows: FlowRecord[]): ScriptHealth {
  const total = flows.length;
  const done = flows.filter((f) => f.status === 'DONE').length;
  const timeout = flows.filter((f) => f.status === 'TIMEOUT').length;
  const completed = flows.filter((f) => f.durationMs !== undefined);
  const avgDurationMs = completed.length > 0
    ? Math.round(completed.reduce((sum, f) => sum + (f.durationMs ?? 0), 0) / completed.length)
    : 0;
  const successRate = total > 0 ? done / total : 0;
  const timeoutRate = total > 0 ? timeout / total : 0;
  const lastInvoked = flows[flows.length - 1]?.startedAt;

  let level: HealthLevel;
  if (total < MIN_SAMPLE) level = 'insufficient';
  else if (timeoutRate > SLOW_TIMEOUT_RATE) level = 'slow';
  else if (successRate < DEGRADED_SUCCESS_RATE) level = 'degraded';
  else if (avgDurationMs > EXPENSIVE_DURATION_MS) level = 'expensive';
  else level = 'healthy';

  return { script, level, total, successRate, timeoutRate, avgDurationMs, lastInvoked };
}

/** 根据健康指标生成改进建议。 */
function suggestFromHealth(h: ScriptHealth): ImprovementSuggestion | null {
  if (h.level === 'insufficient' || h.level === 'unused') return null;

  if (h.level === 'degraded') {
    return {
      id: `fix-${h.script}`,
      severity: h.successRate < 0.5 ? 'critical' : 'warn',
      script: h.script,
      description: `${h.script} 成功率 ${(h.successRate * 100).toFixed(0)}%（${h.total} 次调用）`,
      action: '检查 stderr 日志，定位失败原因，修复后重跑 eval',
    };
  }
  if (h.level === 'slow') {
    return {
      id: `speed-${h.script}`,
      severity: 'warn',
      script: h.script,
      description: `${h.script} 超时率 ${(h.timeoutRate * 100).toFixed(0)}%（${h.total} 次调用）`,
      action: '考虑增加 timeout 或优化脚本执行效率',
    };
  }
  if (h.level === 'expensive') {
    return {
      id: `perf-${h.script}`,
      severity: 'info',
      script: h.script,
      description: `${h.script} 平均耗时 ${h.avgDurationMs}ms`,
      action: '考虑缓存结果或拆分为更小步骤',
    };
  }
  return null;
}

/** 截断 workspace 路径用于显示。 */
function truncateWs(ws: string): string {
  return ws.length > WS_DISPLAY_MAX ? `...${ws.slice(-WS_DISPLAY_MAX)}` : ws;
}

/**
 * 分析 FlowTracker 状态，生成技能健康报告 + 改进建议。
 *
 * 纯函数：无副作用，无 IO。输入状态，输出报告。
 */
export function analyzeSkillHealth(state: FlowTrackerState): SkillHealthReport {
  const flows = state.flows;
  const scriptNames = [...new Set(flows.map((f) => f.script))];

  const scripts = scriptNames
    .map((name) => computeScriptHealth(name, flows.filter((f) => f.script === name)))
    .sort((a, b) => b.total - a.total);

  const suggestions = scripts
    .map(suggestFromHealth)
    .filter((s): s is ImprovementSuggestion => s !== null);

  const totalInvocations = flows.length;
  const totalDone = flows.filter((f) => f.status === 'DONE').length;
  const overallSuccessRate = totalInvocations > 0 ? totalDone / totalInvocations : 0;

  return {
    scripts,
    suggestions,
    overallSuccessRate,
    totalInvocations,
    generatedAt: new Date().toISOString(),
  };
}

/** 格式化健康报告为可读摘要（供 anic_status 返回）。 */
export function formatHealthSummary(report: SkillHealthReport): string {
  const lines: string[] = [];
  lines.push(`技能健康报告（${report.generatedAt}）`);
  lines.push(`总调用 ${report.totalInvocations} 次，全局成功率 ${(report.overallSuccessRate * 100).toFixed(0)}%`);
  lines.push('');
  for (const s of report.scripts) {
    const icon = s.level === 'healthy' ? '✅' : s.level === 'insufficient' ? '⚪' : '⚠️';
    lines.push(`${icon} ${s.script}: ${s.level}（${s.total} 次，成功率 ${(s.successRate * 100).toFixed(0)}%）`);
  }
  if (report.suggestions.length > 0) {
    lines.push('');
    lines.push('改进建议：');
    for (const s of report.suggestions) {
      lines.push(`  [${s.severity}] ${s.description} → ${s.action}`);
    }
  }
  return lines.join('\n');
}
