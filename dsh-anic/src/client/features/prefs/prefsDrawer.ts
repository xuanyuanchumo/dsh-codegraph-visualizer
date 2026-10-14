/**
 * ⚙ 配置抽屉（C1 域，docs/anic/11 §C 的 M1 客户端切片）。
 *
 * 三层开关的用户层落点：读/写**用户层**（localStorage PREFS_KEY，client 集成层
 * 负责——shared/flows.ts 不接触 DOM）。工作区层（config.yml anic 段）与部署层
 * （bundle config）由宿主经 resolveFlows 合并；抽屉展示合并后的生效值与来源层
 * （INV-30：全部开关状态可观测）。开关 hover 显示关闭形态契约（degradation）。
 */
import { createElement, type ReactElement } from 'react';
import { FLOWS, PREFS_KEY, parseRawPrefs, resolveFlows, type FlowLayer } from '../../../shared/flows.ts';

export interface FlowOverrideInput {
  /** 工作区层（host/config.ts 的 anic 段解析结果，键 = 'flow.xxx'） */
  workspace?: Record<string, unknown>;
  /** 部署层（bundle config 注入，M2-a 槽位；M1 常为空） */
  deployment?: Record<string, unknown>;
}

function readUserPrefsRaw(): Record<string, unknown> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    return parseRawPrefs(raw).prefs.flows;
  } catch {
    return {};
  }
}

/** 用户层读取（面板/集成分区门控共用；storage 不可用 = 无偏好，走默认）。 */
export function readPrefsRaw(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
  } catch {
    return null;
  }
}

/** 用户层写入（客户端唯一写入口；读取端 parseRawPrefs fail-safe 兜底）。 */
export function writeUserPrefs(flows: Record<string, boolean>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ version: 1, flows }));
  } catch { /* 隐私模式写失败：下次读取回默认（诚实降级，不报错打扰） */ }
}

const SOURCE_LABEL: Record<FlowLayer, string> = { user: '用户', workspace: '工作区', deployment: '部署' };

/** 纯渲染 + 回调：抽屉（smoke 可断言 data-anic-prefs 抽屉结构）。 */
export function renderPrefsDrawer(input: FlowOverrideInput, onChange: (flows: Record<string, boolean>) => void): ReactElement {
  const user = readUserPrefsRaw();
  const resolved = resolveFlows({ user, workspace: input.workspace, deployment: input.deployment });

  const rows = FLOWS.map((f) => {
    const state = resolved.flows[f.id] ?? { enabled: true, source: null as FlowLayer | null };
    const sourceLabel = state.source ? SOURCE_LABEL[state.source] : '默认';
    return createElement(
      'label',
      { key: f.id, 'data-anic-flow-row': f.id, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '3px 0', cursor: 'pointer' }, title: f.degradation },
      createElement('input', {
        type: 'checkbox',
        'data-anic-flow-toggle': f.id,
        checked: state.enabled,
        onChange: () => {
          const next: Record<string, boolean> = { ...user, [f.id]: !state.enabled } as Record<string, boolean>;
          writeUserPrefs(next);
          onChange(next);
        },
      }),
      createElement('span', { style: { flex: 1, color: '#334155' } }, f.label),
      createElement('span', { style: { fontSize: 10, color: '#94a3b8' } }, `${sourceLabel}层 · ${f.layers.join('/')}`),
    );
  });

  return createElement(
    'div',
    { 'data-anic-prefs': 'drawer', style: { padding: '8px 10px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' } },
    createElement('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#334155' } }, '功能开关（三层：用户 > 工作区 > 部署）'),
    ...rows,
    resolved.warnings.length > 0
      ? createElement('div', { 'data-anic-flow-warnings': 'true', style: { fontSize: 10, color: '#b45309', marginTop: 6 } },
          `开关告警 ${String(resolved.warnings.length)} 条（未知键/非法值已忽略，详见遥测）`)
      : null,
    createElement('div', { style: { fontSize: 10, color: '#94a3b8', marginTop: 6 } },
      'M1 仅用户层可写；工作区层请编辑 .cycles/config.yml 的 anic 段（唯一规范入口）。'),
  );
}
