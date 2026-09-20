import type { Core, StylesheetJson } from 'cytoscape';
import type { ThemeType, HeatmapMode } from './IRenderer.ts';
import { buildStylesheet, invalidateCssVarCache } from './styles/ThemeStylesheet.ts';
import { LOD, HEATMAP } from '../../shared/constants.ts';

type LODLevel = 'minimal' | 'compact' | 'full';

interface LODThresholds {
  minimal: number;
  compact: number;
}

function getLODThresholds(nodeCount: number): LODThresholds {
  if (nodeCount < LOD.SMALL_NODE_COUNT) {
    return {
      minimal: LOD.MINIMAL_THRESHOLD_SMALL,
      compact: LOD.COMPACT_THRESHOLD_SMALL,
    };
  }
  if (nodeCount < LOD.MEDIUM_NODE_COUNT) {
    return {
      minimal: LOD.MINIMAL_THRESHOLD_MEDIUM,
      compact: LOD.COMPACT_THRESHOLD_MEDIUM,
    };
  }
  return {
    minimal: LOD.MINIMAL_THRESHOLD_LARGE,
    compact: LOD.COMPACT_THRESHOLD_LARGE,
  };
}

export class StyleController {
  private cy: Core;
  private theme: ThemeType;
  private currentLOD: LODLevel = 'full';
  private lodEnabled = false;
  private heatmapMode: HeatmapMode = 'none';
  private cachedBaseStylesheet: StylesheetJson | null = null;
  private cachedNodeCount = -1;

  constructor(cy: Core, theme: ThemeType) {
    this.cy = cy;
    this.theme = theme;
  }

  getStylesheet(): StylesheetJson {
    const nodeCount = this.cy.nodes().length;
    if (this.cachedBaseStylesheet === null || nodeCount !== this.cachedNodeCount) {
      this.cachedBaseStylesheet = buildStylesheet(this.theme, nodeCount);
      this.cachedNodeCount = nodeCount;
    }
    return this.cachedBaseStylesheet;
  }

  updateTheme(theme: ThemeType): void {
    this.theme = theme;
    this.cachedBaseStylesheet = null;
    invalidateCssVarCache();
    this.applyStylesheet();
  }

  getTheme(): ThemeType {
    return this.theme;
  }

  enableLOD(): void {
    if (this.lodEnabled) return;
    this.lodEnabled = true;
    this.currentLOD = this.computeLODLevel(this.cy.zoom());
    this.applyStylesheet();
    this.cy.on('zoom', this.handleZoomChange);
  }

  disableLOD(): void {
    if (!this.lodEnabled) return;
    this.lodEnabled = false;
    this.cy.off('zoom', this.handleZoomChange);
    this.currentLOD = 'full';
    this.applyStylesheet();
  }

  isLODEnabled(): boolean {
    return this.lodEnabled;
  }

  setHeatmapMode(mode: HeatmapMode): void {
    if (this.heatmapMode === mode) return;
    this.heatmapMode = mode;
    this.applyStylesheet();
  }

  getHeatmapMode(): HeatmapMode {
    return this.heatmapMode;
  }

  private handleZoomChange = (): void => {
    const zoom = this.cy.zoom();
    const newLOD = this.computeLODLevel(zoom);
    if (newLOD !== this.currentLOD) {
      this.currentLOD = newLOD;
      this.applyStylesheet();
    }
  };

  private computeLODLevel(zoom: number): LODLevel {
    const thresholds = getLODThresholds(this.cy.nodes().length);
    if (zoom < thresholds.minimal) return 'minimal';
    if (zoom < thresholds.compact) return 'compact';
    return 'full';
  }

  private applyStylesheet(): void {
    const baseStylesheet = this.getStylesheet();
    const transitionOverrides: StylesheetJson = [
      {
        selector: 'node',
        style: {
          'transition-property': 'width, height, font-size, border-width',
          'transition-duration': LOD.TRANSITION_DURATION_MS,
          'transition-timing-function': 'ease-out',
        },
      },
      {
        selector: 'edge',
        style: {
          'transition-property': 'width',
          'transition-duration': LOD.TRANSITION_DURATION_MS,
          'transition-timing-function': 'ease-out',
        },
      },
    ];
    const heatmapOverrides = this.getHeatmapOverrides();
    if (this.lodEnabled && this.currentLOD !== 'full') {
      const lodOverrides = this.getLODOverrides(this.currentLOD);
      this.cy.style().fromJson([...baseStylesheet, ...transitionOverrides, ...heatmapOverrides, ...lodOverrides]).update();
    } else {
      this.cy.style().fromJson([...baseStylesheet, ...transitionOverrides, ...heatmapOverrides]).update();
    }
  }

  private getHeatmapOverrides(): StylesheetJson {
    if (this.heatmapMode === 'none') return [];
    if (this.heatmapMode === 'instability') {
      return [
        {
          selector: 'node[instability]',
          style: {
            'background-color': `mapData(instability, 0, 1, ${HEATMAP.COLOR_STABLE}, ${HEATMAP.COLOR_UNSTABLE})`,
          },
        },
      ];
    }
    if (this.heatmapMode === 'lines') {
      return [
        {
          selector: 'node[linesOfCode]',
          style: {
            'background-color': `mapData(linesOfCode, ${HEATMAP.LINES_LOW}, ${HEATMAP.LINES_HIGH}, ${HEATMAP.COLOR_LOW}, ${HEATMAP.COLOR_HIGH})`,
          },
        },
      ];
    }
    if (this.heatmapMode === 'complexity') {
      return [
        {
          selector: 'node[complexity]',
          style: {
            'background-color': `mapData(complexity, ${HEATMAP.COMPLEXITY_LOW}, ${HEATMAP.COMPLEXITY_HIGH}, ${HEATMAP.COLOR_STABLE}, ${HEATMAP.COLOR_UNSTABLE})`,
          },
        },
      ];
    }
    return [];
  }

  private getLODOverrides(level: LODLevel): StylesheetJson {
    if (level === 'minimal') {
      return [
        {
          selector: 'node',
          style: {
            'label': '',
            'width': LOD.MINIMAL_NODE_SIZE,
            'height': LOD.MINIMAL_NODE_SIZE,
            'border-width': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            'label': '',
            'width': LOD.MINIMAL_EDGE_WIDTH,
          },
        },
      ];
    }
    if (level === 'compact') {
      return [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-size': LOD.COMPACT_FONT_SIZE,
            'width': LOD.COMPACT_NODE_SIZE,
            'height': LOD.COMPACT_NODE_SIZE,
          },
        },
        {
          selector: 'edge',
          style: {
            'label': '',
            'width': LOD.COMPACT_EDGE_WIDTH,
          },
        },
      ];
    }
    return [];
  }

  destroy(): void {
    this.disableLOD();
  }
}
