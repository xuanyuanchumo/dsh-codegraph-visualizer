/**
 * The toolbar's responsive behaviour is split across two mechanisms that cannot see each
 * other: JS tiers fed by the *measured* toolbar width (icon-only center triggers, the
 * standalone search button moving into the "more" menu) and CSS `@container graphpanel`
 * tiers (padding, hidden decoration buttons). The breakpoint numbers live in
 * `src/shared/constants.ts`, but nothing in the type system or the bundler connects them
 * to the stylesheets, so a change on one side drifts silently from the other.
 *
 * This test pins them together — the same technique `manifest.test.ts` uses to pin
 * `package.json` against `src/shared/dshGeneration.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI } from '../../src/shared/constants.ts';

function readStyle(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'client', 'styles', name), 'utf8');
}

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return '';
  return css.slice(open + 1, close);
}

/** The whole `{…}` block that follows `header`, with nested blocks included. */
function bracedBlock(css: string, header: string): string {
  const start = css.indexOf(header);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  return '';
}

const responsiveCss = readStyle('responsive.css');
const layoutCss = readStyle('layout.css');

const containerTierWidths = [...responsiveCss.matchAll(/@container graphpanel \(max-width: (\d+)px\)/g)]
  .map((match) => Number(match[1]));

describe('toolbar responsive contract', () => {
  it('hides the separators with a selector that can actually match', () => {
    // Regression: the tier used `.cg-toolbar-group[aria-label]:not(:last-of-type)
    // .cg-toolbar-separator`, but the separators are *siblings* of the groups in the DOM
    // (see ToolbarActions), so the rule silently never matched anything.
    expect(responsiveCss).not.toContain('.cg-toolbar-group[aria-label]:not(:last-of-type) .cg-toolbar-separator');
    const tier = bracedBlock(responsiveCss, '@container graphpanel (max-width: 380px)');
    expect(tier).toMatch(/\.cg-toolbar-separator\s*\{[^}]*display:\s*none/);
  });

  it('orders the JS tiers narrow < compact', () => {
    expect(UI.TOOLBAR_BREAKPOINT_NARROW_PX).toBeLessThan(UI.TOOLBAR_BREAKPOINT_COMPACT_PX);
  });

  it('declares a container tier for every measured toolbar breakpoint', () => {
    // Without a matching @container tier the JS tier adapts to a width the stylesheet
    // still treats as roomy (or the reverse), so the panel looks half-adapted.
    expect(containerTierWidths).toContain(UI.TOOLBAR_BREAKPOINT_COMPACT_PX);
    expect(containerTierWidths).toContain(UI.TOOLBAR_BREAKPOINT_NARROW_PX);
  });

  it('hides the decorative group separators in the compact tier', () => {
    // The JS half sets `.cg-graph-toolbar[data-cg-compact]`; the CSS half must consume it.
    const body = ruleBody(layoutCss, '.cg-graph-toolbar[data-cg-compact] .cg-toolbar-separator');
    expect(body).toMatch(/display:\s*none/);
  });

  it('hides the center group in the 600px tier, where it stops fitting', () => {
    // Measured on the real host: the three icon-only triggers need 150px together. At a
    // 520px panel the group was squeezed to 115px, which wrapped the level trigger onto two
    // lines and clipped it; at 600px it still has 45px of slack. The 380px tier used to own
    // this decision, which was too late to prevent the clipping.
    const tier = bracedBlock(responsiveCss, '@container graphpanel (max-width: 600px)');
    expect(tier).toMatch(/\.cg-toolbar-center\s*\{[^}]*display:\s*none/);
    const fallback = bracedBlock(responsiveCss, '@supports not (container-type: inline-size)');
    expect(bracedBlock(fallback, '@media (max-width: 600px)')).toMatch(/\.cg-toolbar-center\s*\{[^}]*display:\s*none/);
  });

  it('keeps the center-visibility decision in a single tier', () => {
    // Two tiers hiding the same group is how the two halves of this contract drift apart:
    // moving the decision down to 380px silently re-introduced the clipping at 520px.
    const hidingTiers = [...responsiveCss.matchAll(/@container graphpanel \(max-width: (\d+)px\)/g)]
      .map((match) => ({ width: Number(match[1]), block: bracedBlock(responsiveCss, match[0]) }))
      .filter((tier) => /\.cg-toolbar-center\s*\{[^}]*display:\s*none/.test(tier.block));
    expect(hidingTiers.map((tier) => tier.width)).toEqual([600]);
  });

  it('protects the always-needed right group from being squeezed out of the toolbar', () => {
    // Measured on the real host at a 420px panel: without this, the toolbar overflowed by
    // 72px and pushed the export / more / collapse controls out of the visible area.
    expect(ruleBody(layoutCss, '.cg-toolbar-right')).toMatch(/flex-shrink:\s*0/);
    expect(ruleBody(layoutCss, '.cg-toolbar-center')).toMatch(/min-width:\s*0/);
  });

  it('drives the narrow-panel dropdown drawer from measurement, not from a container query', () => {
    // The dropdown content is portaled to document.body (so the toolbar and the panel's
    // `contain: paint` can no longer clip it), which also means it stops being a descendant
    // of `.cg-graph-panel`: any `@container graphpanel` rule for it is dead. Measured on the
    // real host at a 317px panel the drawer rule silently stopped applying. The drawer form
    // now lives on `.cg-portal-drawer`, added by the component after it measures the panel.
    const drawerMatch = /\.cg-portal-drawer\s*\{([^}]*)\}/.exec(layoutCss);
    const drawer = drawerMatch ? drawerMatch[1] : '';
    expect(drawer).toMatch(/bottom:\s*var\(--cg-portal-bottom/);
    expect(drawer).toMatch(/width:\s*var\(--cg-portal-width/);
    // Content-box would inflate the measured width by the padding and border and overflow
    // the panel edge by ~9.4px (measured), so the drawer must size border-box.
    expect(drawer).toMatch(/box-sizing:\s*border-box/);
    // No `@container` tier may claim to style the portaled dropdown again.
    expect(responsiveCss).not.toMatch(/\.cg-dropdown-content\s*\{[^}]*bottom:\s*4px/);
  });
});
