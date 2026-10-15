/**
 * DSH tools 槽位的最小形状契约（tools.ts 与 toolsSkillGateway.ts 共享）。
 * 独立成文件以避免 tools ↔ toolsSkillGateway 的 type-only 循环引用。
 */

export interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
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
