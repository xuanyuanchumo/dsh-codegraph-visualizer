import { describe, it, expect } from 'vitest';
import {
  getMinPanelSize,
  isHostSizedIntegrationMode,
  type IntegrationMode,
} from '../../src/shared/constants.ts';

// responsive.css declares `width: 100%; height: 100%` for the host-sized modes below, so
// the panel tracks the DSH slot instead of a persisted free-float size.
const HOST_SIZED: IntegrationMode[] = [
  'conversation-view',
  'sidebar-right',
  'better-sidebar',
  'remote-web-ui',
];
const FREE_SIZED: IntegrationMode[] = ['floating', 'slot', 'unknown'];

describe('panel sizing: integration modes', () => {
  it.each(HOST_SIZED)('%s is host-sized (panel must fill the slot)', (mode) => {
    expect(isHostSizedIntegrationMode(mode)).toBe(true);
  });

  it.each(FREE_SIZED)('%s is free-sized (panel keeps its own dimensions)', (mode) => {
    expect(isHostSizedIntegrationMode(mode)).toBe(false);
  });

  it('every integration mode resolves a positive minimum size', () => {
    for (const mode of [...HOST_SIZED, ...FREE_SIZED]) {
      const { minWidth, minHeight } = getMinPanelSize(mode);
      expect(minWidth).toBeGreaterThan(0);
      expect(minHeight).toBeGreaterThan(0);
    }
  });
});
