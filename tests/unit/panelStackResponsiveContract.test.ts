/**
 * FBX-05 契约：面板栈（`.cg-panel-stack`）在窄容器下的响应式断点。
 *
 * ## 为什么要源码级解析而不是 DOM 断言
 *
 * 面板堆栈的宽度语义由 `@container graphpanel` 容器查询控制，jsdom 既不解析
 * CSS 也不支持容器查询——任何「渲染后读样式」的断言在这里永远测不到。
 * 与 `panelTierContract.test.ts` 同一取舍：解析 responsive.css 的声明表逐条比对。
 *
 * ## 钉死的契约
 *
 * - CS-1 主机制存在：窄档容器查询块里有面板栈收窄规则；
 * - CS-2 两档声明逐属性等价：紧凑档（768px）里每条栈规则在窄档（480px）里
 *   至少被继承（max-width 不放宽），否则「支持的浏览器正常、更窄的反而溢出」；
 * - CS-3 阈值同源：两档断点值与 `usePanelTier` 的常量一致；
 * - CS-4 反向自检：合成违规样本必须能被本文件自己的解析器读出
 *   （解析器失效时 CS-2 会因「读不到」而假绿——本条证明解析器活着）；
 * - CS-5 非空断言：扫描必须真的读到规则（防静默走空文件全绿）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PANEL_TIER_COMPACT_PX, PANEL_TIER_NARROW_PX,
} from '../../src/client/hooks/usePanelTier.ts';

const css = readFileSync(
  join(process.cwd(), 'src', 'client', 'styles', 'responsive.css'),
  'utf8',
);

/** 从 `header` 起的大括号块（含嵌套）——与 panelTierContract.test.ts 同形。 */
function blockFrom(source: string, header: string, startAt = 0): string {
  const start = source.indexOf(header, startAt);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

/** 找到**包含** `needle` 的那个 header 块（同名 header 可能出现多次）——与 panelTierContract 同形。 */
function blockContaining(source: string, header: string, needle: string): string {
  let from = 0;
  for (;;) {
    const block = blockFrom(source, header, from);
    if (!block) return '';
    if (block.includes(needle)) return block;
    from += header.length;
  }
}

/** 取选择器所在规则的声明表（`selector ... {` → 属性映射）。 */
function declarationsOf(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(selector);
  if (start < 0) return {};
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  if (open < 0 || close < 0) return {};
  const body = source.slice(open + 1, close);
  const declarations: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    const [rawProperty, ...rest] = chunk.split(':');
    const property = rawProperty?.trim() ?? '';
    const value = rest.join(':').trim();
    if (property && value) declarations[property] = value;
  }
  return declarations;
}

/** 两档都必须覆盖的面板栈规则（从 responsive.css 的 FBX-05 块摘取）。 */
const STACK_RULES = [
  '.cg-panel-stack-left .cg-impact-panel',
  '.cg-panel-stack-left .cg-legend-panel',
  '.cg-panel-stack-left .cg-search-bar',
  '.cg-panel-stack-right .cg-analysis-panel',
  '.cg-panel-stack-right .cg-cycle-panel',
];

describe('FBX-05 面板栈窄容器断点', () => {
  it('CS-1 declares the narrow container tier with stack rules inside', () => {
    const block = blockContaining(css, '@container graphpanel (max-width: 480px)', '.cg-panel-stack-left');
    expect(block).not.toBe('');
    expect(block).toContain('.cg-panel-stack-left');
    expect(block).toContain('max-width: calc(100% - 16px)');
  });

  it('CS-2 every stack rule in the compact tier is inherited by the narrow tier', () => {
    const narrow = blockContaining(css, '@container graphpanel (max-width: 480px)', '.cg-panel-stack-left');
    const compact = blockContaining(css, '@container graphpanel (max-width: 768px)', '.cg-panel-stack-right');
    expect(compact).not.toBe('');
    for (const sel of STACK_RULES) {
      const c = declarationsOf(compact, sel);
      expect(Object.keys(c).length, `selector ${sel} missing in compact tier`).toBeGreaterThan(0);
      const n = declarationsOf(narrow, sel);
      for (const [prop, value] of Object.entries(c)) {
        if (prop === 'max-width') {
          // 两档都用 `calc(100% - 16px)` 同一表达式——直接字符串等值，
          // 不做数值比较（parseFloat 对 calc() 返回 NaN，是无意义的断言）。
          expect(n[prop], `selector ${sel} lost ${prop} in narrow tier`).toBe(value);
        } else {
          expect(n[prop], `selector ${sel} drifted on ${prop}`).toBe(value);
        }
      }
    }
  });

  it('CS-3 breakpoints come from the same constants as the JS panel tiers', () => {
    expect(css).toContain(`@container graphpanel (max-width: ${String(PANEL_TIER_NARROW_PX)}px)`);
    expect(css).toContain(`@container graphpanel (max-width: ${String(PANEL_TIER_COMPACT_PX)}px)`);
  });

  it('CS-4 reverse self-check: the parser reads a synthetic violation', () => {
    const fake = '@container graphpanel (max-width: 480px) { .cg-panel-stack-left .cg-impact-panel { width: 160px; } }';
    const decl = declarationsOf(fake, '.cg-panel-stack-left .cg-impact-panel');
    expect(decl['width']).toBe('160px');
    expect(decl['max-width']).toBeUndefined();
  });

  it('CS-5 the scanner really read rules (non-empty walk)', () => {
    let found = 0;
    for (const sel of STACK_RULES) {
      if (declarationsOf(css, sel)['max-width']) found += 1;
    }
    expect(found).toBe(STACK_RULES.length);
  });
});