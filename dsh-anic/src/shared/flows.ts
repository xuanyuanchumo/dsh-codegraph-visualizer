/**
 * ANIC 功能开关注册表与三层合并（docs/anic/13 §2 的 M1 落地切片）。
 *
 * 单实现原则（12 §3.1）：开关语义只有这一份实现，client / host / tests 共用。
 * - FLOWS 是唯一开关清单（9 个 flow，见 13 §2.2）；核心链路（标签壳之外的数据
 *   路由与只读工具）**不在清单里** —— 任何试图以 `flow.*` 关闭核心链路的键都会
 *   落入 unknown 分支被拒绝并告警（INV-29 的实现形态）。
 * - 三层优先级：user > workspace > deployment（越具体越优先，13 §2.1）。
 * - 非法值 fail-safe 回默认并产出 warning（响亮，不静默；13 §2.1）。
 * - 本模块不接触 window/localStorage —— 存储读取在 client 集成层完成，
 *   shared 只做纯解析与合并（可被 host/tests 复用，且不进宿主 bundle 的 DOM 假设）。
 */

export const PREFS_KEY = 'dsh-anic.prefs.v1';

export type FlowLayer = 'user' | 'workspace' | 'deployment';

export interface FlowDefinition {
  /** 全量 id，形如 'flow.workflowTab'（与 docs/anic/13 §2.2 表一致） */
  id: string;
  label: string;
  /** 该开关支持哪几层配置（M1 只启用 user 层；workspace/deployment 在 M2-a 接入） */
  layers: readonly FlowLayer[];
  /** 关闭形态契约（degradation contract）：关闭后系统处于什么状态 */
  degradation: string;
}

export interface FlowState {
  enabled: boolean;
  /** 生效值来源层；null = 默认值（未配置） */
  source: FlowLayer | null;
}

export interface ResolvedFlows {
  flows: Record<string, FlowState>;
  warnings: string[];
}

export interface PrefsFile {
  version: 1;
  flows: Record<string, boolean>;
}

/** 9 个 flow 开关（与 docs/anic/13 §2.2 逐行对应，新增开关必须同时更新该表） */
export const FLOWS: readonly FlowDefinition[] = [
  { id: 'flow.workflowTab', label: 'ANIC 可视化标签', layers: ['user', 'workspace', 'deployment'], degradation: 'unregister 槽位（既有 disposer 路径）；宿主路由/工具照常' },
  { id: 'flow.stepTrace', label: '白盒流程分区', layers: ['user', 'workspace', 'deployment'], degradation: '分区隐藏，其余分区/数据不受影响' },
  { id: 'flow.diagnostics', label: '诊断面板', layers: ['user', 'workspace', 'deployment'], degradation: '面板不注册；遥测仍在内存环形缓冲（不丢证据）' },
  { id: 'flow.approvals', label: '批准卡/HITL 队列', layers: ['user', 'workspace', 'deployment'], degradation: '队列只读展示 + 指引改走技能 CLI（自主级自动降 L2）' },
  { id: 'flow.autoRefresh', label: 'live 轮询/刷新', layers: ['user', 'workspace', 'deployment'], degradation: '回退手动刷新按钮（条件请求语义仍在）' },
  { id: 'flow.gateRecord', label: '门禁结果自动入账本', layers: ['workspace', 'deployment'], degradation: '不自动记账，UI 显式标注「未入账本」（诚实降级）' },
  { id: 'flow.budgetEnforce', label: '预算熔断', layers: ['workspace', 'deployment'], degradation: '降级为只告警不熔断（显示风险横幅）' },
  { id: 'flow.selfInit', label: '自举命令', layers: ['workspace', 'deployment'], degradation: '命令返回响亮禁用提示' },
  { id: 'flow.agentsOrchestration', label: '子代理编排流', layers: ['workspace', 'deployment'], degradation: '编排配方标记停用；工具面照常（手动编排不受影响）' },
];

export const FLOW_IDS: readonly string[] = FLOWS.map((f) => f.id);

function isFlowLayer(value: unknown): value is FlowLayer {
  return value === 'user' || value === 'workspace' || value === 'deployment';
}

/** 未知/非法键的统一告警文案（INV-29：核心链路不可关的解释就写在这里） */
function unknownSwitchWarning(id: string, layer: FlowLayer): string {
  return `unknown flow switch '${id}' at ${layer} layer (ignored) — core chain (snapshot route / readonly tools) is NOT switchable, see docs/anic/13 §2.3`;
}

/**
 * 三层合并：user > workspace > deployment > 默认(true)。
 * 任何层的未知键/非法值都进 warnings，不抛错（开关体系自身的 fail-safe）。
 */
export function resolveFlows(layers: {
  user?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  deployment?: Record<string, unknown>;
}): ResolvedFlows {
  const warnings: string[] = [];
  const flows: Record<string, FlowState> = {};
  for (const def of FLOWS) flows[def.id] = { enabled: true, source: null };

  const ordered: ReadonlyArray<readonly [FlowLayer, Record<string, unknown> | undefined]> = [
    ['deployment', layers.deployment],
    ['workspace', layers.workspace],
    ['user', layers.user],
  ];
  for (const [layer, bucket] of ordered) {
    if (!bucket) continue;
    for (const [id, value] of Object.entries(bucket)) {
      if (!(id in flows)) {
        warnings.push(unknownSwitchWarning(id, layer));
        continue;
      }
      if (typeof value !== 'boolean') {
        warnings.push(`non-boolean value for '${id}' at ${layer} layer (ignored, default kept)`);
        continue;
      }
      flows[id] = { enabled: value, source: layer };
    }
  }
  return { flows, warnings };
}

/** 关闭中的 flow id 列表（INV-30 观测面的数据源） */
export function disabledFlowIds(resolved: ResolvedFlows): string[] {
  return Object.keys(resolved.flows).filter((id) => {
    const state = resolved.flows[id];
    return state ? !state.enabled : false;
  });
}

/**
 * prefs 原文解析（client 层从 localStorage 读到的字符串）。
 * 任何解析失败/版本不符/形状非法 → fail-safe 回默认空偏好 + warning（响亮）。
 */
export function parseRawPrefs(raw: string | null | undefined): { prefs: PrefsFile; warnings: string[] } {
  const fallback: PrefsFile = { version: 1, flows: {} };
  if (raw === null || raw === undefined || raw === '') return { prefs: fallback, warnings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { prefs: fallback, warnings: ['prefs: unparseable JSON — reset to defaults'] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { prefs: fallback, warnings: ['prefs: not an object — reset to defaults'] };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    return { prefs: fallback, warnings: [`prefs: unsupported version ${String(obj.version)} — reset to defaults`] };
  }
  if (!obj.flows || typeof obj.flows !== 'object') {
    return { prefs: fallback, warnings: ['prefs: missing flows object — reset to defaults'] };
  }
  return { prefs: { version: 1, flows: obj.flows as Record<string, boolean> }, warnings: [] };
}
