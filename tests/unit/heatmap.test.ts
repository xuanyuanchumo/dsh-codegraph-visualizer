import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StyleController } from '../../src/client/renderer/StyleController.ts';
import type { HeatmapMode } from '../../src/client/renderer/IRenderer.ts';
import { HEATMAP, LOD } from '../../src/shared/constants.ts';

function createMockCy() {
  const updateFn = vi.fn();
  const fromJsonFn = vi.fn(() => ({ update: updateFn }));
  const nodesFn = vi.fn(() => ({
    length: 10,
    forEach: vi.fn(),
  }));
  const styleFn = vi.fn(() => ({ fromJson: fromJsonFn }));
  const zoomFn = vi.fn(() => 0.5);
  const onFn = vi.fn();
  const offFn = vi.fn();
  return { nodes: nodesFn, style: styleFn, zoom: zoomFn, on: onFn, off: offFn, fromJsonFn, updateFn };
}

function getLastStyleArray(fromJsonFn: ReturnType<typeof vi.fn>): any[] {
  const calls = (fromJsonFn as any).mock.calls;
  return calls[calls.length - 1][0] as any[];
}

describe('HeatmapMode', () => {
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

describe('StyleController heatmap', () => {
  let controller: StyleController;
  let mockCy: ReturnType<typeof createMockCy>;

  beforeEach(() => {
    mockCy = createMockCy();
    controller = new StyleController(mockCy as any, 'dark');
  });

  it('should default to none mode', () => {
    expect(controller.getHeatmapMode()).toBe('none');
  });

  it('should set heatmap mode', () => {
    controller.setHeatmapMode('instability');
    expect(controller.getHeatmapMode()).toBe('instability');
  });

  it('should not re-apply when setting same mode', () => {
    controller.setHeatmapMode('instability');
    const callCount = (mockCy.fromJsonFn as any).mock.calls.length;
    controller.setHeatmapMode('instability');
    expect((mockCy.fromJsonFn as any).mock.calls.length).toBe(callCount);
  });

  it('should apply heatmap overrides when mode is instability', () => {
    controller.setHeatmapMode('instability');
    const styleArray = getLastStyleArray(mockCy.fromJsonFn);
    const hasInstabilitySelector = styleArray.some(
      (s: any) => s.selector === 'node[instability]'
    );
    expect(hasInstabilitySelector).toBe(true);
  });

  it('should apply lines heatmap overrides', () => {
    controller.setHeatmapMode('lines');
    const styleArray = getLastStyleArray(mockCy.fromJsonFn);
    const hasLinesSelector = styleArray.some(
      (s: any) => s.selector === 'node[linesOfCode]'
    );
    expect(hasLinesSelector).toBe(true);
  });

  it('should apply complexity heatmap overrides', () => {
    controller.setHeatmapMode('complexity');
    const styleArray = getLastStyleArray(mockCy.fromJsonFn);
    const hasComplexitySelector = styleArray.some(
      (s: any) => s.selector === 'node[complexity]'
    );
    expect(hasComplexitySelector).toBe(true);
  });

  it('should not include heatmap overrides when mode is none', () => {
    controller.setHeatmapMode('instability');
    controller.setHeatmapMode('none');
    const styleArray = getLastStyleArray(mockCy.fromJsonFn);
    const hasInstabilitySelector = styleArray.some(
      (s: any) => s.selector === 'node[instability]'
    );
    const hasLinesSelector = styleArray.some(
      (s: any) => s.selector === 'node[linesOfCode]'
    );
    const hasComplexitySelector = styleArray.some(
      (s: any) => s.selector === 'node[complexity]'
    );
    expect(hasInstabilitySelector).toBe(false);
    expect(hasLinesSelector).toBe(false);
    expect(hasComplexitySelector).toBe(false);
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
