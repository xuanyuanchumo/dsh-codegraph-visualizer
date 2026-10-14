/**
 * 诊断分区渲染（纯函数，L5）：GET /anic/api/self-check 的 JSON。
 * 展示六项 Runtime INV Probes 结果；失败项红、通过项绿，404（宿主无路由）时
 * 由面板层显示"诊断不可用"——本函数只处理拿到数据的情况。
 */
import { createElement, type ReactElement } from 'react';

export interface ProbeJson {
  id: string;
  inv?: string;
  ok: boolean;
  detail: string;
}

export interface SelfCheckJson {
  checks: ProbeJson[];
  allOk: boolean;
  requestId: string;
}

export function renderDiagnostics(check: SelfCheckJson): ReactElement {
  const rows = check.checks.map((p) =>
    createElement(
      'div',
      { key: p.id, 'data-anic-probe': p.id, style: { display: 'flex', gap: 8, fontSize: 11, padding: '2px 4px', alignItems: 'baseline' } },
      createElement('span', { style: { color: p.ok ? '#16a34a' : '#dc2626', fontWeight: 600 } }, p.ok ? 'PASS' : 'FAIL'),
      createElement('span', { style: { color: '#334155', minWidth: 210 } }, p.inv ? `${p.id} (${p.inv})` : p.id),
      createElement('span', { style: { color: '#64748b' } }, p.detail),
    ),
  );
  return createElement(
    'div',
    { 'data-anic-diagnostics': 'section', style: { padding: '8px 10px', borderTop: '1px solid #e2e8f0' } },
    createElement('div', { style: { fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 } },
      `运行时自检（Runtime INV Probes）· ${check.allOk ? '全部通过' : '存在失败'}`),
    ...rows,
    createElement('div', { style: { fontSize: 10, color: '#94a3b8', marginTop: 4 } }, `requestId: ${check.requestId}`),
  );
}
