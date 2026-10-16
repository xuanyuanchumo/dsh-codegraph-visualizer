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

/**
 * 模型可见内容块（DSH ContentBlock 子集，本插件只用 text 块）。
 *
 * 宿主证据（安装版 0.2.0-rc.2，与 dsh-plugin-dev-kb tools.md:23 契约一致）：
 * dsh-llm/lib/index.js:594 请求组装期 `contentHasImage(content)` 调
 * `content.some(...)` —— content 必须是 ContentBlock[]。render 返回裸字符串时
 * 注册表的 snapshotProjection（dsh-tools/lib/index.js:2564）不拦截（字符串是
 * 无损 JSON），直到请求组装才 `content.some is not a function` 崩溃
 * （P0-RENDER-CONTENT：真模型实测 anic_evaluate/anic_status/anic_skill 三工具同错）。
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/**
 * 工具输出声明（DSH tools.register API 要求）。
 * schema: object-rooted JSON Schema（assertSupportedJsonSchema 校验）。
 * render: (args, value) => ContentBlock[]，纯投影到模型可见内容块数组。
 * presentationMeta: 可选，附加呈现元数据（JsonValue）。
 */
export interface ToolOutput {
  schema: Record<string, unknown>;
  /** 必须返回内容块数组（不是字符串）—— 见 TextContentBlock 的宿主证据注释。 */
  render: (args: Record<string, unknown>, value: unknown) => TextContentBlock[];
  presentationMeta?: (args: Record<string, unknown>, value: unknown) => unknown;
}

export interface ToolRegistration {
  name: string;
  description: string;
  /**
   * 模型面输入 schema（DSH 工具契约字段名是 `parameters`，不是 inputSchema）。
   *
   * 宿主证据（app.asar dsh-host-tools ToolRuntime）：
   * - `register(definition)` 注册时**只**校验 `output`，`parameters` 原样保留；
   * - 会话发起时 `wireSchemas → schemaOf(definition)` 解构 `{name,description,parameters,…}`
   *   并 `snapshotJsonValue(parameters)` —— undefined 直接抛
   *   `tool "<name>" parameters must be lossless JSON before schema projection`，
   *   **整个对话立即失败**（P0-TOOLS-FIELDS：曾用 `inputSchema` 字段名，注册成功但
   *   每次对话报 lossless JSON 错误，12 个工具全部如此）。
   * - 值为标准 function-calling JSON Schema：`{type:'object', properties:{…}, required?:[…]}`。
   */
  parameters: Record<string, unknown>;
  /**
   * 工具体（DSH 契约字段名是 `execute`，不是 handler）。
   * 宿主 `dispatchToolBody` 调 `tool.execute(exec.arguments, exec)` ——
   * 第二个参数是执行上下文（signal/deferContext 等），本插件工具只取 args 故忽略。
   */
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** DSH tools.register 必需：输出声明（schema + render）。 */
  output: ToolOutput;
  /** M10-d: pending 状态呈现（DSH UI 工具卡片标题/图标）。 */
  presentCall?: (args: Record<string, unknown>) => ToolCallView | undefined;
  /** M10-d: completed 状态呈现（DSH UI 工具结果卡片）。 */
  presentResult?: (args: Record<string, unknown>, result: Record<string, unknown>) => ToolResultView | undefined;
}

/**
 * 构造通用工具输出声明：object-rooted schema + JSON 文本块渲染。
 * 所有 ANIC 工具返回 JSON 对象，统一用此工厂避免 12 处重复。
 * render 包一个 text 块（ContentBlock[] 契约见 TextContentBlock 注释）。
 */
export function makeToolOutput(): ToolOutput {
  return {
    schema: { type: 'object' },
    // JSON.stringify(undefined) 返回 undefined（非字符串）——值缺失时兜底为 null，
    // 保证 text 字段永远是 string（TextContentBlock 契约）。
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value === undefined ? null : value, null, 2) }],
  };
}

export interface ToolsSlot {
  register?: (tool: ToolRegistration) => (() => void) | null | undefined;
}

/**
 * 包装 async execute 添加错误兜底（P1-4：11 个 async execute 无 try/catch）。
 * 若 execute 抛异常，返回 { error: message } 而非未处理 Promise 拒绝。
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
