import type cytoscape from 'cytoscape';
import type { ThemeType } from '../IRenderer.ts';

export interface ThemeColors {
  nodeDefault: string;
  nodeFunction: string;
  nodeClass: string;
  nodeVariable: string;
  nodeModule: string;
  nodeInterface: string;
  edgeDefault: string;
  edgeCall: string;
  edgeImport: string;
  edgeExtend: string;
  text: string;
  border: string;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

export function getThemeColors(theme: ThemeType): ThemeColors {
  const isDark = theme === 'dark';
  return {
    nodeDefault: readCssVar('--cg-node-default', isDark ? '#6366f1' : '#263148'),
    nodeFunction: readCssVar('--cg-node-function', isDark ? '#10b981' : '#059669'),
    nodeClass: readCssVar('--cg-node-class', isDark ? '#818cf8' : '#1a2230'),
    nodeVariable: readCssVar('--cg-node-variable', isDark ? '#f59e0b' : '#d97706'),
    nodeModule: readCssVar('--cg-node-module', isDark ? '#ec4899' : '#db2777'),
    nodeInterface: readCssVar('--cg-node-interface', isDark ? '#14b8a6' : '#0d9488'),
    edgeDefault: readCssVar('--cg-edge-default', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
    edgeCall: readCssVar('--cg-edge-call', isDark ? '#60a5fa' : '#3b82f6'),
    edgeImport: readCssVar('--cg-edge-import', isDark ? '#34d399' : '#10b981'),
    edgeExtend: readCssVar('--cg-edge-extend', isDark ? '#f472b6' : '#ec4899'),
    text: readCssVar('--cg-text', isDark ? '#f9fafb' : '#0f1115'),
    border: readCssVar('--cg-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'),
  };
}

export function buildStylesheet(theme: ThemeType, nodeCount = 0): cytoscape.StylesheetJson {
  const c = getThemeColors(theme);
  const isDark = theme === 'dark';
  const isLargeGraph = nodeCount > 200;

  const hoverBorder = readCssVar('--cg-hover-border', isDark ? '#818cf8' : '#1a2230');
  const impactD1 = readCssVar('--cg-impact-d1', '#f59e0b');
  const impactD2 = readCssVar('--cg-impact-d2', '#fbbf24');
  const impactD3 = readCssVar('--cg-impact-d3', '#fde68a');
  const inhExtend = readCssVar('--cg-inheritance-extend', isDark ? '#f472b6' : '#ec4899');
  const inhImplement = readCssVar('--cg-inheritance-implement', isDark ? '#2dd4bf' : '#14b8a6');
  const clusterBg = readCssVar('--cg-cluster-bg', isDark ? 'rgba(99,102,241,0.15)' : 'rgba(38,49,72,0.10)');
  const clusterBorder = readCssVar('--cg-cluster-border', isDark ? '#818cf8' : '#263148');
  const clusterHoverBg = readCssVar('--cg-cluster-hover-bg', isDark ? 'rgba(99,102,241,0.35)' : 'rgba(38,49,72,0.25)');
  const clusterHoverBorder = readCssVar('--cg-cluster-hover-border', isDark ? '#a5b4fc' : '#1a2230');
  const clusterEdge = readCssVar('--cg-cluster-edge', isDark ? '#818cf8' : '#263148');
  const clusterEdgeLabelBg = readCssVar('--cg-cluster-edge-label-bg', isDark ? '#232324' : '#f9fafb');
  const warningColor = readCssVar('--cg-warning', '#f59e0b');
  const errorColor = readCssVar('--cg-error', '#ef4444');
  const successColor = readCssVar('--cg-success', '#10b981');
  const accentColor = readCssVar('--cg-accent', isDark ? '#6366f1' : '#263148');

  return [
    {
      selector: 'node',
      style: {
        'background-color': c.nodeDefault,
        'label': isLargeGraph ? '' : 'data(label)',
        'font-size': '10px',
        'color': c.text,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '70px',
        'width': isLargeGraph ? 14 : 32,
        'height': isLargeGraph ? 14 : 32,
        'shape': 'ellipse',
        'border-width': isLargeGraph ? 1 : 1.5,
        'border-color': c.border,
        ...(isLargeGraph ? {} : { 'transition-property': 'background-color, border-color, border-width', 'transition-duration': 200 }),
      },
    },
    {
      selector: 'node.hovered',
      style: {
        'border-width': isLargeGraph ? 2 : 3,
        'border-color': hoverBorder,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node[weight]',
      style: {
        'width': 'mapData(weight, 1, 10, 24, 56)',
        'height': 'mapData(weight, 1, 10, 24, 56)',
      },
    },
    {
      selector: ':parent',
      style: {
        'background-color': 'rgba(0,0,0,0.05)',
        'border-width': 2,
        'border-color': c.border,
        'border-style': 'dashed',
        'label': 'data(label)',
        'font-size': '10px',
        'color': c.text,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'padding': '10px',
      },
    },
    {
      selector: 'node[type="function"]',
      style: { 'shape': 'round-triangle', 'background-color': c.nodeFunction },
    },
    {
      selector: 'node[type="class"]',
      style: { 'shape': 'rectangle', 'background-color': c.nodeClass },
    },
    {
      selector: 'node[type="variable"]',
      style: { 'shape': 'diamond', 'background-color': c.nodeVariable },
    },
    {
      selector: 'node[type="module"]',
      style: { 'shape': 'round-rectangle', 'background-color': c.nodeModule },
    },
    {
      selector: 'node[type="interface"]',
      style: { 'shape': 'hexagon', 'background-color': c.nodeInterface },
    },
    {
      selector: 'edge',
      style: {
        'width': 1,
        'line-color': c.edgeDefault,
        'target-arrow-color': c.edgeDefault,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.5,
      },
    },
    {
      selector: 'edge[type="call"]',
      style: { 'line-color': c.edgeCall, 'target-arrow-color': c.edgeCall },
    },
    {
      selector: 'edge[type="import"]',
      style: { 'line-color': c.edgeImport, 'target-arrow-color': c.edgeImport },
    },
    {
      selector: 'edge[type="extend"]',
      style: { 'line-color': c.edgeExtend, 'target-arrow-color': c.edgeExtend },
    },
    {
      selector: '.highlighted',
      style: {
        'border-width': 4,
        'border-color': warningColor,
        'z-index': 20,
      },
    },
    {
      selector: '.selected',
      style: {
        'border-width': 4,
        'border-color': errorColor,
        'z-index': 30,
      },
    },
    {
      selector: '.search-match',
      style: {
        'border-width': 3,
        'border-color': successColor,
      },
    },
    {
      selector: '.call-chain',
      style: {
        'background-color': warningColor,
        'border-width': 3,
        'border-color': warningColor,
        'opacity': 0.9,
        'z-index': 25,
      },
    },
    {
      selector: 'edge.call-chain',
      style: {
        'line-color': warningColor,
        'target-arrow-color': warningColor,
        'width': 3,
        'opacity': 1,
        'z-index': 25,
      },
    },
    {
      selector: '.cycle-highlight',
      style: {
        'border-width': 4,
        'border-color': errorColor,
        'background-color': errorColor,
      },
    },
    {
      selector: '.impact-source',
      style: {
        'border-width': 4,
        'border-color': errorColor,
        'background-color': errorColor,
        'z-index': 35,
      },
    },
    {
      selector: '.impact-d1',
      style: {
        'border-width': 3,
        'border-color': impactD1,
        'background-color': impactD1,
        'z-index': 28,
      },
    },
    {
      selector: '.impact-d2',
      style: {
        'border-width': 3,
        'border-color': impactD2,
        'background-color': impactD2,
        'opacity': 0.8,
        'z-index': 22,
      },
    },
    {
      selector: '.impact-d3',
      style: {
        'border-width': 2,
        'border-color': impactD3,
        'background-color': impactD3,
        'opacity': 0.6,
        'z-index': 18,
      },
    },
    {
      selector: '.inheritance-extend',
      style: {
        'width': 2.5,
        'line-color': inhExtend,
        'target-arrow-color': inhExtend,
        'opacity': 0.9,
        'z-index': 20,
      },
    },
    {
      selector: '.inheritance-implement',
      style: {
        'width': 2,
        'line-color': inhImplement,
        'target-arrow-color': inhImplement,
        'opacity': 0.9,
        'z-index': 20,
        'line-style': 'dashed',
      },
    },
    {
      selector: '.inheritance-highlight',
      style: {
        'border-width': 3,
        'border-color': inhExtend,
        'opacity': 1,
        'z-index': 25,
      },
    },
    {
      selector: 'edge.inheritance-highlight',
      style: {
        'width': 3,
        'opacity': 1,
        'z-index': 25,
      },
    },
    {
      selector: '.inheritance-focus',
      style: {
        'border-width': 4,
        'border-color': errorColor,
        'background-color': errorColor,
        'z-index': 35,
      },
    },
    {
      selector: '.inheritance-dim',
      style: {
        'opacity': 0.15,
      },
    },
    {
      selector: '.focus-highlight',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'opacity': 1,
        'z-index': 30,
      },
    },
    {
      selector: 'edge.focus-highlight',
      style: {
        'width': 2.5,
        'line-color': accentColor,
        'target-arrow-color': accentColor,
        'opacity': 1,
        'z-index': 30,
      },
    },
    {
      selector: '.focus-dim',
      style: {
        'opacity': 0.1,
      },
    },
    {
      selector: 'node[isCluster]',
      style: {
        'shape': 'round-rectangle',
        'background-color': clusterBg,
        'border-width': 2,
        'border-color': clusterBorder,
        'border-style': 'solid',
        'label': 'data(label)',
        'font-size': '11px',
        'font-weight': 'bold',
        'color': c.text,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '90px',
        'width': 'mapData(childCount, 1, 3000, 40, 80)',
        'height': 'mapData(childCount, 1, 3000, 40, 80)',
        'z-index': 5,
        'transition-property': 'background-color, border-color, border-width',
        'transition-duration': 200,
      },
    },
    {
      selector: 'node[isCluster].hovered',
      style: {
        'background-color': clusterHoverBg,
        'border-width': 4,
        'border-color': clusterHoverBorder,
      },
    },
    {
      selector: 'edge[isCluster]',
      style: {
        'width': 'mapData(aggregatedCount, 1, 200, 1.5, 4)',
        'line-color': clusterEdge,
        'target-arrow-color': clusterEdge,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '10px',
        'color': c.text,
        'text-rotation': 'autorotate',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'opacity': 0.75,
      },
    },
    {
      selector: 'edge[isCluster].hovered',
      style: {
        'opacity': 1,
        'width': 'mapData(aggregatedCount, 1, 200, 2.5, 6)',
      },
    },
  ];
}