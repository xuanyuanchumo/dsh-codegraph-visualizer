import type { Core } from 'cytoscape';
import { getThemeColors } from './styles/ThemeStylesheet.ts';
import type { ThemeType } from './IRenderer.ts';
import { DATA_CONTROLLER, EXPORT } from '../../shared/constants.ts';

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

export class ExportController {
  private cy: Core;

  constructor(cy: Core) {
    this.cy = cy;
  }

  exportJSON(): string {
    return JSON.stringify(this.cy.json(), null, 2);
  }

  exportMermaid(): string {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return 'graph TD\n';

    const nodeShapeMap: Record<string, string> = {
      function: '($label$)',
      class: '[$label$]',
      variable: '(($label$))',
      module: '{$label$}',
      interface: '/$label$/',
      type: '[$label$]',
    };
    const defaultShape = '[$label$]';

    const edgeLabelMap: Record<string, string> = {
      call: 'call',
      extend: 'extend',
      implement: 'implement',
      import: 'import',
      dependency: 'dependency',
      contains: 'contains',
      association: 'assoc',
      aggregation: 'aggr',
      composition: 'comp',
    };

    const edgeStyleMap: Record<string, string> = {
      extend: '-.->',
      implement: '-.->',
      aggregation: '--o',
      composition: '--*',
      association: '-->',
    };

    const dirMap: Record<string, string> = { TB: 'TD', LR: 'LR', BT: 'BT', RL: 'RL' };
    const rankDir = dirMap[String(this.cy.data('rankDir') ?? 'TB')] ?? 'TD';

    const lines: string[] = [`graph ${rankDir}`];
    const idMap = new Map<string, string>();

    nodes.forEach((node) => {
      const rawId = node.id();
      const safeId = 'n' + rawId.replace(/[^a-zA-Z0-9_]/g, '_');
      idMap.set(rawId, safeId);
      let label = String(node.data('label') ?? safeId).replace(/"/g, "'");
      if (label.length > 40) label = label.slice(0, 37) + '...';
      const type = String(node.data('type') ?? '');
      const shape = nodeShapeMap[type] ?? defaultShape;
      const shapeDef = shape.replace('$label$', `"${label}"`);
      lines.push(`  ${safeId}${shapeDef}`);
    });

    edges.forEach((edge) => {
      const sourceId = idMap.get(edge.source().id()) ?? edge.source().id().replace(/[^a-zA-Z0-9_]/g, '_');
      const targetId = idMap.get(edge.target().id()) ?? edge.target().id().replace(/[^a-zA-Z0-9_]/g, '_');
      const edgeType = String(edge.data('type') ?? '');
      const direction = String(edge.data('direction') ?? 'unidirectional');
      const label = edgeLabelMap[edgeType];
      const arrow = edgeStyleMap[edgeType] ?? '-->';
      const bidir = direction === 'bidirectional' ? '<' : '';
      if (label) {
        lines.push(`  ${sourceId} ${bidir}${arrow}|${label}| ${targetId}`);
      } else {
        lines.push(`  ${sourceId} ${bidir}${arrow} ${targetId}`);
      }
    });

    return lines.join('\n') + '\n';
  }

  exportMermaidSequence(): string {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return 'sequenceDiagram\n';

    const callEdges = edges.filter((e) => String(e.data('type') ?? '') === 'call');
    if (callEdges.length === 0) return 'sequenceDiagram\n';

    const participants = new Set<string>();
    callEdges.forEach((edge) => {
      participants.add(edge.source().id());
      participants.add(edge.target().id());
    });

    const idMap = new Map<string, string>();
    let pCounter = 0;
    const lines: string[] = ['sequenceDiagram'];

    participants.forEach((pid) => {
      const node = this.cy.getElementById(pid);
      const label = String(node.data('label') ?? pid).replace(/"/g, "'");
      const safeName = 'P' + (pCounter++);
      idMap.set(pid, safeName);
      lines.push(`  participant ${safeName} as "${label}"`);
    });

    callEdges.forEach((edge) => {
      const sourceId = idMap.get(edge.source().id()) ?? 'P?';
      const targetId = idMap.get(edge.target().id()) ?? 'P?';

      lines.push(`  ${sourceId}->>+${targetId}: call`);
      lines.push(`  ${targetId}-->>-${sourceId}: return`);
    });

    return lines.join('\n') + '\n';
  }

  exportMermaidClass(): string {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return 'classDiagram\n';

    const classNodes = nodes.filter((n) => {
      const t = String(n.data('type') ?? '');
      return t === 'class' || t === 'interface';
    });
    if (classNodes.length === 0) return 'classDiagram\n';

    const inheritanceEdges = edges.filter((e) => {
      const t = String(e.data('type') ?? '');
      return t === 'extend' || t === 'implement';
    });

    const idMap = new Map<string, string>();
    const lines: string[] = ['classDiagram'];

    classNodes.forEach((node) => {
      const rawId = node.id();
      const safeId = 'C' + rawId.replace(/[^a-zA-Z0-9_]/g, '_');
      idMap.set(rawId, safeId);

      const type = String(node.data('type') ?? '');
      if (type === 'interface') {
        lines.push(`  class ${safeId} {`);
        lines.push(`    <<interface>>`);
        lines.push(`  }`);
      } else {
        lines.push(`  class ${safeId}`);
      }
    });

    inheritanceEdges.forEach((edge) => {
      const sourceId = idMap.get(edge.source().id());
      const targetId = idMap.get(edge.target().id());
      if (!sourceId || !targetId) return;
      const edgeType = String(edge.data('type') ?? '');
      if (edgeType === 'extend') {
        lines.push(`  ${sourceId} <|-- ${targetId}`);
      } else if (edgeType === 'implement') {
        lines.push(`  ${sourceId} <|.. ${targetId}`);
      }
    });

    return lines.join('\n') + '\n';
  }

  exportPNG(): string | null {
    return this.cy.png({ full: true, scale: 2 });
  }

  exportSVG(theme: ThemeType): string | null {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return null;

    const colors = getThemeColors(theme);
    const nodeColors: Record<string, string> = {
      function: colors.nodeFunction,
      class: colors.nodeClass,
      variable: colors.nodeVariable,
      module: colors.nodeModule,
      interface: colors.nodeInterface,
      type: colors.nodeDefault,
    };
    const edgeColors: Record<string, string> = {
      call: colors.edgeCall,
      extend: colors.edgeExtend,
      implement: colors.edgeImplement,
      import: colors.edgeImport,
      dependency: colors.edgeDependency,
      contains: colors.edgeContains,
    };

    const bbox = this.cy.elements().boundingBox();
    const w = Math.ceil(bbox.w) + EXPORT.SVG_PADDING;
    const h = Math.ceil(bbox.h) + EXPORT.SVG_PADDING;
    const offsetX = -bbox.x1 + DATA_CONTROLLER.SVG_OFFSET;
    const offsetY = -bbox.y1 + DATA_CONTROLLER.SVG_OFFSET;

    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);

    edges.forEach((edge) => {
      const srcPos = edge.source().position();
      const tgtPos = edge.target().position();
      const edgeType = edge.data('type') as string;
      const color = edgeColors[edgeType] ?? colors.edgeDefault;
      parts.push(`<line x1="${srcPos.x + offsetX}" y1="${srcPos.y + offsetY}" x2="${tgtPos.x + offsetX}" y2="${tgtPos.y + offsetY}" stroke="${color}" stroke-width="1" opacity="0.5"/>`);
    });

    nodes.forEach((node) => {
      const pos = node.position();
      const nodeType = node.data('type') as string;
      const label = node.data('label') as string;
      const color = nodeColors[nodeType] ?? colors.nodeDefault;
      const r = 12;
      parts.push(`<circle cx="${pos.x + offsetX}" cy="${pos.y + offsetY}" r="${r}" fill="${color}" opacity="0.8"/>`);
      parts.push(`<text x="${pos.x + offsetX}" y="${pos.y + offsetY + 4}" font-size="9" text-anchor="middle" fill="${colors.text}">${escapeXml(label)}</text>`);
    });

    parts.push('</svg>');
    return parts.join('');
  }

  exportGraphML(): string {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return '<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n</graphml>';

    const parts: string[] = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
    parts.push('  <key id="label" for="node" attr.name="label" attr.type="string"/>');
    parts.push('  <key id="type" for="node" attr.name="type" attr.type="string"/>');
    parts.push('  <key id="filePath" for="node" attr.name="filePath" attr.type="string"/>');
    parts.push('  <key id="edgeType" for="edge" attr.name="type" attr.type="string"/>');
    parts.push('  <graph id="G" edgedefault="directed">');

    nodes.forEach((node) => {
      const id = escapeXml(node.id());
      const label = escapeXml(String(node.data('label') ?? ''));
      const type = escapeXml(String(node.data('type') ?? ''));
      const filePath = escapeXml(String(node.data('filePath') ?? ''));
      parts.push(`    <node id="${id}">`);
      parts.push(`      <data key="label">${label}</data>`);
      parts.push(`      <data key="type">${type}</data>`);
      if (filePath) parts.push(`      <data key="filePath">${filePath}</data>`);
      parts.push('    </node>');
    });

    edges.forEach((edge) => {
      const id = escapeXml(edge.id());
      const source = escapeXml(edge.source().id());
      const target = escapeXml(edge.target().id());
      const edgeType = escapeXml(String(edge.data('type') ?? ''));
      parts.push(`    <edge id="${id}" source="${source}" target="${target}">`);
      parts.push(`      <data key="edgeType">${edgeType}</data>`);
      parts.push('    </edge>');
    });

    parts.push('  </graph>');
    parts.push('</graphml>');
    return parts.join('\n');
  }

  exportJSONLD(): string {
    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    if (nodes.length === 0) return JSON.stringify({ '@context': {}, '@graph': [] }, null, 2);

    const context: Record<string, string> = {
      '@vocab': 'https://codegraph.visualizer/ns/',
      label: 'rdfs:label',
      type: 'rdf:type',
      filePath: 'codegraph:filePath',
      source: 'codegraph:source',
      target: 'codegraph:target',
      edgeType: 'codegraph:edgeType',
    };

    const nodeTypes: Record<string, string> = {
      function: 'codegraph:Function',
      class: 'codegraph:Class',
      variable: 'codegraph:Variable',
      module: 'codegraph:Module',
      interface: 'codegraph:Interface',
      type: 'codegraph:Type',
    };

    const graph: Record<string, unknown>[] = [];

    nodes.forEach((node) => {
      const entry: Record<string, unknown> = {
        '@id': `node:${node.id()}`,
        '@type': nodeTypes[String(node.data('type') ?? '')] ?? 'codegraph:Node',
        label: String(node.data('label') ?? node.id()),
      };
      const filePath = String(node.data('filePath') ?? '');
      if (filePath) entry.filePath = filePath;
      graph.push(entry);
    });

    edges.forEach((edge) => {
      graph.push({
        '@id': `edge:${edge.id()}`,
        '@type': 'codegraph:Edge',
        source: `node:${edge.source().id()}`,
        target: `node:${edge.target().id()}`,
        edgeType: String(edge.data('type') ?? ''),
      });
    });

    return JSON.stringify({ '@context': context, '@graph': graph }, null, 2);
  }

  destroy(): void {}
}