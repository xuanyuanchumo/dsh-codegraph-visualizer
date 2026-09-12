import type cytoscape from 'cytoscape';
import type { ThemeColors } from './ThemeStylesheet.ts';
import { readCssVar } from './ThemeStylesheet.ts';

export interface StyleContext {
  c: ThemeColors;
  isDark: boolean;
  isLargeGraph: boolean;
  hoverBorder: string;
  impactD1: string;
  impactD2: string;
  impactD3: string;
  inhExtend: string;
  inhImplement: string;
  clusterBg: string;
  clusterBorder: string;
  clusterHoverBg: string;
  clusterHoverBorder: string;
  clusterEdge: string;
  clusterEdgeLabelBg: string;
  warningColor: string;
  errorColor: string;
  successColor: string;
  accentColor: string;
}

export function buildDiagramStyles(ctx: StyleContext): cytoscape.StylesheetJson {
  const { c, isDark, hoverBorder, inhExtend, inhImplement, clusterEdgeLabelBg, warningColor, errorColor, successColor, accentColor } = ctx;
  return [
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

    // ===== Dependency Diagram =====
    {
      selector: 'edge[diagramType="dependencies"][type="import"]',
      style: {
        'width': 2,
        'line-color': c.edgeImport,
        'target-arrow-color': c.edgeImport,
        'line-style': 'solid',
        'target-arrow-shape': 'triangle',
      },
    },
    {
      selector: 'edge[diagramType="dependencies"][type="dependency"]',
      style: {
        'width': 1.5,
        'line-color': c.edgeDependency,
        'target-arrow-color': c.edgeDependency,
        'line-style': 'dashed',
        'target-arrow-shape': 'vee',
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