import { useEffect, useState } from 'react';
import { UI } from '../../shared/constants.ts';

interface RendererRef {
  getThumbnail: () => string | null;
  getViewportInfo: () => {
    zoom: number; pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null;
}

interface UseMiniMapSyncOpts {
  showMiniMap: boolean;
  collapsed: boolean;
  rendererRef: React.RefObject<RendererRef | null>;
  nodesLength: number;
  layout: string;
}

export function useMiniMapSync(opts: UseMiniMapSyncOpts): {
  thumbnail: string | null;
  viewportInfo: {
    zoom: number; pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null;
} {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [viewportInfo, setViewportInfo] = useState<{
    zoom: number; pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null>(null);

  useEffect(() => {
    if (!opts.showMiniMap || opts.collapsed) return;
    const updateMiniMap = () => {
      const r = opts.rendererRef.current;
      if (!r) return;
      setThumbnail(r.getThumbnail());
      setViewportInfo(r.getViewportInfo());
    };
    updateMiniMap();
    let lastUpdate = 0;
    const intervalId = setInterval(() => {
      const now = Date.now();
      if (now - lastUpdate < UI.MINIMAP_THROTTLE_MS) return;
      lastUpdate = now;
      updateMiniMap();
    }, UI.MINIMAP_UPDATE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [opts.showMiniMap, opts.collapsed, opts.rendererRef, opts.nodesLength, opts.layout]);

  return { thumbnail, viewportInfo };
}