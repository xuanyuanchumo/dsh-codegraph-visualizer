import { describe, it, expect } from 'vitest';
import { isLayeredViewMode, VIEW_MODE_LAYOUT } from '../../src/shared/viewModeUtils.ts';
import type { ViewMode } from '../../src/types/index.ts';

const ALL_VIEW_MODES: ViewMode[] = [
  'code', 'dependencies', 'inheritance', 'callgraph',
  'package', 'class', 'cfg', 'flowchart', 'sequence',
];

const LAYERED_MODES: ViewMode[] = ['inheritance', 'callgraph', 'package', 'class', 'dependencies'];
const NON_LAYERED_MODES: ViewMode[] = ['code', 'cfg', 'flowchart', 'sequence'];

describe('isLayeredViewMode', () => {
  it.each(LAYERED_MODES)('returns true for layered view mode: %s', (mode) => {
    expect(isLayeredViewMode(mode)).toBe(true);
  });

  it.each(NON_LAYERED_MODES)('returns false for non-layered view mode: %s', (mode) => {
    expect(isLayeredViewMode(mode)).toBe(false);
  });

  it('covers all ViewMode values', () => {
    const tested = [...LAYERED_MODES, ...NON_LAYERED_MODES];
    expect(tested.sort()).toEqual([...ALL_VIEW_MODES].sort());
  });
});

describe('VIEW_MODE_LAYOUT', () => {
  it('maps every ViewMode to a LayoutType', () => {
    for (const mode of ALL_VIEW_MODES) {
      expect(VIEW_MODE_LAYOUT[mode]).toBeDefined();
    }
  });

  it('maps code to cose', () => {
    expect(VIEW_MODE_LAYOUT.code).toBe('cose');
  });

  it('maps dependencies to cose', () => {
    expect(VIEW_MODE_LAYOUT.dependencies).toBe('cose');
  });

  it('maps inheritance to tree', () => {
    expect(VIEW_MODE_LAYOUT.inheritance).toBe('tree');
  });

  it('maps callgraph to dagre', () => {
    expect(VIEW_MODE_LAYOUT.callgraph).toBe('dagre');
  });

  it('maps package to tree', () => {
    expect(VIEW_MODE_LAYOUT.package).toBe('tree');
  });

  it('maps class to dagre', () => {
    expect(VIEW_MODE_LAYOUT.class).toBe('dagre');
  });

  it('maps cfg to dagre', () => {
    expect(VIEW_MODE_LAYOUT.cfg).toBe('dagre');
  });

  it('maps flowchart to dagre', () => {
    expect(VIEW_MODE_LAYOUT.flowchart).toBe('dagre');
  });

  it('maps sequence to cose', () => {
    expect(VIEW_MODE_LAYOUT.sequence).toBe('cose');
  });

  it('uses dagre for all layered view modes', () => {
    const modes: ViewMode[] = ['callgraph', 'class'];
    for (const mode of modes) {
      expect(VIEW_MODE_LAYOUT[mode]).toBe('dagre');
    }
  });

  it('uses tree for hierarchical view modes', () => {
    const modes: ViewMode[] = ['inheritance', 'package'];
    for (const mode of modes) {
      expect(VIEW_MODE_LAYOUT[mode]).toBe('tree');
    }
  });
});