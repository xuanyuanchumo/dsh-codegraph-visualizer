import { describe, it, expect } from 'vitest';
import { isLayeredViewMode, VIEW_MODE_LAYOUT, getViewLayer, getAvailablePanels, STRUCTURAL_PANELS, BEHAVIORAL_PANELS, RUNTIME_PANELS, STRUCTURAL_VIEW_MODES, BEHAVIORAL_VIEW_MODES, BEHAVIORAL_MICRO_VIEW_MODES, RUNTIME_VIEW_MODES } from '../../src/shared/viewModeUtils.ts';
import type { ViewMode } from '../../src/types/index.ts';

const ALL_VIEW_MODES: ViewMode[] = [
  'code', 'dependencies', 'inheritance', 'callgraph',
  'package', 'class', 'cfg', 'flowchart', 'sequence', 'runtime',
];

const LAYERED_MODES: ViewMode[] = ['inheritance', 'callgraph', 'package', 'class', 'dependencies'];
const NON_LAYERED_MODES: ViewMode[] = ['code', 'cfg', 'flowchart', 'sequence', 'runtime'];

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

  it('returns runtime for runtime', () => {
    // cycle-88：这是 runtime 从「类型上存在但不可达」变成真实层的关键一步。
    // 在此之前 `ViewLayer` 有 'runtime' 成员、`getAvailablePanels` 有 runtime 分支，
    // 但没有任何 ViewMode 映射过去，整个第三层没有入口。
    expect(getViewLayer('runtime')).toBe('runtime');
  });
});

describe('view mode groups', () => {
  it('partitions every ViewMode into exactly one group', () => {
    // 三组 + 微视图组必须恰好覆盖 ALL_VIEW_MODES 且互不重叠：漏一个成员会让
    // 工具栏少一个入口，重叠一个会让同一个模式出现两次。
    const grouped = [
      ...STRUCTURAL_VIEW_MODES,
      ...BEHAVIORAL_VIEW_MODES,
      ...BEHAVIORAL_MICRO_VIEW_MODES,
      ...RUNTIME_VIEW_MODES,
    ];
    expect([...grouped].sort()).toEqual([...ALL_VIEW_MODES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('keeps runtime out of the behavioral groups', () => {
    expect(BEHAVIORAL_VIEW_MODES).not.toContain('runtime');
    expect(BEHAVIORAL_MICRO_VIEW_MODES).not.toContain('runtime');
    expect(STRUCTURAL_VIEW_MODES).not.toContain('runtime');
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
    expect(panels.has('showRuntime')).toBe(true);
    expect(panels.has('showMiniMap')).toBe(true);
    expect(panels.has('showLegend')).toBe(true);
    expect(panels.size).toBe(3);
  });

  it('returns the same Set instance for every layer', () => {
    // cycle-88：runtime 分支此前是内联 `new Set([...])`，于是
    // `getAvailablePanels('runtime') === getAvailablePanels('runtime')` 为 false。
    // 三层都必须是模块级常量，否则任何以引用相等为前提的 useMemo 都会每次失效。
    expect(getAvailablePanels('runtime')).toBe(RUNTIME_PANELS);
    expect(getAvailablePanels('runtime')).toBe(getAvailablePanels('runtime'));
  });

  it('does not offer graph-analysis panels on the runtime layer', () => {
    // 运行时层没有图数据面：这些面板出现在工具下拉里就是「点击无反应」的死入口。
    const panels = getAvailablePanels('runtime');
    for (const key of ['showCallChain', 'showCycles', 'showImpact', 'showHotspot', 'showGodModule', 'showCoreFunction', 'showImport', 'showFilterPanel'] as const) {
      expect(panels.has(key)).toBe(false);
    }
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
describe('assertNever branches', () => {
  it('isLayeredViewMode throws on invalid ViewMode', () => {
    expect(() => isLayeredViewMode('invalid' as ViewMode)).toThrow(/Unreachable/);
  });

  it('getViewLayer throws on invalid ViewMode', () => {
    expect(() => getViewLayer('invalid' as ViewMode)).toThrow(/Unreachable/);
  });

  it('getAvailablePanels throws on invalid ViewLayer', () => {
    expect(() => getAvailablePanels('invalid' as never)).toThrow(/Unreachable/);
  });
});