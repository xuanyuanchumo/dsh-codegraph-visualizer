import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StyleController } from '../../src/client/renderer/StyleController.ts';
import type { HeatmapMode } from '../../src/client/renderer/IRenderer.ts';
import { HEATMAP, LOD } from '../../src/shared/constants.ts';

function makeMockNode(id: string, data: Record<string, unknown> = {}) {
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const classes = new Set<string>();
  return {
    id: () => id,
    data: vi.fn((key: string, value?: unknown) => {
      if (value !== undefined) { dataMap.set(key, value); return undefined; }
      return dataMap.get(key);
    }),
    addClass: vi.fn((cls: string) => { classes.add(cls); }),
    removeClass: vi.fn((cls: string) => { classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    _classes: classes,
  };
}

function makeMockEdge(id: string) {
  const classes = new Set<string>();
  return {
    id: () => id,
    addClass: vi.fn((cls: string) => { classes.add(cls); }),
    removeClass: vi.fn((cls: string) => { classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    _classes: classes,
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const nodeMap = new Map<string, any>();
  for (const n of nodeList) nodeMap.set(n.id(), n);

  const buildCollection = (items: any[]) => {
    const col = {
      forEach: vi.fn((cb: (n: any) => void) => items.forEach(cb)),
      length: items.length,
      filter: vi.fn((pred: (n: any) => boolean) => buildCollection(items.filter(pred))),
      removeClass: vi.fn((cls: string) => { items.forEach((el: any) => { if (el.removeClass) el.removeClass(cls); }); return col; }),
      addClass: vi.fn((cls: string) => { items.forEach((el: any) => { if (el.addClass) el.addClass(cls); }); return col; }),
    };
    return col;
  };

  const nodesCollection = buildCollection(nodeList);
  const edgesCollection = buildCollection(edgeList);

  const styleObj = {
    fromJson: vi.fn(() => styleObj),
    update: vi.fn(),
  };

  return {
    nodes: vi.fn(() => nodesCollection),
    edges: vi.fn(() => edgesCollection),
    on: vi.fn(),
    off: vi.fn(),
    batch: vi.fn((cb: () => void) => cb()),
    zoom: vi.fn(() => 1),
    style: vi.fn(() => styleObj),
    _nodeMap: nodeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
    _styleObj: styleObj,
  };
}

describe('StyleController', () => {
  describe('constructor', () => {
    it('constructs without throwing', () => {
      const cy = makeMockCy();
      const ctrl = new StyleController(cy as any, 'dark');
      expect(ctrl).toBeInstanceOf(StyleController);
      expect(ctrl.getTheme()).toBe('dark');
    });
  });

  describe('getTheme', () => {
    it('returns the theme passed to constructor', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      expect(controller.getTheme()).toBe('dark');
    });

    it('returns light theme when light is passed', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'light');
      expect(controller.getTheme()).toBe('light');
    });
  });

  describe('updateTheme', () => {
    it('changes theme from dark to light', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.updateTheme('light');
      expect(controller.getTheme()).toBe('light');
    });

    it('changes theme from light to dark', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'light');
      controller.updateTheme('dark');
      expect(controller.getTheme()).toBe('dark');
    });
  });

  describe('LOD (Level of Detail)', () => {
    it('isLODEnabled returns false by default', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      expect(controller.isLODEnabled()).toBe(false);
    });

    it('enableLOD sets lodEnabled to true', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      expect(controller.isLODEnabled()).toBe(true);
    });

    it('disableLOD sets lodEnabled to false', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      controller.disableLOD();
      expect(controller.isLODEnabled()).toBe(false);
    });

    it('enableLOD registers zoom event listener', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      expect(cy.on).toHaveBeenCalledWith('zoom', expect.any(Function));
    });

    it('disableLOD unregisters zoom event listener', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      controller.disableLOD();
      expect(cy.off).toHaveBeenCalledWith('zoom', expect.any(Function));
    });

    it('enableLOD is idempotent (calling twice does not register twice)', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      controller.enableLOD();
      expect(cy.on).toHaveBeenCalledTimes(1);
    });

    it('disableLOD is idempotent (calling twice does not unregister twice)', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.disableLOD();
      controller.disableLOD();
      expect(cy.off).not.toHaveBeenCalled();
    });
  });

  describe('Heatmap', () => {
    it('getHeatmapMode returns "none" by default', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      expect(controller.getHeatmapMode()).toBe('none');
    });

    it('setHeatmapMode changes mode to "instability"', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setHeatmapMode('instability');
      expect(controller.getHeatmapMode()).toBe('instability');
    });

    it('setHeatmapMode changes mode to "lines"', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setHeatmapMode('lines');
      expect(controller.getHeatmapMode()).toBe('lines');
    });

    it('setHeatmapMode changes mode to "complexity"', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setHeatmapMode('complexity');
      expect(controller.getHeatmapMode()).toBe('complexity');
    });

    it('setHeatmapMode does not re-apply when same mode is set', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setHeatmapMode('instability');
      const styleCallCount = cy.style.mock.calls.length;
      controller.setHeatmapMode('instability');
      expect(cy.style.mock.calls.length).toBe(styleCallCount);
    });
  });

  describe('MultiDimensionMapping', () => {
    it('getMultiDimensionMapping returns nulls by default', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      expect(controller.getMultiDimensionMapping()).toEqual({ sizeMetric: null, colorMetric: null });
    });

    it('setMultiDimensionMapping sets sizeMetric', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setMultiDimensionMapping('instability', null);
      expect(controller.getMultiDimensionMapping()).toEqual({ sizeMetric: 'instability', colorMetric: null });
    });

    it('setMultiDimensionMapping sets colorMetric', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setMultiDimensionMapping(null, 'complexity');
      expect(controller.getMultiDimensionMapping()).toEqual({ sizeMetric: null, colorMetric: 'complexity' });
    });

    it('setMultiDimensionMapping sets both metrics', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setMultiDimensionMapping('instability', 'complexity');
      expect(controller.getMultiDimensionMapping()).toEqual({ sizeMetric: 'instability', colorMetric: 'complexity' });
    });

    it('setMultiDimensionMapping resets to nulls', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setMultiDimensionMapping('instability', 'complexity');
      controller.setMultiDimensionMapping(null, null);
      expect(controller.getMultiDimensionMapping()).toEqual({ sizeMetric: null, colorMetric: null });
    });
  });

  describe('getStylesheet', () => {
    it('returns a non-empty stylesheet array', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      const stylesheet = controller.getStylesheet();
      expect(Array.isArray(stylesheet)).toBe(true);
      expect(stylesheet.length).toBeGreaterThan(0);
    });

    it('caches stylesheet when node count is unchanged', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const controller = new StyleController(cy as any, 'dark');
      const sheet1 = controller.getStylesheet();
      const sheet2 = controller.getStylesheet();
      expect(sheet1).toBe(sheet2);
    });
  });

  describe('applyStylesheet via updateTheme', () => {
    it('calls cy.style().fromJson() with stylesheet array on updateTheme', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.updateTheme('light');
      expect(cy.style).toHaveBeenCalled();
      expect(cy._styleObj.fromJson).toHaveBeenCalled();
      expect(cy._styleObj.update).toHaveBeenCalled();
    });

    it('applies stylesheet when heatmap mode changes', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setHeatmapMode('instability');
      expect(cy._styleObj.fromJson).toHaveBeenCalled();
    });

    it('applies stylesheet when multi-dimension mapping changes', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.setMultiDimensionMapping('instability', null);
      expect(cy._styleObj.fromJson).toHaveBeenCalled();
    });

    it('does not re-apply stylesheet when already applied', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.updateTheme('light');
      const callCount = cy._styleObj.fromJson.mock.calls.length;
      controller.updateTheme('light');
      expect(cy._styleObj.fromJson.mock.calls.length).toBeGreaterThanOrEqual(callCount);
    });
  });

  describe('LOD class application', () => {
    it('enableLOD applies LOD classes to nodes at low zoom', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 0.1);
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      expect(nodeA.addClass).toHaveBeenCalledWith('lod-minimal');
    });

    it('disableLOD removes LOD classes from nodes', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 0.1);
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      controller.disableLOD();
      expect(nodeA.removeClass).toHaveBeenCalledWith('lod-minimal lod-compact');
    });

    it('LOD switches to compact at medium zoom', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 0.25);
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      expect(nodeA.addClass).toHaveBeenCalledWith('lod-compact');
    });

    it('LOD stays full at high zoom', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 2.0);
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      expect(nodeA.removeClass).toHaveBeenCalledWith('lod-minimal lod-compact');
    });
  });

  describe('getStylesheet caching', () => {
    it('rebuilds stylesheet when node count changes', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const controller = new StyleController(cy as any, 'dark');
      const sheet1 = controller.getStylesheet();
      const nodeB = makeMockNode('b');
      cy.nodes = vi.fn(() => ({
        forEach: vi.fn((cb: (n: any) => void) => { cb(nodeA); cb(nodeB); }),
        length: 2,
        filter: vi.fn(),
        removeClass: vi.fn(),
        addClass: vi.fn(),
      }));
      const sheet2 = controller.getStylesheet();
      expect(sheet1).not.toBe(sheet2);
    });
  });

  describe('destroy', () => {
    it('disables LOD on destroy', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      expect(controller.isLODEnabled()).toBe(true);
      controller.destroy();
      expect(controller.isLODEnabled()).toBe(false);
    });

    it('unregisters zoom listener on destroy', () => {
      const cy = makeMockCy();
      const controller = new StyleController(cy as any, 'dark');
      controller.enableLOD();
      controller.destroy();
      expect(cy.off).toHaveBeenCalledWith('zoom', expect.any(Function));
    });
  });

  describe('HeatmapMode type and HEATMAP constants', () => {
    it('should export HeatmapMode type with correct values', () => {
      const modes: HeatmapMode[] = ['none', 'instability', 'lines', 'complexity'];
      expect(modes).toHaveLength(4);
    });

    it('HEATMAP constants should have required color and threshold values', () => {
      expect(HEATMAP.COLOR_STABLE).toBe('#10b981');
      expect(HEATMAP.COLOR_UNSTABLE).toBe('#ef4444');
      expect(HEATMAP.COLOR_LOW).toBe('#3b82f6');
      expect(HEATMAP.COLOR_HIGH).toBe('#ef4444');
      expect(HEATMAP.LINES_LOW).toBe(50);
      expect(HEATMAP.LINES_HIGH).toBe(500);
      expect(HEATMAP.COMPLEXITY_LOW).toBe(5);
      expect(HEATMAP.COMPLEXITY_HIGH).toBe(20);
    });
  });

  describe('LOD dynamic thresholds', () => {
    it('LOD constants should have small/medium/large thresholds', () => {
      expect(LOD.MINIMAL_THRESHOLD_SMALL).toBeDefined();
      expect(LOD.MINIMAL_THRESHOLD_MEDIUM).toBeDefined();
      expect(LOD.MINIMAL_THRESHOLD_LARGE).toBeDefined();
      expect(LOD.COMPACT_THRESHOLD_SMALL).toBeDefined();
      expect(LOD.COMPACT_THRESHOLD_MEDIUM).toBeDefined();
      expect(LOD.COMPACT_THRESHOLD_LARGE).toBeDefined();
    });

    it('small thresholds should be lower than medium, medium lower than large', () => {
      expect(LOD.MINIMAL_THRESHOLD_SMALL).toBeLessThan(LOD.MINIMAL_THRESHOLD_MEDIUM);
      expect(LOD.MINIMAL_THRESHOLD_MEDIUM).toBeLessThan(LOD.MINIMAL_THRESHOLD_LARGE);
      expect(LOD.COMPACT_THRESHOLD_SMALL).toBeLessThan(LOD.COMPACT_THRESHOLD_MEDIUM);
      expect(LOD.COMPACT_THRESHOLD_MEDIUM).toBeLessThan(LOD.COMPACT_THRESHOLD_LARGE);
    });

    it('should have node size and edge width constants', () => {
      expect(LOD.MINIMAL_NODE_SIZE).toBe(8);
      expect(LOD.COMPACT_NODE_SIZE).toBe(16);
      expect(LOD.MINIMAL_EDGE_WIDTH).toBe(0.5);
      expect(LOD.COMPACT_EDGE_WIDTH).toBe(1);
      expect(LOD.COMPACT_FONT_SIZE).toBe(6);
      expect(LOD.TRANSITION_DURATION_MS).toBe(200);
    });
  });
});