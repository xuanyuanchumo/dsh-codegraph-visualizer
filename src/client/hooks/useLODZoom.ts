import { useEffect } from 'react';
import { LOD } from '../../shared/constants.ts';

interface RendererRef {
  getZoom: () => number;
  onZoomChange: (handler: () => void) => () => void;
}

interface UseLODZoomOpts {
  lodEnabled: boolean;
  lodLevel: 'minimal' | 'compact' | 'full';
  rawNodesLength: number;
  rendererRef: React.RefObject<RendererRef | null>;
  setLODLevel: (level: 'minimal' | 'compact' | 'full') => void;
}

export function useLODZoom(opts: UseLODZoomOpts): void {
  useEffect(() => {
    if (!opts.lodEnabled) return;
    const r = opts.rendererRef.current;
    if (!r) return;
    let rafId: number | null = null;
    const computeLODFromZoom = (zoom: number) => {
      const nodeCount = opts.rawNodesLength;
      let minimalThreshold: number;
      let compactThreshold: number;
      if (nodeCount < LOD.SMALL_NODE_COUNT) {
        minimalThreshold = LOD.MINIMAL_THRESHOLD_SMALL;
        compactThreshold = LOD.COMPACT_THRESHOLD_SMALL;
      } else if (nodeCount < LOD.MEDIUM_NODE_COUNT) {
        minimalThreshold = LOD.MINIMAL_THRESHOLD_MEDIUM;
        compactThreshold = LOD.COMPACT_THRESHOLD_MEDIUM;
      } else {
        minimalThreshold = LOD.MINIMAL_THRESHOLD_LARGE;
        compactThreshold = LOD.COMPACT_THRESHOLD_LARGE;
      }
      if (zoom < minimalThreshold) return 'minimal' as const;
      if (zoom < compactThreshold) return 'compact' as const;
      return 'full' as const;
    };
    const handleZoom = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const newLevel = computeLODFromZoom(r.getZoom());
        if (newLevel !== opts.lodLevel) opts.setLODLevel(newLevel);
      });
    };
    const disposeZoomListener = r.onZoomChange(handleZoom);
    return () => {
      disposeZoomListener();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [opts.lodEnabled, opts.lodLevel, opts.rawNodesLength, opts.rendererRef, opts.setLODLevel]);
}