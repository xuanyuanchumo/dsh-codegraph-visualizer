/**
 * 组织状态分区渲染契约（P0-ORG-STRING 回归）。
 *
 * 契约来源：`dsh-anic/src/client/features/org/renderOrgStatus.ts` 的导出签名
 * 与调用点 `dsh-anic/src/client/WorkflowGraphPanel.ts` 的
 * `createElement('div', {…}, renderOrgStatus(orgStatus))`。
 *
 * 原缺陷：renderOrgStatus 返回 HTML **字符串**，却被当作 React 子节点传入。
 * React 转义字符串子节点 ⇒ 整段 `<section class="anic-org-cycles">…`
 * 以**可见的字面标记文本**渲染，org 分区从未成为 UI。
 *
 * 本文件用 react-dom/server 真实渲染（而不是断言"函数返回了元素"），
 * 因为"返回类型对了"和"渲染出来是对的"是两件事：
 * 一个返回 ReactElement 但内部又塞了 HTML 串的实现同样会漏过去。
 */
import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderOrgStatus, type OrgStatusJson } from '../../src/client/features/org/renderOrgStatus.ts';

/** 逐字段转录 src/host/evolution/orgStatus.ts OrgStatus 的响应形状。 */
const STATUS: OrgStatusJson = {
  cycles: { total: 78, latest: 'cycle-78', converged: 74, failed: 4 },
  ledger: { entries: 63, valid: true },
  trust: { scores: { G0: { score: 92, approve: 23, total: 25 }, G2: { score: 48, approve: 12, total: 25 } }, recommendedBand: 'L3' },
  autonomy: { currentBand: 'L3', breakers: ['cost-budget'], action: 'allow-with-review' },
  band: { current: 'warn', trend: 'improving' },
  flows: { selfInit: true, agentsOrchestration: false },
  timestamp: '2026-10-05T00:00:00.000Z',
};

describe('renderOrgStatus (P0-ORG-STRING)', () => {
  it('returns a React element, not an HTML string', () => {
    const out = renderOrgStatus(STATUS);
    // 反向自检的锚点：字符串实现会让 isValidElement 为 false
    expect(typeof out).not.toBe('string');
    expect(isValidElement(out)).toBe(true);
  });

  it('renders real markup, NOT escaped literal tags', () => {
    const html = renderToStaticMarkup(renderOrgStatus(STATUS));
    // 正向：真的是元素树
    expect(html).toContain('<section class="anic-org-cycles">');
    expect(html).toContain('<section class="anic-org-autonomy">');
    expect(html).toContain('<section class="anic-org-band">');
    // 反向：原缺陷的可见症状——被转义的字面标记文本
    expect(html).not.toContain('&lt;section');
    expect(html).not.toContain('&lt;h4');
    expect(html).not.toContain('&lt;/');
  });

  it('carries every data field through to the rendered output', () => {
    const html = renderToStaticMarkup(renderOrgStatus(STATUS));
    expect(html).toContain('78'); // cycles.total
    expect(html).toContain('cycle-78'); // cycles.latest
    expect(html).toContain('74'); // converged
    expect(html).toContain('92%'); // G0 trust score
    expect(html).toContain('(23/25)');
    expect(html).toContain('L3'); // recommendedBand
    expect(html).toContain('allow-with-review');
    expect(html).toContain('warn'); // band.current
    expect(html).toContain('improving');
    expect(html).toContain('cost-budget'); // breaker
    expect(html).toContain('anic-breaker-tripped');
  });

  it('shows the empty-breakers branch instead of an empty list', () => {
    const html = renderToStaticMarkup(renderOrgStatus({ ...STATUS, autonomy: { ...STATUS.autonomy, breakers: [] } }));
    expect(html).toContain('无熔断');
    expect(html).not.toContain('anic-breakers');
  });

  it('omits the trust section entirely when no scores exist', () => {
    const html = renderToStaticMarkup(renderOrgStatus({ ...STATUS, trust: { scores: {}, recommendedBand: 'L1' } }));
    expect(html).not.toContain('anic-org-trust');
    // 空分区不得留下孤立标题（"渲染标题再过滤内容"会留一个空 h4）
    expect(html).not.toContain('信任分');
  });

  it('tolerates a null latest cycle without printing "null"', () => {
    const html = renderToStaticMarkup(renderOrgStatus({ ...STATUS, cycles: { ...STATUS.cycles, latest: null } }));
    expect(html).toContain('—');
    expect(html).not.toContain('null');
  });

  it('renders text content escaped by React, so no injection surface remains', () => {
    const html = renderToStaticMarkup(
      renderOrgStatus({ ...STATUS, trust: { scores: { '<img src=x onerror=alert(1)>': { score: 10, approve: 1, total: 1 } }, recommendedBand: 'L1' } }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('every colour comes from a token with a same-source fallback', () => {
    const html = renderToStaticMarkup(renderOrgStatus(STATUS));
    // 语义令牌必须带 fallback：裸 var(--anic-pass) 在宿主未注入时计算为无效值
    const vars = html.match(/var\(--anic-[a-z-]+[^)]*\)/g) ?? [];
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) {
      expect(v).toMatch(/^var\(--anic-[a-z-]+, #[0-9a-f]{6}\)$/);
    }
  });
});
