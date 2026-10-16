/**
 * 诊断分区渲染（纯函数，L5）：GET /anic/api/self-check 的 JSON。
 * 展示六项 Runtime INV Probes 结果；失败项红、通过项绿，404（宿主无路由）时
 * 由面板层显示"诊断不可用"——本函数只处理拿到数据的情况。
 */
import { createElement, type ReactElement } from 'react';
import { token } from '../../../shared/tokens.ts';

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
      createElement('span', { style: { color: p.ok ? token('anic-ok-text') : token('anic-bad-text'), fontWeight: 600 } }, p.ok ? 'PASS' : 'FAIL'),
      createElement('span', { style: { color: token('anic-text'), minWidth: 210 } }, p.inv ? `${p.id} (${p.inv})` : p.id),
      createElement('span', { style: { color: token('anic-text-dim') } }, p.detail),
    ),
  );
  return createElement(
    'div',
    { 'data-anic-diagnostics': 'section', style: { padding: '8px 10px', borderTop: `1px solid ${token('anic-border')}` } },
    createElement('div', { style: { fontSize: 12, fontWeight: 600, color: token('anic-text'), marginBottom: 4 } },
      `运行时自检（Runtime INV Probes）· ${check.allOk ? '全部通过' : '存在失败'}`),
    ...rows,
    createElement('div', { style: { fontSize: 10, color: token('anic-text-faint'), marginTop: 4 } }, `requestId: ${check.requestId}`),
  );
}
