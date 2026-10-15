/**
 * 工具呈现视图助手（M10-d 技能优先面）。
 *
 * 为 dsh-anic 工具构造 DSH ToolCallView / ToolResultView，
 * 使大模型调用 anic_* 工具时 DSH UI 能透明呈现：
 * - pending 状态：终端卡片（命令 + 工作目录）
 * - completed 状态：终端结果卡片（输出 + 退出码）
 *
 * 纯函数无副作用，可被 presentCall/presentResult 安全调用。
 */

import type {
  TerminalCallView,
  TerminalResultView,
  GenericCallView,
  GenericResultView,
  ToolCallKind,
} from './toolsSlot.ts';
import { t } from './i18n.ts';

/**
 * 构造终端调用视图（pending 状态）。
 * 用于脚本执行类工具（anic_skill/anic_evaluate/anic_iterate 等）。
 */
export function terminalCall(
  title: string,
  cwd: string,
  summary?: string,
): TerminalCallView {
  return { card: 'terminal', title, cwd, summary };
}

/**
 * 构造终端结果视图（completed 状态）。
 * 将 handler 返回的 { exitCode, stdout, stderr } 映射为终端卡片。
 */
export function terminalResult(
  result: Record<string, unknown>,
  title?: string,
): TerminalResultView {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : undefined;
  const output = stderr ? `${stdout}\n-- stderr --\n${stderr}` : stdout;
  return { card: 'terminal', title, output: output || undefined, exitCode };
}

/**
 * 构造通用调用视图（pending 状态）。
 * 用于非脚本类工具（anic_status/anic_snapshot 等）。
 */
export function genericCall(
  title: string,
  kind: ToolCallKind = 'other',
  rawInput?: unknown,
): GenericCallView {
  return { card: 'generic', title, kind, rawInput };
}

/**
 * 构造通用结果视图（completed 状态）。
 */
export function genericResult(title?: string): GenericResultView {
  return { card: 'generic', title };
}

/**
 * anic_skill presentCall：终端卡片显示脚本名 + 工作目录。
 */
export function skillPresentCall(args: Record<string, unknown>): TerminalCallView {
  const script = typeof args.script === 'string' ? args.script : '?';
  const workspace = typeof args.workspace === 'string' ? args.workspace : '.';
  return terminalCall(`anic_skill: ${script}`, workspace, t('presentation.skillSummary', { script }));
}

/**
 * anic_skill presentResult：终端结果卡片显示输出 + 退出码。
 */
export function skillPresentResult(
  _args: Record<string, unknown>,
  result: Record<string, unknown>,
): TerminalResultView {
  const script = typeof _args.script === 'string' ? _args.script : '?';
  return terminalResult(result, `anic_skill: ${script} ✓`);
}

/**
 * anic_evaluate presentCall：终端卡片显示评估维度 + 工作目录。
 */
export function evaluatePresentCall(args: Record<string, unknown>): TerminalCallView {
  const dims = typeof args.dimensions === 'string' ? args.dimensions : 'all';
  const workspace = typeof args.workspace === 'string' ? args.workspace : '.';
  return terminalCall(`anic_evaluate [${dims}]`, workspace, t('presentation.evaluateSummary'));
}

/**
 * anic_iterate presentCall：终端卡片显示迭代循环。
 */
export function iteratePresentCall(args: Record<string, unknown>): TerminalCallView {
  const workspace = typeof args.workspace === 'string' ? args.workspace : '.';
  return terminalCall('anic_iterate', workspace, t('presentation.iterateSummary'));
}

/**
 * anic_bootstrap_cycle presentCall：终端卡片显示自举循环。
 */
export function bootstrapCyclePresentCall(args: Record<string, unknown>): TerminalCallView {
  const workspace = typeof args.workspace === 'string' ? args.workspace : '.';
  const maxRounds = typeof args.maxRounds === 'number' ? args.maxRounds : 3;
  return terminalCall(t('presentation.bootstrapCycleTitle', { maxRounds }), workspace, t('presentation.bootstrapCycleSummary'));
}

/**
 * anic_bootstrap_analyze presentCall：终端卡片显示自举分析。
 */
export function bootstrapAnalyzePresentCall(args: Record<string, unknown>): TerminalCallView {
  const workspace = typeof args.workspace === 'string' ? args.workspace : '.';
  return terminalCall('anic_bootstrap_analyze', workspace, t('presentation.bootstrapAnalyzeSummary'));
}

/**
 * anic_status presentCall：通用卡片显示状态查询。
 */
export function statusPresentCall(args: Record<string, unknown>): GenericCallView {
  const workspace = typeof args.workspace === 'string' ? args.workspace : '.';
  return genericCall('anic_status', 'read', { workspace });
}
