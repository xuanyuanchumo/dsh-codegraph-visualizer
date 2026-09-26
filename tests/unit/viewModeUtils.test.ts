import { describe, it, expect } from 'vitest';
import { isLayeredViewMode, VIEW_MODE_LAYOUT, getViewLayer, getAvailablePanels, STRUCTURAL_PANELS, BEHAVIORAL_PANELS } from '../../src/shared/viewModeUtils.ts';
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

describe('getViewLayer', () => {
  it('returns structural for code', () => {
    expect(getViewLayer('code')).toBe('structural');
  });

  it('returns behavioral for dependencies', () => {
    expect(getViewLayer('dependencies')).toBe('behavioral');
  });

  it('returns behavioral for inheritance', () => {
    expect(getViewLayer('inheritance')).toBe('behavioral');
  });

  it('returns behavioral for callgraph', () => {
    expect(getViewLayer('callgraph')).toBe('behavioral');
  });

  it('returns behavioral for package', () => {
    expect(getViewLayer('package')).toBe('behavioral');
  });

  it('returns behavioral for class', () => {
    expect(getViewLayer('class')).toBe('behavioral');
  });

  it('returns behavioral for cfg', () => {
    expect(getViewLayer('cfg')).toBe('behavioral');
  });

  it('returns behavioral for flowchart', () => {
    expect(getViewLayer('flowchart')).toBe('behavioral');
  });

  it('returns behavioral for sequence', () => {
    expect(getViewLayer('sequence')).toBe('behavioral');
  });
});

describe('getAvailablePanels', () => {
  it('returns STRUCTURAL_PANELS for structural layer', () => {
    expect(getAvailablePanels('structural')).toBe(STRUCTURAL_PANELS);
  });

  it('returns BEHAVIORAL_PANELS for behavioral layer', () => {
    expect(getAvailablePanels('behavioral')).toBe(BEHAVIORAL_PANELS);
  });

  it('returns minimal panels for runtime layer', () => {
    const panels = getAvailablePanels('runtime');
    expect(panels.has('showMiniMap')).toBe(true);
    expect(panels.has('showLegend')).toBe(true);
    expect(panels.size).toBe(2);
  });
});

describe('STRUCTURAL_PANELS and BEHAVIORAL_PANELS', () => {
  it('STRUCTURAL_PANELS contains expected keys', () => {
    expect(STRUCTURAL_PANELS.has('showSearch')).toBe(true);
    expect(STRUCTURAL_PANELS.has('showPathFind')).toBe(true);
    expect(STRUCTURAL_PANELS.has('showHealthScore')).toBe(true);
    expect(STRUCTURAL_PANELS.has('showFilterPanel')).toBe(true);
  });

  it('BEHAVIORAL_PANELS contains expected keys', () => {
    expect(BEHAVIORAL_PANELS.has('showCallChain')).toBe(true);
    expect(BEHAVIORAL_PANELS.has('showCycles')).toBe(true);
    expect(BEHAVIORAL_PANELS.has('showImpact')).toBe(true);
    expect(BEHAVIORAL_PANELS.has('showHotspot')).toBe(true);
  });
});