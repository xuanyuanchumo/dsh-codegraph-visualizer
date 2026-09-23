import type { Core } from 'cytoscape';
import { getThemeColors } from './styles/ThemeStylesheet.ts';
import type { ThemeType } from './IRenderer.ts';
import { DATA_CONTROLLER } from '../../shared/constants.ts';

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
    };
    const defaultShape = '[$label$]';

    const edgeLabelMap: Record<string, string> = {
      call: 'call',
      extend: 'extend',
      implement: 'implement',
      import: 'import',
      dependency: 'dependency',
      contains: 'contains',
    };

    const lines: string[] = ['graph TD'];
    const idMap = new Map<string, string>();
    let idCounter = 0;
    nodes.forEach((node) => {
      const rawId = node.id();
      const safeId = 'n' + rawId.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + (idCounter++);
      idMap.set(rawId, safeId);
      const label = String(node.data('label') ?? safeId).replace(/"/g, "'");
      const type = String(node.data('type') ?? '');
      const shape = nodeShapeMap[type] ?? defaultShape;
      const shapeDef = shape.replace('$label$', `"${label}"`);
      lines.push(`  ${safeId}${shapeDef}`);
    });

    edges.forEach((edge) => {
      const sourceId = idMap.get(edge.source().id()) ?? edge.source().id().replace(/[^a-zA-Z0-9_]/g, '_');
      const targetId = idMap.get(edge.target().id()) ?? edge.target().id().replace(/[^a-zA-Z0-9_]/g, '_');
      const edgeType = String(edge.data('type') ?? '');
      const label = edgeLabelMap[edgeType];
      if (label) {
        lines.push(`  ${sourceId} -->|${label}| ${targetId}`);
      } else {
        lines.push(`  ${sourceId} --> ${targetId}`);
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
    const w = Math.ceil(bbox.w) + 160;
    const h = Math.ceil(bbox.h) + 160;
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

  destroy(): void {}
}