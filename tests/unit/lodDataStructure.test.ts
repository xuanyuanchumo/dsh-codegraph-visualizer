import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, disposeStore } from '../../src/client/store/graphStore.ts';
import { LOD } from '../../src/shared/constants.ts';

describe('LOD data structure', () => {
  beforeEach(() => {
    disposeStore();
    useGraphStore.getState().clearGraph();
  });

  it('initializes with full LOD level and disabled', () => {
    const state = useGraphStore.getState();
    expect(state.lodLevel).toBe('full');
    expect(state.lodEnabled).toBe(false);
  });

  it('setLODLevel updates lodLevel state', () => {
    useGraphStore.getState().setLODLevel('minimal');
    expect(useGraphStore.getState().lodLevel).toBe('minimal');

    useGraphStore.getState().setLODLevel('compact');
    expect(useGraphStore.getState().lodLevel).toBe('compact');

    useGraphStore.getState().setLODLevel('full');
    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  it('setLODEnabled toggles lodEnabled state', () => {
    useGraphStore.getState().setLODEnabled(true);
    expect(useGraphStore.getState().lodEnabled).toBe(true);

    useGraphStore.getState().setLODEnabled(false);
    expect(useGraphStore.getState().lodEnabled).toBe(false);
  });

  it('setLODEnabled(false) resets lodLevel to full', () => {
    useGraphStore.getState().setLODLevel('minimal');
    useGraphStore.getState().setLODEnabled(false);
    expect(useGraphStore.getState().lodLevel).toBe('full');
  });

  it('LOD constants define cluster depth mappings', () => {
    expect(LOD.MINIMAL_CLUSTER_DEPTH).toBe(0);
    expect(LOD.COMPACT_CLUSTER_DEPTH).toBe(1);
  });

  it('LOD constants define zoom thresholds for different node counts', () => {
    expect(LOD.MINIMAL_THRESHOLD_SMALL).toBeLessThan(LOD.MINIMAL_THRESHOLD_MEDIUM);
    expect(LOD.MINIMAL_THRESHOLD_MEDIUM).toBeLessThan(LOD.MINIMAL_THRESHOLD_LARGE);
    expect(LOD.COMPACT_THRESHOLD_SMALL).toBeLessThan(LOD.COMPACT_THRESHOLD_MEDIUM);
    expect(LOD.COMPACT_THRESHOLD_MEDIUM).toBeLessThan(LOD.COMPACT_THRESHOLD_LARGE);
  });
});