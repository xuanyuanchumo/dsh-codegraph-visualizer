import { describe, it, expect } from 'vitest';
import { computeSmartSpacing } from '../../src/shared/layoutUtils.ts';
import { LAYOUT } from '../../src/shared/constants.ts';

describe('computeSmartSpacing', () => {
  it('returns valid SmartSpacing for zero nodes', () => {
    const result = computeSmartSpacing(0, 800, 600);
    expect(result.nodeRepulse).toBeGreaterThan(0);
    expect(result.idealEdgeLength).toBeGreaterThan(0);
    expect(result.rankSep).toBeGreaterThanOrEqual(LAYOUT.MIN_RANK_SEP);
    expect(result.rankSep).toBeLessThanOrEqual(LAYOUT.MAX_RANK_SEP);
    expect(result.spacingFactor).toBe(LAYOUT.SMALL_SPACING_FACTOR);
  });

  it('uses small density factor for nodeCount < SMALL_NODE_THRESHOLD', () => {
    const small = computeSmartSpacing(10, 800, 600);
    const containerArea = 800 * 600;
    const areaPerNode = containerArea / 10;
    const idealSpacing = Math.sqrt(areaPerNode);
    const expectedS = Math.max(40, idealSpacing * LAYOUT.DENSITY_FACTOR_SMALL);
    expect(small.nodeRepulse).toBe(Math.min(expectedS * expectedS * 4, 20000));
    expect(small.idealEdgeLength).toBe(expectedS * 2);
  });

  it('uses medium density factor for SMALL_NODE_THRESHOLD <= nodeCount < MEDIUM_NODE_THRESHOLD', () => {
    const medium = computeSmartSpacing(100, 800, 600);
    const containerArea = 800 * 600;
    const areaPerNode = containerArea / 100;
    const idealSpacing = Math.sqrt(areaPerNode);
    const expectedS = Math.max(40, idealSpacing * LAYOUT.DENSITY_FACTOR_MEDIUM);
    expect(medium.nodeRepulse).toBe(Math.min(expectedS * expectedS * 4, 20000));
    expect(medium.idealEdgeLength).toBe(expectedS * 2);
  });

  it('uses large density factor for MEDIUM_NODE_THRESHOLD <= nodeCount < LARGE_NODE_THRESHOLD', () => {
    const large = computeSmartSpacing(300, 800, 600);
    const containerArea = 800 * 600;
    const areaPerNode = containerArea / 300;
    const idealSpacing = Math.sqrt(areaPerNode);
    const expectedS = Math.max(40, idealSpacing * LAYOUT.DENSITY_FACTOR_LARGE);
    expect(large.nodeRepulse).toBe(Math.min(expectedS * expectedS * 4, 20000));
  });

  it('uses 0.5 density factor for nodeCount >= LARGE_NODE_THRESHOLD', () => {
    const veryLarge = computeSmartSpacing(600, 800, 600);
    const containerArea = 800 * 600;
    const areaPerNode = containerArea / 600;
    const idealSpacing = Math.sqrt(areaPerNode);
    const expectedS = Math.max(40, idealSpacing * 0.5);
    expect(veryLarge.nodeRepulse).toBe(Math.min(expectedS * expectedS * 4, 20000));
  });

  it('caps nodeRepulse at 20000', () => {
    const result = computeSmartSpacing(1, 10000, 10000);
    expect(result.nodeRepulse).toBeLessThanOrEqual(20000);
  });

  it('clamps rankSep between MIN_RANK_SEP and MAX_RANK_SEP', () => {
    const tiny = computeSmartSpacing(1, 100, 100);
    expect(tiny.rankSep).toBeGreaterThanOrEqual(LAYOUT.MIN_RANK_SEP);
    expect(tiny.rankSep).toBeLessThanOrEqual(LAYOUT.MAX_RANK_SEP);
    const huge = computeSmartSpacing(10000, 100000, 100000);
    expect(huge.rankSep).toBeGreaterThanOrEqual(LAYOUT.MIN_RANK_SEP);
    expect(huge.rankSep).toBeLessThanOrEqual(LAYOUT.MAX_RANK_SEP);
  });

  it('clamps edgeSep between 15 and 40', () => {
    const tiny = computeSmartSpacing(1, 100, 100);
    expect(tiny.edgeSep).toBeGreaterThanOrEqual(15);
    expect(tiny.edgeSep).toBeLessThanOrEqual(40);
    const huge = computeSmartSpacing(10000, 100000, 100000);
    expect(huge.edgeSep).toBeGreaterThanOrEqual(15);
    expect(huge.edgeSep).toBeLessThanOrEqual(40);
  });

  it('clamps nodeSep between 20 and 40', () => {
    const tiny = computeSmartSpacing(1, 100, 100);
    expect(tiny.nodeSep).toBeGreaterThanOrEqual(20);
    expect(tiny.nodeSep).toBeLessThanOrEqual(40);
    const huge = computeSmartSpacing(10000, 100000, 100000);
    expect(huge.nodeSep).toBeGreaterThanOrEqual(20);
    expect(huge.nodeSep).toBeLessThanOrEqual(40);
  });

  it('clamps padding between 40 and 120', () => {
    const tiny = computeSmartSpacing(1, 100, 100);
    expect(tiny.padding).toBeGreaterThanOrEqual(40);
    expect(tiny.padding).toBeLessThanOrEqual(120);
    const huge = computeSmartSpacing(1, 10000, 10000);
    expect(huge.padding).toBeGreaterThanOrEqual(40);
    expect(huge.padding).toBeLessThanOrEqual(120);
  });

  it('returns SMALL_SPACING_FACTOR for nodeCount < SMALL_NODE_COUNT_THRESHOLD', () => {
    const result = computeSmartSpacing(50, 800, 600);
    expect(result.spacingFactor).toBe(LAYOUT.SMALL_SPACING_FACTOR);
  });

  it('returns MEDIUM_SPACING_FACTOR for SMALL_NODE_COUNT_THRESHOLD <= nodeCount < MEDIUM_NODE_COUNT_THRESHOLD', () => {
    const result = computeSmartSpacing(150, 800, 600);
    expect(result.spacingFactor).toBe(LAYOUT.MEDIUM_SPACING_FACTOR);
  });

  it('returns LARGE_SPACING_FACTOR for nodeCount >= MEDIUM_NODE_COUNT_THRESHOLD', () => {
    const result = computeSmartSpacing(400, 800, 600);
    expect(result.spacingFactor).toBe(LAYOUT.LARGE_SPACING_FACTOR);
  });

  it('ensures minNodeSpacing >= MIN_NODE_SPACING', () => {
    const result = computeSmartSpacing(10000, 100, 100);
    expect(result.minNodeSpacing).toBeGreaterThanOrEqual(LAYOUT.MIN_NODE_SPACING);
  });

  it('ensures minGap >= 30', () => {
    const result = computeSmartSpacing(10000, 100, 100);
    expect(result.minGap).toBeGreaterThanOrEqual(30);
  });

  it('ensures incrementalRadius >= INCREMENTAL_RADIUS_BASE', () => {
    const result = computeSmartSpacing(10000, 100, 100);
    expect(result.incrementalRadius).toBeGreaterThanOrEqual(LAYOUT.INCREMENTAL_RADIUS_BASE);
  });

  it('produces consistent results for same inputs', () => {
    const a = computeSmartSpacing(100, 800, 600);
    const b = computeSmartSpacing(100, 800, 600);
    expect(a).toEqual(b);
  });

  it('handles square containers', () => {
    const result = computeSmartSpacing(50, 800, 800);
    expect(result.padding).toBeGreaterThan(0);
    expect(result.nodeRepulse).toBeGreaterThan(0);
  });

  it('handles very wide containers', () => {
    const result = computeSmartSpacing(50, 4000, 200);
    expect(result.padding).toBeGreaterThanOrEqual(40);
    expect(result.padding).toBeLessThanOrEqual(120);
  });
});