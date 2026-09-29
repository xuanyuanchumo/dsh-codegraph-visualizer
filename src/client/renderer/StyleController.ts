import type { Core, StylesheetJson } from 'cytoscape';
import type { ThemeType } from './IRenderer.ts';
import type { HeatmapMode, TodoMarkerMode } from '../../types/index.ts';
import { buildStylesheet, invalidateCssVarCache } from './styles/ThemeStylesheet.ts';
import { LOD, HEATMAP, TODO_MARKER } from '../../shared/constants.ts';
import { assertNever } from '../../shared/assertNever.ts';

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

function getLODClassStyles(): StylesheetJson {
  return [
    {
      selector: 'node.lod-minimal',
      style: {
        'label': '',
        'width': LOD.MINIMAL_NODE_SIZE,
        'height': LOD.MINIMAL_NODE_SIZE,
        'border-width': 0,
      },
    },
    {
      selector: 'edge.lod-minimal',
      style: {
        'label': '',
        'width': LOD.MINIMAL_EDGE_WIDTH,
        'curve-style': 'straight',
        'line-opacity': 0.3,
      },
    },
    {
      selector: 'node.lod-compact',
      style: {
        'label': 'data(label)',
        'font-size': LOD.COMPACT_FONT_SIZE,
        'width': LOD.COMPACT_NODE_SIZE,
        'height': LOD.COMPACT_NODE_SIZE,
      },
    },
    {
      selector: 'edge.lod-compact',
      style: {
        'label': '',
        'width': LOD.COMPACT_EDGE_WIDTH,
        'curve-style': 'straight',
      },
    },
  ];
}

export class StyleController {
  private cy: Core;
  private theme: ThemeType;
  private currentLOD: LODLevel = 'full';
  private lodEnabled = false;
  private heatmapMode: HeatmapMode = 'none';
  private todoMarkerMode: TodoMarkerMode = 'none';
  private cachedBaseStylesheet: StylesheetJson | null = null;
  private cachedNodeCount = -1;
  private stylesheetApplied = false;

  constructor(cy: Core, theme: ThemeType) {
    this.cy = cy;
    this.theme = theme;
  }

  getStylesheet(): StylesheetJson {
    const nodeCount = this.cy.nodes().length;
    if (this.cachedBaseStylesheet === null || nodeCount !== this.cachedNodeCount) {
      this.cachedBaseStylesheet = buildStylesheet(this.theme, nodeCount);
      this.cachedNodeCount = nodeCount;
      this.stylesheetApplied = false;
    }
    return this.cachedBaseStylesheet;
  }

  updateTheme(theme: ThemeType): void {
    this.theme = theme;
    this.cachedBaseStylesheet = null;
    invalidateCssVarCache();
    this.stylesheetApplied = false;
    this.applyStylesheet();
  }

  getTheme(): ThemeType {
    return this.theme;
  }

  enableLOD(): void {
    if (this.lodEnabled) return;
    this.lodEnabled = true;
    this.currentLOD = this.computeLODLevel(this.cy.zoom());
    this.applyLODClasses();
    this.cy.on('zoom', this.handleZoomChange);
  }

  disableLOD(): void {
    if (!this.lodEnabled) return;
    this.lodEnabled = false;
    this.cy.off('zoom', this.handleZoomChange);
    this.currentLOD = 'full';
    this.applyLODClasses();
  }

  isLODEnabled(): boolean {
    return this.lodEnabled;
  }

  setHeatmapMode(mode: HeatmapMode): void {
    if (this.heatmapMode === mode) return;
    this.heatmapMode = mode;
    this.stylesheetApplied = false;
    this.applyStylesheet();
  }

  getHeatmapMode(): HeatmapMode {
    return this.heatmapMode;
  }

  setTodoMarkerMode(mode: TodoMarkerMode): void {
    if (this.todoMarkerMode === mode) return;
    this.todoMarkerMode = mode;
    this.stylesheetApplied = false;
    this.applyStylesheet();
  }

  getTodoMarkerMode(): TodoMarkerMode {
    return this.todoMarkerMode;
  }

  private sizeMetric: string | null = null;
  private colorMetric: string | null = null;

  setMultiDimensionMapping(sizeMetric: string | null, colorMetric: string | null): void {
    this.sizeMetric = sizeMetric;
    this.colorMetric = colorMetric;
    this.stylesheetApplied = false;
    this.applyStylesheet();
  }

  getMultiDimensionMapping(): { sizeMetric: string | null; colorMetric: string | null } {
    return { sizeMetric: this.sizeMetric, colorMetric: this.colorMetric };
  }

  private handleZoomChange = (): void => {
    const zoom = this.cy.zoom();
    const newLOD = this.computeLODLevel(zoom);
    if (newLOD !== this.currentLOD) {
      this.currentLOD = newLOD;
      this.applyLODClasses();
    }
  };

  private computeLODLevel(zoom: number): LODLevel {
    const thresholds = getLODThresholds(this.cy.nodes().length);
    if (zoom < thresholds.minimal) return 'minimal';
    if (zoom < thresholds.compact) return 'compact';
    return 'full';
  }

  private applyStylesheet(): void {
    if (this.stylesheetApplied) return;
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
    const multiDimOverrides = this.getMultiDimensionOverrides();
    const todoMarkerOverrides = this.getTodoMarkerOverrides();
    const lodClassStyles = getLODClassStyles();
    this.cy.style().fromJson([...baseStylesheet, ...transitionOverrides, ...heatmapOverrides, ...multiDimOverrides, ...todoMarkerOverrides, ...lodClassStyles]).update();
    this.stylesheetApplied = true;
    if (this.lodEnabled) {
      this.applyLODClasses();
    }
  }

  private getMultiDimensionOverrides(): StylesheetJson {
    if (!this.sizeMetric && !this.colorMetric) return [];
    const overrides: StylesheetJson = [];
    if (this.sizeMetric) {
      overrides.push({
        selector: `node[${this.sizeMetric}]`,
        style: {
          'width': `mapData(${this.sizeMetric}, 0, 100, 16, 64)`,
          'height': `mapData(${this.sizeMetric}, 0, 100, 16, 64)`,
        },
      });
    }
    if (this.colorMetric) {
      overrides.push({
        selector: `node[${this.colorMetric}]`,
        style: {
          'background-color': `mapData(${this.colorMetric}, 0, 100, ${HEATMAP.COLOR_STABLE}, ${HEATMAP.COLOR_UNSTABLE})`,
        },
      });
    }
    return overrides;
  }

  private applyLODClasses(): void {
    const targetClass = this.lodEnabled ? this.currentLOD : 'full';
    if (targetClass === 'full') {
      this.cy.batch(() => {
        this.cy.nodes().removeClass('lod-minimal lod-compact');
        this.cy.edges().removeClass('lod-minimal lod-compact');
      });
      return;
    }
    const otherClass = targetClass === 'minimal' ? 'lod-compact' : 'lod-minimal';
    this.cy.batch(() => {
      this.cy.nodes().removeClass(otherClass).addClass(`lod-${targetClass}`);
      this.cy.edges().removeClass(otherClass).addClass(`lod-${targetClass}`);
    });
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
    return assertNever(this.heatmapMode);
  }

  private getTodoMarkerOverrides(): StylesheetJson {
    if (this.todoMarkerMode === 'none') return [];
    const overrides: StylesheetJson = [];
    if (this.todoMarkerMode === 'todo' || this.todoMarkerMode === 'all') {
      overrides.push({
        selector: 'node[hasTodoFixme]',
        style: {
          'border-width': TODO_MARKER.BORDER_WIDTH,
          'border-style': TODO_MARKER.BORDER_STYLE,
          'border-color': TODO_MARKER.COLOR_TODO,
        },
      });
    }
    if (this.todoMarkerMode === 'fixme' || this.todoMarkerMode === 'all') {
      overrides.push({
        selector: 'node[fixmeCount]',
        style: {
          'border-width': TODO_MARKER.BORDER_WIDTH,
          'border-style': TODO_MARKER.BORDER_STYLE,
          'border-color': TODO_MARKER.COLOR_FIXME,
        },
      });
    }
    if (this.todoMarkerMode === 'all') {
      overrides.push({
        selector: 'node[todoCount]',
        style: {
          'border-width': TODO_MARKER.BORDER_WIDTH,
          'border-style': TODO_MARKER.BORDER_STYLE,
          'border-color': TODO_MARKER.COLOR_BOTH,
        },
      });
    }
    return overrides;
  }

  destroy(): void {
    this.disableLOD();
  }
}
