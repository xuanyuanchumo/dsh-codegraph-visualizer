import type { Core, StylesheetJson } from 'cytoscape';
import type { ThemeType } from './IRenderer.ts';
import { buildStylesheet } from './styles/ThemeStylesheet.ts';

const LOD_ZOOM_THRESHOLDS = {
  minimal: 0.2,
  compact: 0.5,
  full: 1.0,
};

type LODLevel = 'minimal' | 'compact' | 'full';

export class StyleController {
  private cy: Core;
  private theme: ThemeType;
  private currentLOD: LODLevel = 'full';
  private lodEnabled = false;

  constructor(cy: Core, theme: ThemeType) {
    this.cy = cy;
    this.theme = theme;
  }

  getStylesheet(): StylesheetJson {
    const nodeCount = this.cy.nodes().length;
    return buildStylesheet(this.theme, nodeCount);
  }

  updateTheme(theme: ThemeType): void {
    this.theme = theme;
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

  private handleZoomChange = (): void => {
    const zoom = this.cy.zoom();
    const newLOD = this.computeLODLevel(zoom);
    if (newLOD !== this.currentLOD) {
      this.currentLOD = newLOD;
      this.applyStylesheet();
    }
  };

  private computeLODLevel(zoom: number): LODLevel {
    if (zoom < LOD_ZOOM_THRESHOLDS.minimal) return 'minimal';
    if (zoom < LOD_ZOOM_THRESHOLDS.compact) return 'compact';
    return 'full';
  }

  private applyStylesheet(): void {
    const baseStylesheet = this.getStylesheet();
    if (this.lodEnabled && this.currentLOD !== 'full') {
      const lodOverrides = this.getLODOverrides(this.currentLOD);
      this.cy.style().fromJson([...baseStylesheet, ...lodOverrides]).update();
    } else {
      this.cy.style().fromJson(baseStylesheet).update();
    }
  }

  private getLODOverrides(level: LODLevel): StylesheetJson {
    if (level === 'minimal') {
      return [
        {
          selector: 'node',
          style: {
            'label': '',
            'width': 8,
            'height': 8,
            'border-width': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            'label': '',
            'width': 0.5,
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
            'font-size': 6,
            'width': 16,
            'height': 16,
          },
        },
        {
          selector: 'edge',
          style: {
            'label': '',
            'width': 1,
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
