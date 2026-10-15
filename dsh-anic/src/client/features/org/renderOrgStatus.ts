/**
 * 渲染组织状态全景（连通性+透明性增强）。
 * 展示：cycle 统计 + 信任分 + 自主级 + 熔断状态 + 带检测 + 流开关。
 *
 * 接口形状对齐 src/host/evolution/orgStatus.ts OrgStatus（P0 修复：
 * 原 OrgStatusJson 字段名与实际 API 响应完全不匹配 → esc(undefined) 崩溃）。
 */

export interface OrgStatusJson {
  cycles: { total: number; latest: string | null; converged: number; failed: number };
  ledger: { entries: number; valid: boolean };
  trust: { scores: Record<string, { score: number; approve: number; total: number }>; recommendedBand: string };
  autonomy: { currentBand: string; breakers: string[]; action: string };
  band: { current: string; trend: string };
  flows: { selfInit: boolean; agentsOrchestration: boolean };
  timestamp: string;
}

export function renderOrgStatus(status: OrgStatusJson): string {
  const parts: string[] = [];

  // Cycle 全景
  parts.push('<section class="anic-org-cycles">');
  parts.push('<h4>Cycle 全景</h4>');
  parts.push(`<p>共 <strong>${status.cycles.total}</strong> 轮 · 最新 <strong>${esc(status.cycles.latest ?? '—')}</strong> · 收敛 ${status.cycles.converged} · 失败 ${status.cycles.failed}</p>`);
  parts.push('</section>');

  // 信任分
  const trustEntries = Object.entries(status.trust.scores);
  if (trustEntries.length > 0) {
    parts.push('<section class="anic-org-trust"><h4>信任分</h4><ul>');
    for (const [gate, ts] of trustEntries) {
      const color = ts.score >= 70 ? 'var(--anic-pass,#2d8a3e)' : ts.score >= 40 ? 'var(--anic-doubt,#e6a700)' : 'var(--anic-fail,#c0392b)';
      parts.push(`<li>${esc(gate)}: <span style="color:${color}">${ts.score}%</span> (${ts.approve}/${ts.total})</li>`);
    }
    parts.push(`</ul><p>推荐自主级: <strong>${esc(status.trust.recommendedBand)}</strong></p></section>`);
  }

  // 自主级 + 熔断
  parts.push('<section class="anic-org-autonomy"><h4>自主级</h4>');
  parts.push(`<p>当前: <strong>${esc(status.autonomy.currentBand)}</strong> · 动作: ${esc(status.autonomy.action)}</p>`);
  if (status.autonomy.breakers.length > 0) {
    parts.push('<ul class="anic-breakers">');
    for (const b of status.autonomy.breakers) {
      parts.push(`<li class="anic-breaker-tripped">⚠ ${esc(b)}</li>`);
    }
    parts.push('</ul>');
  } else {
    parts.push('<p>无熔断</p>');
  }
  parts.push('</section>');

  // 带检测
  const bandColor = status.band.current === 'normal' ? 'var(--anic-pass,#2d8a3e)' : status.band.current === 'warn' ? 'var(--anic-doubt,#e6a700)' : 'var(--anic-fail,#c0392b)';
  parts.push(`<section class="anic-org-band"><h4>带检测</h4><p>当前: <span style="color:${bandColor}">${esc(status.band.current)}</span> · 趋势: ${esc(status.band.trend)}</p></section>`);

  // 流开关
  parts.push('<section class="anic-org-flows"><h4>流开关</h4><ul>');
  parts.push(`<li>自举: ${status.flows.selfInit ? '✅' : '⏹'}</li>`);
  parts.push(`<li>多智能体编排: ${status.flows.agentsOrchestration ? '✅' : '⏹'}</li>`);
  parts.push('</ul></section>');

  return parts.join('\n');
}

/** HTML 转义——防御 undefined/null 返回空串而非崩溃。 */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
