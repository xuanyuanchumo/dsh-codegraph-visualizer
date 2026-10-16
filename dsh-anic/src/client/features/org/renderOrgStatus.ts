/**
 * 组织状态全景（连通性 + 透明性）— React 渲染。
 *
 * 展示：cycle 统计 + 信任分 + 自主级 + 熔断状态 + 带检测 + 流开关。
 *
 * 接口形状对齐 src/host/evolution/orgStatus.ts OrgStatus。
 *
 * P0-ORG-STRING 修因：本模块原先 `return string`（拼 HTML 串），调用点
 * WorkflowGraphPanel 把它当 **React 子节点**传入
 * （`createElement('div', {...}, renderOrgStatus(orgStatus))`）。
 * React 会转义字符串子节点，于是整段 `<section class="anic-org-cycles">…`
 * 以**可见的字面标记文本**渲染出来，org 分区实际上从来没有成为 UI。
 * 转义只发生在"字符串作为文本子节点"这一条路径上，所以任何字符串返回型
 * 渲染器都不可能在 React 下工作（除非走 dangerouslySetInnerHTML）。
 *
 * 修法：改为返回 ReactElement（与 renderDiagnostics / renderStepTrace 同形），
 * 并把 `esc()` 一并删除——React 自身转义文本子节点，手工转义在 React 路径下
 * 是死代码，且它只转义 `&<>` 而不转义引号，一旦将来有人改用
 * `dangerouslySetInnerHTML` 就会变成属性注入面。删掉它同时消除了这个陷阱。
 */
import { createElement, type ReactElement } from 'react';
import { token } from '../../../shared/tokens.ts';

export interface OrgStatusJson {
  cycles: { total: number; latest: string | null; converged: number; failed: number };
  ledger: { entries: number; valid: boolean };
  trust: { scores: Record<string, { score: number; approve: number; total: number }>; recommendedBand: string };
  autonomy: { currentBand: string; breakers: string[]; action: string };
  band: { current: string; trend: string };
  flows: { selfInit: boolean; agentsOrchestration: boolean };
  timestamp: string;
}

/** 信任分阈值 → 语义色（单一来源，避免两处阈值漂移）。 */
function scoreColor(score: number): string {
  return score >= 70 ? token('anic-pass') : score >= 40 ? token('anic-doubt') : token('anic-fail');
}

/** 带状态 → 语义色。 */
function bandColor(band: string): string {
  return band === 'normal' ? token('anic-pass') : band === 'warn' ? token('anic-doubt') : token('anic-fail');
}

const H4 = { fontSize: 11, fontWeight: 600, color: token('anic-text'), margin: '4px 0 2px' } as const;
const P = { fontSize: 11, color: token('anic-text-dim'), margin: '2px 0' } as const;
const UL = { margin: '2px 0', paddingLeft: 18 } as const;

export function renderOrgStatus(status: OrgStatusJson): ReactElement {
  const trustEntries = Object.entries(status.trust.scores);

  const trustSection =
    trustEntries.length > 0
      ? createElement(
          'section',
          { className: 'anic-org-trust' },
          createElement('h4', { style: H4 }, '信任分'),
          createElement(
            'ul',
            { style: UL },
            ...trustEntries.map(([gate, ts]) =>
              createElement(
                'li',
                { key: gate, style: P },
                `${gate}: `,
                createElement('span', { style: { color: scoreColor(ts.score) } }, `${String(ts.score)}%`),
                ` (${String(ts.approve)}/${String(ts.total)})`,
              ),
            ),
          ),
          createElement('p', { style: P }, '推荐自主级: ', createElement('strong', null, status.trust.recommendedBand)),
        )
      : null;

  const breakers =
    status.autonomy.breakers.length > 0
      ? createElement(
          'ul',
          { className: 'anic-breakers', style: UL },
          ...status.autonomy.breakers.map((b) =>
            createElement('li', { key: b, className: 'anic-breaker-tripped', style: P }, `⚠ ${b}`),
          ),
        )
      : createElement('p', { style: P }, '无熔断');

  return createElement(
    'div',
    { 'data-anic-org': 'section', style: { padding: '8px 10px', borderTop: `1px solid ${token('anic-border')}` } },
    createElement(
      'section',
      { className: 'anic-org-cycles' },
      createElement('h4', { style: H4 }, 'Cycle 全景'),
      createElement(
        'p',
        { style: P },
        `共 ${String(status.cycles.total)} 轮 · 最新 ${status.cycles.latest ?? '—'} · 收敛 ${String(status.cycles.converged)} · 失败 ${String(status.cycles.failed)}`,
      ),
    ),
    trustSection,
    createElement(
      'section',
      { className: 'anic-org-autonomy' },
      createElement('h4', { style: H4 }, '自主级'),
      createElement(
        'p',
        { style: P },
        '当前: ',
        createElement('strong', null, status.autonomy.currentBand),
        ` · 动作: ${status.autonomy.action}`,
      ),
      breakers,
    ),
    createElement(
      'section',
      { className: 'anic-org-band' },
      createElement('h4', { style: H4 }, '带检测'),
      createElement(
        'p',
        { style: P },
        '当前: ',
        createElement('span', { style: { color: bandColor(status.band.current) } }, status.band.current),
        ` · 趋势: ${status.band.trend}`,
      ),
    ),
    createElement(
      'section',
      { className: 'anic-org-flows' },
      createElement('h4', { style: H4 }, '流开关'),
      createElement(
        'ul',
        { style: UL },
        createElement('li', { style: P }, `自举: ${status.flows.selfInit ? '✅' : '⏹'}`),
        createElement('li', { style: P }, `多智能体编排: ${status.flows.agentsOrchestration ? '✅' : '⏹'}`),
      ),
    ),
  );
}
