/**
 * 渲染组织状态全景（连通性+透明性增强）。
 * 展示：cycle 列表 + 信任分 + 自主级 + 熔断状态 + 带检测 + 流开关。
 */

export interface OrgStatusJson {
  cycles?: Array<{ name: string; gateCount: number; passCount: number; failCount: number }>;
  ledger?: { total: number; verified: boolean; brokenAt?: number };
  trust?: Record<string, number>;
  autonomy?: { band: string; breakers: Array<{ id: string; tripped: boolean }> };
  band?: { current: string; trend: string };
  flows?: Array<{ id: string; enabled: boolean; layer: string }>;
  warnings?: string[];
}

export function renderOrgStatus(status: OrgStatusJson): string {
  const parts: string[] = [];

  // Cycle 全景
  if (status.cycles && status.cycles.length > 0) {
    parts.push('<section class="anic-org-cycles">');
    parts.push('<h4>Cycle 全景</h4>');
    parts.push('<table class="anic-cycle-table">');
    parts.push('<thead><tr><th>Cycle</th><th>门禁</th><th>PASS</th><th>FAIL</th></tr></thead><tbody>');
    for (const c of status.cycles) {
      parts.push(`<tr><td>${esc(c.name)}</td><td>${c.gateCount}</td><td style="color:var(--anic-pass,#2d8a3e)">${c.passCount}</td><td style="color:var(--anic-fail,#c0392b)">${c.failCount}</td></tr>`);
    }
    parts.push('</tbody></table></section>');
  }

  // 信任分
  if (status.trust) {
    const entries = Object.entries(status.trust);
    if (entries.length > 0) {
      parts.push('<section class="anic-org-trust"><h4>信任分</h4><ul>');
      for (const [gate, score] of entries) {
        const color = score >= 70 ? 'var(--anic-pass,#2d8a3e)' : score >= 40 ? 'var(--anic-doubt,#e6a700)' : 'var(--anic-fail,#c0392b)';
        parts.push(`<li>${esc(gate)}: <span style="color:${color}">${score}%</span></li>`);
      }
      parts.push('</ul></section>');
    }
  }

  // 自主级 + 熔断
  if (status.autonomy) {
    parts.push('<section class="anic-org-autonomy"><h4>自主级</h4>');
    parts.push(`<p>当前: <strong>${esc(status.autonomy.band)}</strong></p>`);
    const tripped = status.autonomy.breakers.filter((b) => b.tripped);
    if (tripped.length > 0) {
      parts.push('<ul class="anic-breakers">');
      for (const b of tripped) {
        parts.push(`<li class="anic-breaker-tripped">⚠ ${esc(b.id)}</li>`);
      }
      parts.push('</ul>');
    } else {
      parts.push('<p>无熔断</p>');
    }
    parts.push('</section>');
  }

  // 带检测
  if (status.band) {
    const bandColor = status.band.current === 'normal' ? 'var(--anic-pass,#2d8a3e)' : status.band.current === 'warn' ? 'var(--anic-doubt,#e6a700)' : 'var(--anic-fail,#c0392b)';
    parts.push(`<section class="anic-org-band"><h4>带检测</h4><p>当前: <span style="color:${bandColor}">${esc(status.band.current)}</span> · 趋势: ${esc(status.band.trend)}</p></section>`);
  }

  // 警告
  if (status.warnings && status.warnings.length > 0) {
    parts.push('<section class="anic-org-warnings"><h4>⚠ 警告</h4><ul>');
    for (const w of status.warnings) {
      parts.push(`<li>${esc(w)}</li>`);
    }
    parts.push('</ul></section>');
  }

  return parts.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
