/**
 * 窄档版式的两套机制必须**逐条等价**（cycle-110 / T3）。
 *
 * 缺陷形态（本仓库已发生过两次同族问题）：
 *   - JS 侧按「实测宽度」分档，CSS 侧按 `@container` 分档，两边阈值漂移
 *     （`tests/unit/responsiveContract.test.ts` 对工具栏那一对已经守过一次）；
 *   - 兜底机制只复制了主机制的一部分声明，于是「支持的浏览器正常、不支持的错位」，
 *     而这种差异在 jsdom / Chromium E2E 里都看不见。
 *
 * 本文件把两份声明**解析后逐属性比对**，并用非空断言证明扫描器真的读到了东西。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PANEL_TIER_COMPACT_PX, PANEL_TIER_NARROW_PX, resolvePanelTier,
} from '../../src/client/hooks/usePanelTier.ts';
import {
  SHEET_PANEL_KEYS, openSheetPanels, panelRootDataAttributes,
} from '../../src/client/components/panelSheet.ts';
import { UI } from '../../src/shared/constants.ts';

const css = readFileSync(
  join(process.cwd(), 'src', 'client', 'styles', 'responsive.css'),
  'utf8',
);

/** 从 `header` 起的大括号块（含嵌套）。 */
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

/** 找到**包含** `needle` 的那个 header 块（同名 header 可能出现多次）。 */
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

const NARROW_CONTAINER_HEADER = `@container graphpanel (max-width: ${PANEL_TIER_NARROW_PX}px)`;
const TIER_B_SELECTOR = '.cg-graph-panel[data-cg-tier="narrow"] .cg-node-detail-panel';

describe('窄档阈值与工具栏阈值同源', () => {
  it('uses the same numbers as the toolbar tiers', () => {
    // 两侧阈值不同会得到「JS 认为 narrow、CSS 认为 wide」的半适配状态
    expect(PANEL_TIER_NARROW_PX).toBe(UI.TOOLBAR_BREAKPOINT_NARROW_PX);
    expect(PANEL_TIER_COMPACT_PX).toBe(UI.TOOLBAR_BREAKPOINT_COMPACT_PX);
  });

  it('declares a container tier for the panel narrow breakpoint', () => {
    expect(css).toContain(NARROW_CONTAINER_HEADER);
  });
});

describe('resolvePanelTier（纯函数分档）', () => {
  it('treats an unmeasured width as wide (no narrow flash on mount)', () => {
    expect(resolvePanelTier(0)).toBe('wide');
    expect(resolvePanelTier(Number.NaN)).toBe('wide');
    expect(resolvePanelTier(-10)).toBe('wide');
  });

  it('partitions the width axis at the two documented breakpoints', () => {
    expect(resolvePanelTier(1)).toBe('narrow');
    expect(resolvePanelTier(PANEL_TIER_NARROW_PX - 1)).toBe('narrow');
    expect(resolvePanelTier(PANEL_TIER_NARROW_PX)).toBe('compact');
    expect(resolvePanelTier(PANEL_TIER_COMPACT_PX - 1)).toBe('compact');
    expect(resolvePanelTier(PANEL_TIER_COMPACT_PX)).toBe('wide');
    expect(resolvePanelTier(1920)).toBe('wide');
  });
});

describe('面板抽屉标记', () => {
  const none = { hasSelectedNode: false, showSearch: false, showPathFind: false, showFilterPanel: false, showImport: false };

  it('reports the open sheet panels in a stable order', () => {
    expect(openSheetPanels(none)).toEqual([]);
    expect(openSheetPanels({ ...none, showImport: true, hasSelectedNode: true })).toEqual(['detail', 'import']);
  });

  it('every declared sheet key is producible from some state (no orphan key)', () => {
    // 与「ViewLayer 成员可读却不可达」同族的检查：声明了却永远取不到 = 死键
    const producible = new Set<string>();
    for (const hasSelectedNode of [true, false]) {
      for (const showSearch of [true, false]) {
        for (const showPathFind of [true, false]) {
          for (const showFilterPanel of [true, false]) {
            for (const showImport of [true, false]) {
              for (const key of openSheetPanels({ hasSelectedNode, showSearch, showPathFind, showFilterPanel, showImport })) {
                producible.add(key);
              }
            }
          }
        }
      }
    }
    expect([...producible].sort()).toEqual([...SHEET_PANEL_KEYS].sort());
  });

  it('writes the sheet attribute only while a panel is open', () => {
    expect(panelRootDataAttributes('narrow', none)).toEqual({ 'data-cg-tier': 'narrow' });
    expect(panelRootDataAttributes('narrow', { ...none, showSearch: true })).toEqual({
      'data-cg-tier': 'narrow', 'data-cg-sheet': 'open',
    });
    // 宽档也要写档位（E2E 直接读档位，不从样式反推），但依然如实报告抽屉打开
    expect(panelRootDataAttributes('wide', none)).toEqual({ 'data-cg-tier': 'wide' });
    expect(panelRootDataAttributes('wide', { ...none, hasSelectedNode: true })).toEqual({
      'data-cg-tier': 'wide', 'data-cg-sheet': 'open',
    });
  });
});

describe('窄档抽屉版式：容器查询与 JS 档位两套机制逐条等价', () => {
  // 480px 档在文件里出现过多次（旧的紧凑规则 + 本轮的抽屉规则），必须选中**抽屉**那一个：
  // 用 `top: auto` 作为特征针，否则读到的是旧规则的 declarations，比较就变成
  // 「新抽屉 vs 旧全宽」这种必然失败的错配。
  const containerBlock = blockContaining(css, NARROW_CONTAINER_HEADER, 'top: auto');
  const containerDeclarations = declarationsOf(containerBlock, '.cg-node-detail-panel');
  const tierDeclarations = declarationsOf(css, TIER_B_SELECTOR);

  it('the scanner actually found both mechanisms (anti-vacuity)', () => {
    expect(containerBlock, '未找到含 .cg-node-detail-panel 的 480px 容器查询块').not.toBe('');
    expect(Object.keys(containerDeclarations).length).toBeGreaterThan(3);
    expect(Object.keys(tierDeclarations).length).toBeGreaterThan(3);
  });

  it('declares identical detail-panel geometry in both mechanisms', () => {
    expect(tierDeclarations).toEqual(containerDeclarations);
    // 具体数值单独钉一次：改成「贴底抽屉」这个语义不能被悄悄改回顶部侧栏
    expect(tierDeclarations.top).toBe('auto');
    expect(tierDeclarations.bottom).toBe('calc(var(--cg-statusbar-h) + 8px)');
    expect(tierDeclarations.left).toBe('8px');
    expect(tierDeclarations.right).toBe('8px');
    expect(tierDeclarations.width).toBe('auto');
    expect(tierDeclarations['max-height']).toBe('52%');
  });

  it('hides the mini-map and legend only while a sheet is open, in both mechanisms', () => {
    const viaContainer = declarationsOf(
      containerBlock,
      '.cg-graph-panel[data-cg-sheet="open"] .cg-mini-map',
    );
    const viaTier = declarationsOf(
      css,
      '.cg-graph-panel[data-cg-tier="narrow"][data-cg-sheet="open"] .cg-mini-map',
    );
    expect(viaContainer).toEqual({ display: 'none' });
    expect(viaTier).toEqual({ display: 'none' });
    // 图例在两条路径上都要一起让位（漏一条就会剩下「半透明重叠」这一半缺陷）
    expect(containerBlock).toContain('.cg-graph-panel[data-cg-sheet="open"] .cg-legend-panel');
    expect(css).toContain('.cg-graph-panel[data-cg-tier="narrow"][data-cg-sheet="open"] .cg-legend-panel');
  });

  it('keeps the wide-tier detail panel geometry untouched', () => {
    // 主样式表里的基础规则仍是「左上侧栏」，窄档只是覆盖 —— 防止有人把窄档值写回基础规则
    const base = readFileSync(join(process.cwd(), 'src', 'client', 'styles', 'node-detail.css'), 'utf8');
    const baseDeclarations = declarationsOf(base, '.cg-node-detail-panel');
    expect(baseDeclarations.top).toBe('12px');
    expect(baseDeclarations.left).toBe('12px');
    expect(baseDeclarations.width).toBe('260px');
  });
});
