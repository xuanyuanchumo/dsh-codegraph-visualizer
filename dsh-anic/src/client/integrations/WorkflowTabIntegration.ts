/**
 * conversation.view 顶层标签注册（M0-① spike 切片，ANIC 插件的第一张脸）。
 *
 * 席位契约逐行核验自 `@deepseek-ai/dsh-client-ui-conversation`
 * （见 docs/anic/07 §2.2）：`conversation.view` 为 `kind: 'list'` 型 —— 可叠加，
 * 多个注册项并排成多个标签，不顶掉既有「对话/轨迹/代码图谱」。该席位由
 * conversation.session **声明**，只在会话面板挂载时存在 —— 因此注册必须走
 * `ctx.slots.inject('conversation.view', cb)`，回调在声明就绪后才执行
 * （本插件的宿主兄弟 dsh-codegraph-visualizer 的 ConversationViewIntegration 即此形态）。
 *
 * 验证目标（docs/anic 01 §8 ①）：
 *   a. 标签可见、可交互；
 *   b. 76-cycle 量级数据渲染（138 节点 / 164 边，真实 .cycles/）；
 *   c. dispose 干净（unregister → 标签消失 → reregister 可重进，无重复 id 死锁）。
 *
 * 纪律：
 *   - 注册 disposer 暴露在 `window.__ANIC_TAB_SPIKE__`，供 J0 验证手动驱动；
 *   - kill-switch：localStorage['anic-workflow-tab'] === 'off' 时零行为；
 *   - ctx 窄化按调用点判定（不做 apply() 快照门控）：slots 缺失时 skipped 而非静默失败；
 *   - anic/ 是独立工程：不 import 宿主项目源码，类型自持。
 */
import { createElement, type ReactElement } from 'react';
import { WorkflowGraphPanel } from '../WorkflowGraphPanel.ts';
import { WORKFLOW_SNAPSHOT } from '../workflowGraphData.ts';
import { PREFS_KEY, disabledFlowIds, parseRawPrefs, resolveFlows } from '../../shared/flows.ts';

const TAB_ID = 'anic-workflow-tab';
const KILL_SWITCH_KEY = 'anic-workflow-tab';

interface SlotDefinition {
  name: string;
  id: string;
  order: number;
  label: () => string;
}

interface SlotsApi {
  inject(slot: string, cb: () => void): (() => void) | void;
  register(definition: SlotDefinition, render: () => ReactElement): (() => void) | void;
}

interface AnicTabTelemetry {
  registered: boolean;
  registerCount: number;
  unregisterCount: number;
  nodes: number;
  edges: number;
  autonomy: string;
  error: string | null;
  skipped: string | null;
  /** INV-30：当前关闭中的 flow（开关体系观测面） */
  disabledFlows: string[];
  /** 开关体系 fail-safe 告警（未知键/非法值/prefs 解析失败），响亮不静默 */
  warnings: string[];
  lastTabDef: { name: string; id: string; order: number } | null;
  unregister: () => void;
  reregister: () => void;
}

declare global {
  interface Window {
    __ANIC_TAB_SPIKE__?: AnicTabTelemetry;
  }
}

function killSwitchEngaged(): boolean {
  try {
    return window.localStorage.getItem(KILL_SWITCH_KEY) === 'off';
  } catch {
    return false; // storage 不可用时不启用开关（保持默认注册路径）
  }
}

/** prefs 原文读取（shared/flows 只做纯解析，存储访问留在 client 层） */
function readPrefsRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFS_KEY);
  } catch {
    return null; // storage 不可用 = 无用户层偏好，走默认值
  }
}

function hasSlotsApi(value: unknown): value is SlotsApi {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SlotsApi>;
  return typeof candidate.inject === 'function' && typeof candidate.register === 'function';
}

export function integrateWorkflowTab(ctx: unknown): void {
  const telemetry: AnicTabTelemetry = {
    registered: false,
    registerCount: 0,
    unregisterCount: 0,
    nodes: 0,
    edges: 0,
    autonomy: '',
    error: null,
    skipped: null,
    disabledFlows: [],
    warnings: [],
    lastTabDef: null,
    unregister: () => {},
    reregister: () => {},
  };
  window.__ANIC_TAB_SPIKE__ = telemetry;
  // 遥测携带真实渲染的数据面（快照即渲染源）
  telemetry.nodes = WORKFLOW_SNAPSHOT.counts.nodes;
  telemetry.edges = WORKFLOW_SNAPSHOT.counts.edges;
  telemetry.autonomy = WORKFLOW_SNAPSHOT.autonomy;

  if (killSwitchEngaged()) {
    telemetry.skipped = 'flag-off';
    return;
  }

  // F 开关体系（docs/anic/13 §2）：M1 只有 user 层（prefs）；workspace/deployment 在 M2-a 接入。
  // 顺序纪律：legacy kill-switch（flag-off）在前 —— J0 探针断言依赖该语义，不得交换。
  const prefsParsed = parseRawPrefs(readPrefsRaw());
  const resolved = resolveFlows({ user: prefsParsed.prefs.flows });
  telemetry.warnings = [...prefsParsed.warnings, ...resolved.warnings];
  telemetry.disabledFlows = disabledFlowIds(resolved);
  if (resolved.flows['flow.workflowTab'] && !resolved.flows['flow.workflowTab'].enabled) {
    telemetry.skipped = 'flow-disabled';
    return;
  }

  if (!hasSlotsApi((ctx as { slots?: unknown })?.slots)) {
    telemetry.skipped = 'slots-absent';
    return;
  }
  const api = (ctx as { slots: unknown }).slots as SlotsApi;

  let registrationDisposer: (() => void) | null = null;

  const doRegister = (): void => {
    if (telemetry.registered) return;
    try {
      const definition: SlotDefinition = {
        name: 'conversation.view',
        id: TAB_ID,
        order: 101,
        label: () => 'ANIC',
      };
      const registration = api.register(definition, () => createElement(WorkflowGraphPanel));
      telemetry.lastTabDef = { name: definition.name, id: definition.id, order: definition.order };
      telemetry.registerCount += 1;
      telemetry.registered = true;
      if (typeof registration === 'function') registrationDisposer = registration;
    } catch (e) {
      // 重复 id 抛错语义的直接证据通道（重复注册会落到这里而不是静默覆盖）
      telemetry.error = e instanceof Error ? e.message : String(e);
    }
  };

  telemetry.unregister = (): void => {
    if (registrationDisposer === null) return;
    registrationDisposer();
    registrationDisposer = null;
    telemetry.registered = false;
    telemetry.unregisterCount += 1;
  };
  telemetry.reregister = (): void => {
    if (!telemetry.registered) doRegister();
  };

  // 注册时机：conversation.view 席位由 conversation.session 声明，
  // inject 回调在声明就绪后执行 —— 不自建重试（与宿主兄弟插件同形态）。
  try {
    const injectDisposer = api.inject('conversation.view', () => {
      doRegister();
    });
    void injectDisposer; // inject 级清理随插件 fiber 卸载（宿主 effect），spike 不另持
  } catch (e) {
    telemetry.error = e instanceof Error ? e.message : String(e);
  }
}
