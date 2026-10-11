// Unit tests for shared/constants.ts viewport-driven thresholds.
// Subject: src/shared/constants.ts:64-78
//   getDynamicMaxVisibleNodes(viewportWidth): <1200 -> 800, >=1920 -> 1500, else 1200
//   getAutoClusterDepth(nodeCount, maxVisibleNodes): >5x -> 2, >1.5x -> 1, else 0
// Boundary cases are pinned at the exact threshold, since `<` vs `<=` and
// `>` vs `>=` differ by one unit and both readings look reasonable.
import { describe, it, expect } from 'vitest';
import { getDynamicMaxVisibleNodes, getAutoClusterDepth, DYNAMIC_CLUSTER } from '../../src/shared/constants.ts';

describe('getDynamicMaxVisibleNodes', () => {
  it('returns the small-screen budget below the small breakpoint', () => {
    expect(getDynamicMaxVisibleNodes(0)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL);
    expect(getDynamicMaxVisibleNodes(1199)).toBe(800);
  });

  it('returns the medium budget at the small breakpoint itself', () => {
    // 1200 is NOT < SMALL_SCREEN_WIDTH, so it falls through to medium.
    expect(getDynamicMaxVisibleNodes(DYNAMIC_CLUSTER.SMALL_SCREEN_WIDTH)).toBe(1200);
    expect(getDynamicMaxVisibleNodes(1600)).toBe(1200);
  });

  it('returns the large budget at and above the large breakpoint', () => {
    // 1920 satisfies `>= LARGE_SCREEN_WIDTH`.
    expect(getDynamicMaxVisibleNodes(DYNAMIC_CLUSTER.LARGE_SCREEN_WIDTH)).toBe(1500);
    expect(getDynamicMaxVisibleNodes(3840)).toBe(1500);
  });

  it('pins the exact value on each side of the large breakpoint', () => {
    expect(getDynamicMaxVisibleNodes(1919)).toBe(1200);
    expect(getDynamicMaxVisibleNodes(1920)).toBe(1500);
  });
});

describe('getAutoClusterDepth', () => {
  it('returns 0 when the node count stays within the visible budget', () => {
    expect(getAutoClusterDepth(0, 1000)).toBe(0);
    expect(getAutoClusterDepth(1500, 1000)).toBe(0);
  });

  it('returns 1 above 1.5x the budget', () => {
    expect(getAutoClusterDepth(1501, 1000)).toBe(1);
    expect(getAutoClusterDepth(5000, 1000)).toBe(1);
  });

  it('returns 2 above 5x the budget', () => {
    expect(getAutoClusterDepth(5001, 1000)).toBe(2);
    expect(getAutoClusterDepth(20000, 1000)).toBe(2);
  });

  it('pins the exact thresholds as exclusive bounds', () => {
    // Both comparators are strict `>`, so landing exactly on the bound stays lower.
    expect(getAutoClusterDepth(1000 * 1.5, 1000)).toBe(0);
    expect(getAutoClusterDepth(1000 * 5, 1000)).toBe(1);
  });
});
