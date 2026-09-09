import type cytoscape from 'cytoscape';
import type { ThemeType } from '../IRenderer.ts';

export interface ThemeColors {
  nodeDefault: string;
  nodeFunction: string;
  nodeClass: string;
  nodeVariable: string;
  nodeModule: string;
  nodeInterface: string;
  nodeType: string;
  nodeDepNpm: string;
  nodeDepCargo: string;
  nodeDepGomod: string;
  nodeDepPip: string;
  edgeDefault: string;
  edgeCall: string;
  edgeImport: string;
  edgeExtend: string;
  edgeImplement: string;
  edgeDependency: string;
  edgeContains: string;
  edgeDepProd: string;
  edgeDepDev: string;
  edgeDepPeer: string;
  edgeDepOptional: string;
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
    nodeType: readCssVar('--cg-node-type', isDark ? '#a78bfa' : '#7c3aed'),
    nodeDepNpm: readCssVar('--cg-node-dep-npm', isDark ? '#cb3837' : '#cc3535'),
    nodeDepCargo: readCssVar('--cg-node-dep-cargo', isDark ? '#dea584' : '#ce422b'),
    nodeDepGomod: readCssVar('--cg-node-dep-gomod', isDark ? '#00add8' : '#007d9b'),
    nodeDepPip: readCssVar('--cg-node-dep-pip', isDark ? '#3776ab' : '#3776ab'),
    edgeDefault: readCssVar('--cg-edge-default', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
    edgeCall: readCssVar('--cg-edge-call', isDark ? '#60a5fa' : '#3b82f6'),
    edgeImport: readCssVar('--cg-edge-import', isDark ? '#34d399' : '#10b981'),
    edgeExtend: readCssVar('--cg-edge-extend', isDark ? '#f472b6' : '#ec4899'),
    edgeImplement: readCssVar('--cg-edge-implement', isDark ? '#2dd4bf' : '#0d9488'),
    edgeDependency: readCssVar('--cg-edge-dependency', isDark ? '#fbbf24' : '#f59e0b'),
    edgeContains: readCssVar('--cg-edge-contains', isDark ? '#a78bfa' : '#7c3aed'),
    edgeDepProd: readCssVar('--cg-edge-dep-prod', isDark ? '#fbbf24' : '#f59e0b'),
    edgeDepDev: readCssVar('--cg-edge-dep-dev', isDark ? '#60a5fa' : '#3b82f6'),
    edgeDepPeer: readCssVar('--cg-edge-dep-peer', isDark ? '#34d399' : '#10b981'),
    edgeDepOptional: readCssVar('--cg-edge-dep-optional', isDark ? '#a78bfa' : '#7c3aed'),
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
        'overlay-opacity': 0,
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
      selector: 'node[type="type"]',
      style: { 'shape': 'star', 'background-color': c.nodeType },
    },
    {
      selector: 'node[depType="npm"]',
      style: { 'shape': 'round-rectangle', 'background-color': c.nodeDepNpm },
    },
    {
      selector: 'node[depType="cargo"]',
      style: { 'shape': 'round-rectangle', 'background-color': c.nodeDepCargo },
    },
    {
      selector: 'node[depType="gomod"]',
      style: { 'shape': 'round-rectangle', 'background-color': c.nodeDepGomod },
    },
    {
      selector: 'node[depType="pip"]',
      style: { 'shape': 'round-rectangle', 'background-color': c.nodeDepPip },
    },
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': c.edgeDefault,
        'target-arrow-color': c.edgeDefault,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.8,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'edge[type="call"]',
      style: {
        'line-color': c.edgeCall,
        'target-arrow-color': c.edgeCall,
        'line-style': 'solid',
      },
    },
    {
      selector: 'edge[type="import"]',
      style: {
        'line-color': c.edgeImport,
        'target-arrow-color': c.edgeImport,
        'line-style': 'dashed',
      },
    },
    {
      selector: 'edge[type="extend"]',
      style: {
        'line-color': inhExtend,
        'target-arrow-color': inhExtend,
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'solid',
        'width': 2,
      },
    },
    {
      selector: 'edge[type="implement"]',
      style: {
        'line-color': inhImplement,
        'target-arrow-color': inhImplement,
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'dashed',
        'width': 2,
      },
    },
    {
      selector: 'edge[type="dependency"]',
      style: {
        'line-color': c.edgeDependency,
        'target-arrow-color': c.edgeDependency,
        'line-style': 'dashed',
      },
    },
    {
      selector: 'edge[type="dependency"][scope="prod"]',
      style: {
        'line-color': c.edgeDepProd,
        'target-arrow-color': c.edgeDepProd,
        'line-style': 'solid',
      },
    },
    {
      selector: 'edge[type="dependency"][scope="dev"]',
      style: {
        'line-color': c.edgeDepDev,
        'target-arrow-color': c.edgeDepDev,
        'line-style': 'dashed',
      },
    },
    {
      selector: 'edge[type="dependency"][scope="peer"]',
      style: {
        'line-color': c.edgeDepPeer,
        'target-arrow-color': c.edgeDepPeer,
        'line-style': 'dotted',
      },
    },
    {
      selector: 'edge[type="dependency"][scope="optional"]',
      style: {
        'line-color': c.edgeDepOptional,
        'target-arrow-color': c.edgeDepOptional,
        'line-style': 'dotted',
        'opacity': 0.6,
      },
    },
    {
      selector: 'edge[type="contains"]',
      style: {
        'line-color': c.edgeContains,
        'target-arrow-color': c.edgeContains,
        'line-style': 'dotted',
        'width': 1,
      },
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
        'opacity': 0.25,
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
        'opacity': 0.25,
      },
    },
    {
      selector: 'node[isCluster="true"]',
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
      selector: 'node[isCluster="true"].hovered',
      style: {
        'background-color': clusterHoverBg,
        'border-width': 4,
        'border-color': clusterHoverBorder,
      },
    },
    {
      selector: 'edge[isCluster="true"]',
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
      selector: 'edge[isCluster="true"].hovered',
      style: {
        'opacity': 1,
        'width': 'mapData(aggregatedCount, 1, 200, 2.5, 6)',
      },
    },
    {
      selector: '.path-highlight',
      style: {
        'border-width': 4,
        'border-color': accentColor,
        'background-color': accentColor,
        'z-index': 40,
      },
    },
    {
      selector: 'edge.path-highlight',
      style: {
        'width': 4,
        'line-color': accentColor,
        'target-arrow-color': accentColor,
        'opacity': 1,
        'z-index': 40,
      },
    },
    {
      selector: '.path-dim',
      style: {
        'opacity': 0.25,
      },
    },
    {
      selector: '.rule-violation',
      style: {
        'border-width': 4,
        'border-color': errorColor,
        'background-color': errorColor,
        'z-index': 45,
      },
    },
    {
      selector: 'edge.rule-violation',
      style: {
        'width': 4,
        'line-color': errorColor,
        'target-arrow-color': errorColor,
        'opacity': 1,
        'z-index': 45,
      },
    },
    {
      selector: '.hotspot-high',
      style: {
        'border-width': 4,
        'border-color': errorColor,
        'z-index': 35,
      },
    },
    {
      selector: '.hotspot-medium',
      style: {
        'border-width': 3,
        'border-color': warningColor,
        'z-index': 28,
      },
    },
    {
      selector: 'node[isRoot="true"]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'font-weight': 'bold',
        'z-index': 15,
      },
    },
    {
      selector: 'node[isEntry="true"]',
      style: {
        'border-width': 3,
        'border-color': successColor,
        'font-weight': 'bold',
        'z-index': 15,
      },
    },
    {
      selector: 'node[isRecursive="true"]',
      style: {
        'border-width': 3,
        'border-color': errorColor,
        'border-style': 'double',
      },
    },
    {
      selector: 'node[entryType="handler"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': successColor,
      },
    },
    {
      selector: 'node[entryType="test"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': warningColor,
      },
    },
    {
      selector: 'node[entryType="export"]',
      style: {
        'border-style': 'double',
        'border-width': 3,
      },
    },
    {
      selector: 'edge[type="extend"][lineStyle="uml"]',
      style: {
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'solid',
        'width': 2,
      },
    },
    {
      selector: 'edge[type="implement"][lineStyle="uml"]',
      style: {
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'dashed',
        'width': 2,
      },
    },
    {
      selector: 'node[isPackage="true"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': readCssVar('--cg-node-package', isDark ? '#6366f1' : '#263148'),
        'border-width': 2,
        'border-color': readCssVar('--cg-package-border', isDark ? '#818cf8' : '#1a2230'),
        'label': 'data(label)',
        'font-size': '11px',
        'font-weight': 'bold',
        'color': c.text,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '80px',
        'width': 'mapData(childCount, 1, 50, 30, 60)',
        'height': 'mapData(childCount, 1, 50, 30, 60)',
        'z-index': 10,
      },
    },
    {
      selector: 'node[isPackage="true"].hovered',
      style: {
        'border-width': 4,
        'border-color': hoverBorder,
      },
    },
    {
      selector: 'edge[isPackageEdge="true"]',
      style: {
        'width': 'mapData(aggregatedCount, 1, 50, 1.5, 5)',
        'line-color': readCssVar('--cg-edge-package', isDark ? '#818cf8' : '#263148'),
        'target-arrow-color': readCssVar('--cg-edge-package', isDark ? '#818cf8' : '#263148'),
        'target-arrow-shape': 'vee',
        'line-style': 'dashed',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '9px',
        'color': c.text,
        'text-rotation': 'autorotate',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'opacity': 0.8,
      },
    },
    {
      selector: 'node[isAbstract="true"]',
      style: {
        'border-style': 'double',
        'border-width': 3,
        'font-style': 'italic',
      },
    },
    {
      selector: 'node[methodCount]',
      style: {
        'shape': 'rectangle',
        'label': 'data(label)',
        'font-size': '10px',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': 'mapData(methodCount, 0, 20, 40, 80)',
        'height': 'mapData(methodCount, 0, 20, 30, 60)',
      },
    },
    {
      selector: 'node[isRoot="true"][parentCount="0"]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'font-weight': 'bold',
      },
    },
    {
      selector: 'node[blockType="entry"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': successColor,
        'border-width': 3,
        'border-color': successColor,
        'font-weight': 'bold',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'node[blockType="exit"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': errorColor,
        'border-width': 3,
        'border-color': errorColor,
        'font-weight': 'bold',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'node[blockType="condition"]',
      style: {
        'shape': 'diamond',
        'background-color': warningColor,
        'border-width': 2,
        'border-color': warningColor,
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '60px',
      },
    },
    {
      selector: 'node[blockType="loop"]',
      style: {
        'shape': 'diamond',
        'background-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'border-width': 2,
        'border-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '60px',
      },
    },
    {
      selector: 'node[blockType="switch"]',
      style: {
        'shape': 'diamond',
        'background-color': readCssVar('--cg-cfg-switch', isDark ? '#f472b6' : '#ec4899'),
        'border-width': 2,
        'border-color': readCssVar('--cg-cfg-switch', isDark ? '#f472b6' : '#ec4899'),
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'node[blockType="try"]',
      style: {
        'shape': 'rectangle',
        'background-color': readCssVar('--cg-cfg-try', isDark ? '#60a5fa' : '#3b82f6'),
        'border-width': 2,
        'border-color': readCssVar('--cg-cfg-try', isDark ? '#60a5fa' : '#3b82f6'),
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[blockType="catch"]',
      style: {
        'shape': 'rectangle',
        'background-color': errorColor,
        'border-width': 2,
        'border-color': errorColor,
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[blockType="finally"]',
      style: {
        'shape': 'rectangle',
        'background-color': readCssVar('--cg-cfg-finally', isDark ? '#34d399' : '#10b981'),
        'border-width': 2,
        'border-color': readCssVar('--cg-cfg-finally', isDark ? '#34d399' : '#10b981'),
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[blockType="process"]',
      style: {
        'shape': 'rectangle',
        'background-color': readCssVar('--cg-cfg-process', isDark ? '#60a5fa' : '#3b82f6'),
        'border-width': 1.5,
        'border-color': c.border,
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '80px',
      },
    },
    {
      selector: 'edge[cfgEdgeType="fallthrough"]',
      style: {
        'line-color': c.edgeDefault,
        'target-arrow-color': c.edgeDefault,
        'line-style': 'solid',
        'width': 1.5,
      },
    },
    {
      selector: 'edge[cfgEdgeType="true"]',
      style: {
        'line-color': successColor,
        'target-arrow-color': successColor,
        'line-style': 'solid',
        'width': 2,
        'label': 'data(label)',
        'font-size': '9px',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge[cfgEdgeType="false"]',
      style: {
        'line-color': errorColor,
        'target-arrow-color': errorColor,
        'line-style': 'solid',
        'width': 2,
        'label': 'data(label)',
        'font-size': '9px',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge[cfgEdgeType="loop-back"]',
      style: {
        'line-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'target-arrow-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'line-style': 'dashed',
        'width': 2,
        'curve-style': 'bezier',
      },
    },
    {
      selector: 'edge[cfgEdgeType="exception"]',
      style: {
        'line-color': warningColor,
        'target-arrow-color': warningColor,
        'line-style': 'dashed',
        'width': 2,
      },
    },
    {
      selector: 'edge[cfgEdgeType="case"]',
      style: {
        'line-color': readCssVar('--cg-cfg-switch', isDark ? '#f472b6' : '#ec4899'),
        'target-arrow-color': readCssVar('--cg-cfg-switch', isDark ? '#f472b6' : '#ec4899'),
        'line-style': 'solid',
        'label': 'data(label)',
        'font-size': '9px',
      },
    },
    {
      selector: 'edge[cfgEdgeType="default"]',
      style: {
        'line-color': c.edgeDefault,
        'target-arrow-color': c.edgeDefault,
        'line-style': 'dotted',
        'label': 'data(label)',
        'font-size': '9px',
      },
    },
    {
      selector: 'node[flowchartNodeType="start"]',
      style: {
        'shape': 'ellipse',
        'background-color': successColor,
        'border-width': 3,
        'border-color': successColor,
        'font-weight': 'bold',
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[flowchartNodeType="end"]',
      style: {
        'shape': 'ellipse',
        'background-color': errorColor,
        'border-width': 3,
        'border-color': errorColor,
        'font-weight': 'bold',
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[flowchartNodeType="decision"]',
      style: {
        'shape': 'diamond',
        'background-color': warningColor,
        'border-width': 2,
        'border-color': warningColor,
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '60px',
      },
    },
    {
      selector: 'node[flowchartNodeType="loop"]',
      style: {
        'shape': 'hexagon',
        'background-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'border-width': 2,
        'border-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '60px',
      },
    },
    {
      selector: 'node[flowchartNodeType="subprocess"]',
      style: {
        'shape': 'rectangle',
        'background-color': readCssVar('--cg-cfg-subprocess', isDark ? '#fbbf24' : '#f59e0b'),
        'border-width': 3,
        'border-style': 'double',
        'border-color': readCssVar('--cg-cfg-subprocess', isDark ? '#fbbf24' : '#f59e0b'),
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[flowchartNodeType="error"]',
      style: {
        'shape': 'rectangle',
        'background-color': errorColor,
        'border-width': 2,
        'border-color': errorColor,
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[flowchartNodeType="process"]',
      style: {
        'shape': 'rectangle',
        'background-color': readCssVar('--cg-cfg-process', isDark ? '#60a5fa' : '#3b82f6'),
        'border-width': 1.5,
        'border-color': c.border,
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '80px',
      },
    },
    {
      selector: 'edge[flowchartEdgeType="normal"]',
      style: {
        'line-color': c.edgeDefault,
        'target-arrow-color': c.edgeDefault,
        'line-style': 'solid',
        'width': 1.5,
      },
    },
    {
      selector: 'edge[flowchartEdgeType="yes"]',
      style: {
        'line-color': successColor,
        'target-arrow-color': successColor,
        'line-style': 'solid',
        'width': 2,
        'label': 'data(label)',
        'font-size': '9px',
      },
    },
    {
      selector: 'edge[flowchartEdgeType="no"]',
      style: {
        'line-color': errorColor,
        'target-arrow-color': errorColor,
        'line-style': 'solid',
        'width': 2,
        'label': 'data(label)',
        'font-size': '9px',
      },
    },
    {
      selector: 'edge[flowchartEdgeType="loop"]',
      style: {
        'line-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'target-arrow-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
        'line-style': 'dashed',
        'width': 2,
      },
    },
    {
      selector: 'edge[flowchartEdgeType="error"]',
      style: {
        'line-color': errorColor,
        'target-arrow-color': errorColor,
        'line-style': 'dashed',
        'width': 2,
      },
    },
    {
      selector: 'node[participantType="self"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': accentColor,
        'border-width': 2,
        'border-color': accentColor,
        'font-weight': 'bold',
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[participantType="class"]',
      style: {
        'shape': 'rectangle',
        'background-color': c.nodeClass,
        'border-width': 2,
        'border-color': c.nodeClass,
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[participantType="external"]',
      style: {
        'shape': 'rectangle',
        'background-color': readCssVar('--cg-seq-external', isDark ? '#ec4899' : '#db2777'),
        'border-width': 2,
        'border-color': readCssVar('--cg-seq-external', isDark ? '#ec4899' : '#db2777'),
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[participantType="instance"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': c.nodeFunction,
        'border-width': 1.5,
        'border-color': c.nodeFunction,
        'label': 'data(label)',
      },
    },
    {
      selector: 'node[isFragment="true"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': 'rgba(0,0,0,0.03)',
        'border-width': 2,
        'border-color': readCssVar('--cg-seq-fragment', isDark ? '#818cf8' : '#263148'),
        'border-style': 'dashed',
        'label': 'data(label)',
        'font-size': '9px',
        'font-weight': 'bold',
        'color': c.text,
        'text-valign': 'top',
        'text-halign': 'left',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': 40,
        'height': 20,
        'z-index': 5,
      },
    },
    {
      selector: 'node[fragmentType="alt"]',
      style: {
        'border-color': warningColor,
      },
    },
    {
      selector: 'node[fragmentType="loop"]',
      style: {
        'border-color': readCssVar('--cg-cfg-loop', isDark ? '#a78bfa' : '#7c3aed'),
      },
    },
    {
      selector: 'node[fragmentType="break"]',
      style: {
        'border-color': errorColor,
        'border-style': 'solid',
      },
    },
    {
      selector: 'node[fragmentType="critical"]',
      style: {
        'border-width': 3,
        'border-style': 'solid',
      },
    },
    {
      selector: 'edge[isAsync="true"]',
      style: {
        'line-style': 'dashed',
        'line-color': readCssVar('--cg-seq-async', isDark ? '#fbbf24' : '#f59e0b'),
        'target-arrow-color': readCssVar('--cg-seq-async', isDark ? '#fbbf24' : '#f59e0b'),
        'target-arrow-shape': 'vee',
        'label': 'data(label)',
        'font-size': '9px',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge[isReturn="true"]',
      style: {
        'line-style': 'dotted',
        'line-color': c.edgeDefault,
        'target-arrow-color': c.edgeDefault,
        'target-arrow-shape': 'vee',
        'label': 'data(label)',
        'font-size': '9px',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge[isSelfCall="true"]',
      style: {
        'curve-style': 'bezier',
        'line-color': accentColor,
        'target-arrow-color': accentColor,
        'label': 'data(label)',
        'font-size': '9px',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
        'text-background-shape': 'roundrectangle',
      },
    },

    // ===== UML Inheritance Diagram =====
    {
      selector: 'node[diagramType="inheritance"]',
      style: {
        'shape': 'rectangle',
        'label': 'data(umlLabel)',
        'font-size': '10px',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '120px',
        'width': 'mapData(descendantCount, 0, 50, 40, 80)',
        'height': 'mapData(childCount, 0, 20, 30, 60)',
        'border-width': 2,
        'border-color': c.border,
      },
    },
    {
      selector: 'node[diagramType="inheritance"][type="interface"]',
      style: {
        'background-color': c.nodeInterface,
        'border-style': 'solid',
      },
    },
    {
      selector: 'node[diagramType="inheritance"][type="class"]',
      style: {
        'background-color': c.nodeClass,
      },
    },
    {
      selector: 'node[diagramType="inheritance"][isRoot="true"]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'font-weight': 'bold',
      },
    },
    {
      selector: 'node[diagramType="inheritance"][isAbstract="true"]',
      style: {
        'border-style': 'double',
        'border-width': 3,
        'font-style': 'italic',
      },
    },
    {
      selector: 'edge[diagramType="inheritance"][type="extend"]',
      style: {
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'solid',
        'width': 2,
        'line-color': inhExtend,
        'target-arrow-color': inhExtend,
      },
    },
    {
      selector: 'edge[diagramType="inheritance"][type="implement"]',
      style: {
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'dashed',
        'width': 2,
        'line-color': inhImplement,
        'target-arrow-color': inhImplement,
      },
    },

    // ===== UML Class Diagram =====
    {
      selector: 'node[diagramType="class"]',
      style: {
        'shape': 'rectangle',
        'label': 'data(umlLabel)',
        'font-size': '9px',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '140px',
        'width': 'mapData(methodCount, 0, 20, 60, 120)',
        'height': 'mapData(methodCount, 0, 20, 50, 100)',
        'border-width': 2,
        'border-color': c.border,
        'padding': '4px',
      },
    },
    {
      selector: 'node[diagramType="class"][type="interface"]',
      style: {
        'background-color': c.nodeInterface,
      },
    },
    {
      selector: 'node[diagramType="class"][type="class"]',
      style: {
        'background-color': c.nodeClass,
      },
    },
    {
      selector: 'node[diagramType="class"][isAbstract="true"]',
      style: {
        'border-style': 'double',
        'border-width': 3,
        'font-style': 'italic',
      },
    },
    {
      selector: 'node[diagramType="class"][isRoot="true"]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
      },
    },
    {
      selector: 'edge[diagramType="class"][type="extend"]',
      style: {
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'solid',
        'width': 2,
        'line-color': inhExtend,
        'target-arrow-color': inhExtend,
      },
    },
    {
      selector: 'edge[diagramType="class"][type="implement"]',
      style: {
        'target-arrow-shape': 'triangle-tee',
        'line-style': 'dashed',
        'width': 2,
        'line-color': inhImplement,
        'target-arrow-color': inhImplement,
      },
    },

    // ===== UML Package Diagram =====
    {
      selector: 'node[diagramType="package"]',
      style: {
        'shape': 'round-rectangle',
        'label': 'data(umlLabel)',
        'font-size': '10px',
        'font-weight': 'bold',
        'color': c.text,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'background-color': readCssVar('--cg-node-package', isDark ? '#6366f1' : '#263148'),
        'border-width': 2,
        'border-color': readCssVar('--cg-package-border', isDark ? '#818cf8' : '#1a2230'),
        'border-style': 'solid',
        'width': 'mapData(childCount, 1, 50, 50, 100)',
        'height': 'mapData(childCount, 1, 50, 40, 80)',
        'z-index': 10,
      },
    },
    {
      selector: 'node[diagramType="package"][isRoot="true"]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
      },
    },
    {
      selector: 'node[diagramType="package"].hovered',
      style: {
        'border-width': 4,
        'border-color': hoverBorder,
      },
    },
    {
      selector: 'edge[diagramType="package"]',
      style: {
        'width': 'mapData(aggregatedCount, 1, 50, 1.5, 5)',
        'line-color': readCssVar('--cg-edge-package', isDark ? '#818cf8' : '#263148'),
        'target-arrow-color': readCssVar('--cg-edge-package', isDark ? '#818cf8' : '#263148'),
        'target-arrow-shape': 'vee',
        'line-style': 'dashed',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '9px',
        'color': c.text,
        'text-rotation': 'autorotate',
        'text-background-color': clusterEdgeLabelBg,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'opacity': 0.8,
      },
    },

    // ===== Call Graph Diagram =====
    {
      selector: 'node[diagramType="callgraph"]',
      style: {
        'shape': 'round-rectangle',
        'label': 'data(umlLabel)',
        'font-size': '10px',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '100px',
        'width': 'mapData(outDegree, 0, 20, 30, 60)',
        'height': 'mapData(outDegree, 0, 20, 25, 50)',
        'border-width': 2,
        'border-color': c.border,
      },
    },
    {
      selector: 'node[diagramType="callgraph"][isEntry="true"]',
      style: {
        'border-width': 3,
        'border-color': successColor,
        'font-weight': 'bold',
        'background-color': successColor,
      },
    },
    {
      selector: 'node[diagramType="callgraph"][entryType="handler"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': successColor,
      },
    },
    {
      selector: 'node[diagramType="callgraph"][entryType="test"]',
      style: {
        'shape': 'round-rectangle',
        'background-color': warningColor,
      },
    },
    {
      selector: 'node[diagramType="callgraph"][entryType="export"]',
      style: {
        'border-style': 'double',
        'border-width': 3,
      },
    },
    {
      selector: 'node[diagramType="callgraph"][isRecursive="true"]',
      style: {
        'border-width': 3,
        'border-color': errorColor,
        'border-style': 'double',
      },
    },
    {
      selector: 'edge[diagramType="callgraph"]',
      style: {
        'line-color': c.edgeCall,
        'target-arrow-color': c.edgeCall,
        'target-arrow-shape': 'triangle',
        'line-style': 'solid',
        'width': 1.5,
        'curve-style': 'bezier',
      },
    },
  ];
}