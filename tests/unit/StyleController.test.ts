import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StyleController } from '../../src/client/renderer/StyleController.ts';

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

  const buildCollection = (items: any[]) => ({
    forEach: vi.fn((cb: (n: any) => void) => items.forEach(cb)),
    length: items.length,
    filter: vi.fn((pred: (n: any) => boolean) => buildCollection(items.filter(pred))),
    removeClass: vi.fn((cls: string) => { items.forEach((el: any) => { if (el.removeClass) el.removeClass(cls); }); }),
    addClass: vi.fn((cls: string) => { items.forEach((el: any) => { if (el.addClass) el.addClass(cls); }); }),
  });

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
});