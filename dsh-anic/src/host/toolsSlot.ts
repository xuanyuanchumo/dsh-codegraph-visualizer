/**
 * DSH tools 槽位的最小形状契约（tools.ts 与 toolsSkillGateway.ts 共享）。
 * 独立成文件以避免 tools ↔ toolsSkillGateway 的 type-only 循环引用。
 */

/**
 * 工具调用呈现视图（DSH ToolCallView 子集）。
 * M10-d 技能优先面：工具调用时可视化透明化。
 */
export type ToolCallKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other';

/** 通用卡片视图（pending 状态）。 */
export interface GenericCallView {
  card: 'generic';
  title: string;
  kind?: ToolCallKind;
  rawInput?: unknown;
}

/** 终端卡片视图（pending 状态）——命令执行类工具。 */
export interface TerminalCallView {
  card: 'terminal';
  title: string;
  summary?: string;
  cwd?: string;
}

export type ToolCallView = GenericCallView | TerminalCallView;

/** 通用结果视图（completed 状态）。 */
export interface GenericResultView {
  card: 'generic';
  title?: string;
}

/** 终端结果视图（completed 状态）——含退出码与输出。 */
export interface TerminalResultView {
  card: 'terminal';
  title?: string;
  output?: string;
  exitCode?: number;
}

export type ToolResultView = GenericResultView | TerminalResultView;

export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** M10-d: pending 状态呈现（DSH UI 工具卡片标题/图标）。 */
  presentCall?: (args: Record<string, unknown>) => ToolCallView | undefined;
  /** M10-d: completed 状态呈现（DSH UI 工具结果卡片）。 */
  presentResult?: (args: Record<string, unknown>, result: Record<string, unknown>) => ToolResultView | undefined;
}

export interface ToolsSlot {
  register?: (tool: ToolRegistration) => (() => void) | null | undefined;
}

/**
 * 包装 async handler 添加错误兜底（P1-4：11 个 async handler 无 try/catch）。
 * 若 handler 抛异常，返回 { error: message } 而非未处理 Promise 拒绝。
 */
export function safeHandler(
  fn: (args: Record<string, unknown>) => Promise<Record<string, unknown>>,
): (args: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };
}
