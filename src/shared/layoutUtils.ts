import { LAYOUT } from './constants.ts';

export interface SmartSpacing {
  nodeRepulse: number;
  idealEdgeLength: number;
  rankSep: number;
  edgeSep: number;
  nodeSep: number;
  padding: number;
  minNodeSpacing: number;
  spacingFactor: number;
  minGap: number;
  incrementalRadius: number;
}

export function computeSmartSpacing(nodeCount: number, containerWidth: number, containerHeight: number): SmartSpacing {
  const containerArea = containerWidth * containerHeight;
  const containerMinDim = Math.min(containerWidth, containerHeight);
  const areaPerNode = containerArea / Math.max(nodeCount, 1);
  const idealSpacing = Math.sqrt(areaPerNode);

  let densityFactor: number;
  if (nodeCount < LAYOUT.SMALL_NODE_THRESHOLD) densityFactor = LAYOUT.DENSITY_FACTOR_SMALL;
  else if (nodeCount < LAYOUT.MEDIUM_NODE_THRESHOLD) densityFactor = LAYOUT.DENSITY_FACTOR_MEDIUM;
  else if (nodeCount < LAYOUT.LARGE_NODE_THRESHOLD) densityFactor = LAYOUT.DENSITY_FACTOR_LARGE;
  else densityFactor = 0.5;

  const s = Math.max(40, idealSpacing * densityFactor);

  return {
    nodeRepulse: Math.min(s * s * 4, LAYOUT.NODE_REPULSE_MAX),
    idealEdgeLength: s * 2,
    rankSep: Math.min(Math.max(LAYOUT.MIN_RANK_SEP, s * 0.3), LAYOUT.MAX_RANK_SEP),
    edgeSep: Math.min(Math.max(15, s * 0.15), 40),
    nodeSep: Math.min(Math.max(20, s * 0.2), 40),
    padding: Math.max(40, Math.min(120, containerMinDim * 0.05)),
    minNodeSpacing: Math.max(LAYOUT.MIN_NODE_SPACING, s * 0.3),
    spacingFactor: nodeCount < LAYOUT.SMALL_NODE_COUNT_THRESHOLD
      ? LAYOUT.SMALL_SPACING_FACTOR
      : nodeCount < LAYOUT.MEDIUM_NODE_COUNT_THRESHOLD
        ? LAYOUT.MEDIUM_SPACING_FACTOR
        : LAYOUT.LARGE_SPACING_FACTOR,
    minGap: Math.max(30, s * 0.4),
    incrementalRadius: Math.max(LAYOUT.INCREMENTAL_RADIUS_BASE, s * 1.5),
  };
}