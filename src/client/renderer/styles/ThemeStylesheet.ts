import type cytoscape from 'cytoscape';
import type { ThemeType } from '../IRenderer.ts';
import { buildDiagramStyles, type StyleContext } from './diagramStyles.ts';
import { LAYOUT, LOD, COLORS } from '../../../shared/constants.ts';
import { DIFF_STATUS_CLASS } from '../../../shared/diffStatus.ts';
import { type ThemeColors, readCssVar, readCssVarCached } from './styleUtils.ts';
import { LAYER_COLORS, getLayerColor } from '../../../shared/layerUtils.ts';

export { type ThemeColors, readCssVar, readCssVarCached, invalidateCssVarCache } from './styleUtils.ts';

/**
 * diff 三态节点样式（研究报告 §六 #13）。
 *
 * 独立成函数而不是内联进 `buildStylesheet` 的返回数组：选择器必须由
 * `DIFF_STATUS_CLASS` 拼出来（见调用点的说明），而内联写法会让「用常量」这件事
 * 在视觉上被淹没在一百多条规则里，下一个人很容易顺手写成裸字面量。
 */
function DIFF_NODE_STYLES(isDark: boolean, isLargeGraph: boolean): cytoscape.StylesheetJson {
  const success = readCssVarCached('--cg-success', isDark ? '#34d399' : '#10b981');
  const warning = readCssVarCached('--cg-warning', isDark ? '#fbbf24' : '#f59e0b');
  const error = readCssVarCached('--cg-error', isDark ? '#f87171' : '#ef4444');
  const borderWidth = isLargeGraph ? 3 : 4;
  return [
    {
      selector: `node.${DIFF_STATUS_CLASS.added}`,
      style: { 'border-color': success, 'border-width': borderWidth, 'border-style': 'solid' },
    },
    {
      selector: `node.${DIFF_STATUS_CLASS.modified}`,
      style: { 'border-color': warning, 'border-width': borderWidth, 'border-style': 'dashed' },
    },
    {
      selector: `node.${DIFF_STATUS_CLASS.removed}`,
      style: { 'border-color': error, 'border-width': borderWidth, 'border-style': 'double', 'opacity': 0.75 },
    },
  ];
}

/** diff 三态边样式；颜色语义与节点一致（绿=新增 / 琥珀=修改 / 红=删除）。 */
function DIFF_EDGE_STYLES(isDark: boolean): cytoscape.StylesheetJson {
  const success = readCssVarCached('--cg-success', isDark ? '#34d399' : '#10b981');
  const warning = readCssVarCached('--cg-warning', isDark ? '#fbbf24' : '#f59e0b');
  const error = readCssVarCached('--cg-error', isDark ? '#f87171' : '#ef4444');
  return [
    {
      selector: `edge.${DIFF_STATUS_CLASS.added}`,
      style: { 'line-color': success, 'target-arrow-color': success, 'width': 2.5, 'opacity': 1 },
    },
    {
      selector: `edge.${DIFF_STATUS_CLASS.modified}`,
      style: { 'line-color': warning, 'target-arrow-color': warning, 'line-style': 'dashed', 'width': 2.5, 'opacity': 1 },
    },
    {
      selector: `edge.${DIFF_STATUS_CLASS.removed}`,
      style: { 'line-color': error, 'target-arrow-color': error, 'line-style': 'dotted', 'width': 2, 'opacity': 0.6 },
    },
  ];
}

export function getThemeColors(theme: ThemeType): ThemeColors {
  const isDark = theme === 'dark';
  return {
    nodeDefault: readCssVarCached('--cg-node-default', isDark ? '#6366f1' : COLORS.PACKAGE_LIGHT),
    nodeFunction: readCssVarCached('--cg-node-function', isDark ? '#10b981' : '#059669'),
    nodeClass: readCssVarCached('--cg-node-class', isDark ? '#818cf8' : '#1a2230'),
    nodeVariable: readCssVarCached('--cg-node-variable', isDark ? '#f59e0b' : '#d97706'),
    nodeModule: readCssVarCached('--cg-node-module', isDark ? '#ec4899' : '#db2777'),
    nodeInterface: readCssVarCached('--cg-node-interface', isDark ? '#14b8a6' : '#0d9488'),
    nodeType: readCssVarCached('--cg-node-type', isDark ? '#a78bfa' : '#7c3aed'),
    nodeDepNpm: readCssVarCached('--cg-node-dep-npm', isDark ? '#cb3837' : '#cc3535'),
    nodeDepCargo: readCssVarCached('--cg-node-dep-cargo', isDark ? '#dea584' : '#ce422b'),
    nodeDepGomod: readCssVarCached('--cg-node-dep-gomod', isDark ? '#00add8' : '#007d9b'),
    nodeDepPip: readCssVarCached('--cg-node-dep-pip', isDark ? '#3776ab' : '#3776ab'),
    edgeDefault: readCssVarCached('--cg-edge-default', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
    edgeCall: readCssVarCached('--cg-edge-call', isDark ? '#60a5fa' : '#3b82f6'),
    edgeImport: readCssVarCached('--cg-edge-import', isDark ? '#34d399' : '#10b981'),
    edgeExtend: readCssVarCached('--cg-edge-extend', isDark ? '#f472b6' : '#ec4899'),
    edgeImplement: readCssVarCached('--cg-edge-implement', isDark ? '#2dd4bf' : '#0d9488'),
    edgeDependency: readCssVarCached('--cg-edge-dependency', isDark ? '#fbbf24' : '#f59e0b'),
    edgeContains: readCssVarCached('--cg-edge-contains', isDark ? '#a78bfa' : '#7c3aed'),
    edgeDepProd: readCssVarCached('--cg-edge-dep-prod', isDark ? '#fbbf24' : '#f59e0b'),
    edgeDepDev: readCssVarCached('--cg-edge-dep-dev', isDark ? '#60a5fa' : '#3b82f6'),
    edgeDepPeer: readCssVarCached('--cg-edge-dep-peer', isDark ? '#34d399' : '#10b981'),
    edgeDepOptional: readCssVarCached('--cg-edge-dep-optional', isDark ? '#a78bfa' : '#7c3aed'),
    text: readCssVarCached('--cg-text', isDark ? '#f9fafb' : '#0f1115'),
    border: readCssVarCached('--cg-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'),
  };
}

export function buildStylesheet(theme: ThemeType, nodeCount = 0): cytoscape.StylesheetJson {
  const c = getThemeColors(theme);
  const isDark = theme === 'dark';
  const isLargeGraph = nodeCount > LAYOUT.MEDIUM_NODE_THRESHOLD;

  const hoverBorder = readCssVarCached('--cg-hover-border', isDark ? '#818cf8' : '#1a2230');
  const impactD1 = readCssVarCached('--cg-impact-d1', '#f59e0b');
  const impactD2 = readCssVarCached('--cg-impact-d2', '#fbbf24');
  const impactD3 = readCssVarCached('--cg-impact-d3', '#fde68a');
  const inhExtend = readCssVarCached('--cg-inheritance-extend', isDark ? '#f472b6' : '#ec4899');
  const inhImplement = readCssVarCached('--cg-inheritance-implement', isDark ? '#2dd4bf' : '#14b8a6');
  const clusterBg = readCssVarCached('--cg-cluster-bg', isDark ? 'rgba(99,102,241,0.15)' : 'rgba(38,49,72,0.10)');
  const clusterBorder = readCssVarCached('--cg-cluster-border', isDark ? '#818cf8' : COLORS.PACKAGE_LIGHT);
  const clusterHoverBg = readCssVarCached('--cg-cluster-hover-bg', isDark ? 'rgba(99,102,241,0.35)' : 'rgba(38,49,72,0.25)');
  const clusterHoverBorder = readCssVarCached('--cg-cluster-hover-border', isDark ? '#a5b4fc' : '#1a2230');
  const clusterEdge = readCssVarCached('--cg-cluster-edge', isDark ? '#818cf8' : COLORS.PACKAGE_LIGHT);
  const clusterEdgeLabelBg = readCssVarCached('--cg-cluster-edge-label-bg', isDark ? COLORS.PACKAGE_DARK : '#f9fafb');
  const warningColor = readCssVarCached('--cg-warning', '#f59e0b');
  const errorColor = readCssVarCached('--cg-error', '#ef4444');
  const successColor = readCssVarCached('--cg-success', '#10b981');
  const accentColor = readCssVarCached('--cg-accent', isDark ? '#6366f1' : COLORS.PACKAGE_LIGHT);

  const ctx: StyleContext = {
    c,
    isDark,
    isLargeGraph,
    hoverBorder,
    impactD1,
    impactD2,
    impactD3,
    inhExtend,
    inhImplement,
    clusterBg,
    clusterBorder,
    clusterHoverBg,
    clusterHoverBorder,
    clusterEdge,
    clusterEdgeLabelBg,
    warningColor,
    errorColor,
    successColor,
    accentColor,
  };

  const CLUSTER_HUE_FALLBACKS = [
    { darkBg: 'rgba(99,102,241,0.15)', darkBorder: '#818cf8', lightBg: 'rgba(99,102,241,0.10)', lightBorder: '#6366f1' },
    { darkBg: 'rgba(16,185,129,0.15)', darkBorder: '#34d399', lightBg: 'rgba(16,185,129,0.10)', lightBorder: '#10b981' },
    { darkBg: 'rgba(236,72,153,0.15)', darkBorder: '#f472b6', lightBg: 'rgba(236,72,153,0.10)', lightBorder: '#ec4899' },
    { darkBg: 'rgba(245,158,11,0.15)', darkBorder: '#fbbf24', lightBg: 'rgba(245,158,11,0.10)', lightBorder: '#f59e0b' },
    { darkBg: 'rgba(6,182,212,0.15)', darkBorder: '#22d3ee', lightBg: 'rgba(6,182,212,0.10)', lightBorder: '#06b6d4' },
    { darkBg: 'rgba(168,85,247,0.15)', darkBorder: '#a78bfa', lightBg: 'rgba(168,85,247,0.10)', lightBorder: '#8b5cf6' },
    { darkBg: 'rgba(239,68,68,0.15)', darkBorder: '#f87171', lightBg: 'rgba(239,68,68,0.10)', lightBorder: '#ef4444' },
    { darkBg: 'rgba(132,204,22,0.15)', darkBorder: '#a3e635', lightBg: 'rgba(132,204,22,0.10)', lightBorder: '#84cc16' },
    { darkBg: 'rgba(251,113,133,0.15)', darkBorder: '#fb7185', lightBg: 'rgba(251,113,133,0.10)', lightBorder: '#f43f5e' },
    { darkBg: 'rgba(96,165,250,0.15)', darkBorder: '#60a5fa', lightBg: 'rgba(96,165,250,0.10)', lightBorder: '#3b82f6' },
    { darkBg: 'rgba(52,211,153,0.15)', darkBorder: '#34d399', lightBg: 'rgba(52,211,153,0.10)', lightBorder: '#14b8a6' },
    { darkBg: 'rgba(251,191,36,0.15)', darkBorder: '#fbbf24', lightBg: 'rgba(251,191,36,0.10)', lightBorder: '#eab308' },
  ];

  const clusterHueStyles = CLUSTER_HUE_FALLBACKS.map((fb, i) => ({
    selector: `node[?isCluster][clusterHue = ${i}]`,
    style: {
      'background-color': readCssVarCached(`--cg-cluster-hue-${i}-bg`, isDark ? fb.darkBg : fb.lightBg),
      'border-color': readCssVarCached(`--cg-cluster-hue-${i}-border`, isDark ? fb.darkBorder : fb.lightBorder),
    },
  }));

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
        'text-outline-color': c.nodeDefault,
        'text-outline-width': 2,
        'width': isLargeGraph ? 14 : 32,
        'height': isLargeGraph ? 14 : 32,
        'shape': 'ellipse',
        'border-width': isLargeGraph ? 1 : 1.5,
        'border-color': c.border,
        'overlay-opacity': 0,
        ...(isLargeGraph ? {} : { 'transition-property': 'background-color, border-color, border-width', 'transition-duration': LOD.TRANSITION_DURATION_MS }),
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
        'background-color': readCssVarCached('--cg-accent-soft', isDark ? 'rgba(99,102,241,0.12)' : 'rgba(38,49,72,0.1)'),
        'border-width': 2,
        'border-color': readCssVarCached('--cg-border-strong', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
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
    ...Object.keys(LAYER_COLORS).map((layer) => ({
      selector: `node[layer="${layer}"]`,
      style: { 'border-color': getLayerColor(layer, isDark), 'border-width': isLargeGraph ? 2 : 3 },
    })),
    {

      selector: 'node[nodeRole="entry"]',
      style: {
        'border-width': isLargeGraph ? 2 : 3,
        'border-color': readCssVarCached('--cg-role-entry', isDark ? '#10b981' : '#059669'),
        'border-style': 'solid',
      },
    },
    {
      selector: 'node[nodeRole="orphan"]',
      style: {
        'border-width': isLargeGraph ? 2 : 3,
        'border-color': readCssVarCached('--cg-role-orphan', isDark ? '#6b7280' : '#9ca3af'),
        'border-style': 'dashed',
        'opacity': 0.6,
      },
    },
    {
      selector: 'node[nodeRole="leaf"]',
      style: {
        'border-width': isLargeGraph ? 2 : 3,
        'border-color': readCssVarCached('--cg-role-leaf', isDark ? '#f59e0b' : '#d97706'),
        'border-style': 'double',
      },
    },
    {
      selector: 'node[nodeRole="hub"]',
      style: {
        'border-width': isLargeGraph ? 3 : 4,
        'border-color': readCssVarCached('--cg-role-hub', isDark ? '#ef4444' : '#dc2626'),
        'border-style': 'solid',
      },
    },
    {
      selector: 'node.dead-code',
      style: {
        'background-color': readCssVarCached('--cg-deadcode-node', isDark ? '#6b7280' : '#9ca3af'),
        'border-style': 'dashed',
        'border-color': readCssVarCached('--cg-deadcode-node-border', isDark ? '#4b5563' : '#6b7280'),
        'border-width': 2,
        'opacity': 0.5,
      },
    },
    {
      selector: 'node.dead-code-suspected',
      style: {
        'background-color': readCssVarCached('--cg-deadcode-node-suspected', isDark ? '#9ca3af' : '#d1d5db'),
        'border-style': 'dotted',
        'border-color': readCssVarCached('--cg-deadcode-node-suspected-border', isDark ? '#6b7280' : '#9ca3af'),
        'border-width': 1,
        'opacity': 0.7,
      },
    },
    {
      selector: 'edge.dead-code-edge',
      style: {
        'line-color': readCssVarCached('--cg-deadcode-node', isDark ? '#6b7280' : '#9ca3af'),
        'line-style': 'dashed',
        'opacity': 0.3,
      },
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
        'text-background-color': readCssVarCached('--cg-surface', isDark ? COLORS.PACKAGE_DARK : '#f9fafb'),
        'text-background-opacity': 0.8,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
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
      selector: '.neighbor-dim',
      style: {
        'opacity': 0.2,
      },
    },
    {
      selector: 'edge.neighbor-dim',
      style: {
        'opacity': 0.1,
      },
    },
    {
      selector: '.neighbor-highlight',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'opacity': 1,
        'z-index': 28,
      },
    },
    {
      selector: 'edge.neighbor-highlight',
      style: {
        'width': 2.5,
        'line-color': accentColor,
        'target-arrow-color': accentColor,
        'opacity': 1,
        'z-index': 28,
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
      selector: '.cycle-hidden',
      style: {
        'display': 'none',
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
      selector: 'node[?isCluster]',
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
        'transition-duration': LOD.TRANSITION_DURATION_MS,
      },
    },
    ...clusterHueStyles,
    {
      selector: 'node[?isCluster].hovered',

      style: {
        'background-color': clusterHoverBg,
        'border-width': 4,
        'border-color': clusterHoverBorder,
      },
    },
    {
      selector: 'edge[?isCluster]',
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
      selector: 'edge[?isCluster].hovered',
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
      selector: 'node[?isRoot]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'font-weight': 'bold',
        'z-index': 15,
      },
    },
    {
      selector: 'node[?isEntry]',
      style: {
        'border-width': 3,
        'border-color': successColor,
        'font-weight': 'bold',
        'z-index': 15,
      },
    },
    {
      selector: 'node[?isRecursive]',
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
      selector: 'node[?isPackage]',
      style: {
        'shape': 'round-rectangle',
        'background-color': readCssVar('--cg-node-package', isDark ? '#6366f1' : COLORS.PACKAGE_LIGHT),
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
      selector: 'node[?isPackage].hovered',
      style: {
        'border-width': 4,
        'border-color': hoverBorder,
      },
    },
    {
      selector: 'edge[?isPackageEdge]',
      style: {
        'width': 'mapData(aggregatedCount, 1, 50, 1.5, 5)',
        'line-color': readCssVar('--cg-edge-package', isDark ? '#818cf8' : COLORS.PACKAGE_LIGHT),
        'target-arrow-color': readCssVar('--cg-edge-package', isDark ? '#818cf8' : COLORS.PACKAGE_LIGHT),
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
      selector: 'node[?isAbstract]',
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
      selector: 'node[?isRoot][parentCount = 0]',
      style: {
        'border-width': 3,
        'border-color': accentColor,
        'font-weight': 'bold',
      },
    },
    /**
     * diff 标记（研究报告 §六 #13）。
     *
     * 选择器**由 `DIFF_STATUS_CLASS` 生成**，本文件里不得出现 `diff-added` 之类的裸字面量：
     * 「写入侧改了名字、样式侧没改」会让标记静默消失，而这类脱节在本仓库已经死过 24 条
     * 样式规则（见 tests/unit/styleSelectorContract.test.ts）。用常量拼选择器把两侧锁成
     * 同一个字符串，`tests/unit/diffStatusContract.test.ts` 再做一次源码级反向自检。
     *
     * 为什么用 class 而不是 `[diffStatus="added"]`：写入侧确实写字符串，字符串比较能工作，
     * 但 class 让「清除标记」只需一次 `removeClass` 而不必知道属性名；且 diff 标记与
     * `dead-code` / `call-chain` 这些既有视图态标记同族，同族就该同形。
     *
     * 颜色语义固定为 绿=新增 / 琥珀=修改 / 红=删除，全部走 token：暗色主题下 token 自己切到
     * 高对比变体，样式文件不需要第二份 dark 分支。
     */
    ...DIFF_NODE_STYLES(isDark, isLargeGraph),
    ...DIFF_EDGE_STYLES(isDark),
    ...buildDiagramStyles(ctx),
  ];
}
