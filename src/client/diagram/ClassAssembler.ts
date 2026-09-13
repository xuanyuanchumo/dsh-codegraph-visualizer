import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';
import { computeDepths } from './DiagramAssembler.ts';

const CLASS_NODE_TYPES = new Set(['class', 'interface', 'type']);
const CLASS_EDGE_TYPES = new Set(['extend', 'implement']);

interface ClassMember {
  name: string;
  type: 'method' | 'property';
  signature?: string;
  visibility: 'public' | 'private' | 'protected';
}

export class ClassAssembler implements DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {
    const classNodes = nodes.filter((n) => CLASS_NODE_TYPES.has(n.type));
    const classEdges = edges.filter((e) => CLASS_EDGE_TYPES.has(e.type));

    const classIds = new Set(classNodes.map((n) => n.id));
    const validEdges = classEdges.filter(
      (e) => classIds.has(e.source) && classIds.has(e.target),
    );

    const membersByClass = this.associateMembers(classNodes, nodes);

    const outEdges = new Map<string, GraphEdge[]>();
    const inEdges = new Map<string, GraphEdge[]>();
    for (const e of validEdges) {
      const outList = outEdges.get(e.source) ?? [];
      outList.push(e);
      outEdges.set(e.source, outList);

      const inList = inEdges.get(e.target) ?? [];
      inList.push(e);
      inEdges.set(e.target, inList);
    }

    const rootIds: string[] = [];
    for (const n of classNodes) {
      if (!outEdges.has(n.id)) rootIds.push(n.id);
    }

    const depthMap = computeDepths(rootIds, inEdges, 'source');

    const assembledNodes = classNodes.map((n) => {
      const members = membersByClass.get(n.id) ?? [];
      const methodCount = members.filter((m) => m.type === 'method').length;
      const propertyCount = members.filter((m) => m.type === 'property').length;
      const parentEdges = outEdges.get(n.id) ?? [];
      const childEdges = inEdges.get(n.id) ?? [];

      const memberSignatures = members.slice(0, 10).map((m) => ({
        name: m.name,
        type: m.type,
        visibility: m.visibility,
        ...(m.signature ? { signature: m.signature } : {}),
      }));

      const umlLabel = this.buildUmlLabel(n, members);

      return {
        ...n,
        properties: {
          ...n.properties,
          depth: depthMap.get(n.id) ?? 0,
          isRoot: !outEdges.has(n.id),
          parentCount: parentEdges.length,
          childCount: childEdges.length,
          methodCount,
          propertyCount,
          members: memberSignatures,
          umlLabel,
          isAbstract: this.checkAbstract(n),
        },
      };
    });

    const maxDepth = Math.max(0, ...depthMap.values());

    return {
      nodes: assembledNodes,
      edges: validEdges,
      metadata: {
        rootIds,
        maxDepth,
        nodeCount: assembledNodes.length,
        edgeCount: validEdges.length,
      },
    };
  }

  private associateMembers(
    classNodes: GraphNode[],
    allNodes: GraphNode[],
  ): Map<string, ClassMember[]> {
    const result = new Map<string, ClassMember[]>();

    const classesByFile = new Map<string, GraphNode[]>();
    for (const cls of classNodes) {
      const list = classesByFile.get(cls.filePath) ?? [];
      list.push(cls);
      classesByFile.set(cls.filePath, list);
    }

    for (const [filePath, classes] of classesByFile) {
      const sortedClasses = [...classes].sort(
        (a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0),
      );

      const fileMembers = allNodes.filter(
        (n) =>
          n.filePath === filePath &&
          (n.type === 'function' || n.type === 'variable') &&
          !CLASS_NODE_TYPES.has(n.type),
      );

      for (const member of fileMembers) {
        let assignedClass: GraphNode | null = null;
        for (let i = sortedClasses.length - 1; i >= 0; i--) {
          const cls = sortedClasses[i];
          if (cls && (cls.lineNumber ?? 0) <= (member.lineNumber ?? 0)) {
            assignedClass = cls;
            break;
          }
        }

        if (assignedClass) {
          const list = result.get(assignedClass.id) ?? [];
          const isMethod = member.type === 'function';
          list.push({
            name: member.label,
            type: isMethod ? 'method' : 'property',
            ...(member.properties?.signature ? { signature: member.properties.signature as string } : {}),
            visibility: this.inferVisibility(member),
          });
          result.set(assignedClass.id, list);
        }
      }
    }

    return result;
  }

  private inferVisibility(node: GraphNode): 'public' | 'private' | 'protected' {
    const name = node.label;
    if (name.startsWith('_') && !name.startsWith('__')) return 'protected';
    if (name.startsWith('__')) return 'private';
    const exported = node.properties?.exported ?? node.properties?.isExported;
    if (exported === true || exported === 1) return 'public';
    return 'private';
  }

  private checkAbstract(node: GraphNode): boolean {
    const name = node.label;
    return name.startsWith('Abstract') || name.startsWith('I') && node.type === 'interface';
  }

  private buildUmlLabel(node: GraphNode, members: ClassMember[]): string {
    const visMark = (v: 'public' | 'private' | 'protected'): string =>
      v === 'public' ? '+' : v === 'private' ? '-' : '#';

    const stereotype = node.type === 'interface' ? `\u00ABinterface\u00BB\n` : '';
    const header = stereotype + node.label;

    const properties = members.filter((m) => m.type === 'property');
    const methods = members.filter((m) => m.type === 'method');

    const propLines = properties.slice(0, 5).map((m) =>
      `${visMark(m.visibility)} ${m.name}${m.signature ? ': ' + m.signature : ''}`,
    );
    const methodLines = methods.slice(0, 8).map((m) =>
      `${visMark(m.visibility)} ${m.name}(${m.signature ?? ''})`,
    );

    const sep = '\u2500'.repeat(20);

    const parts: string[] = [header];
    if (propLines.length > 0) {
      parts.push(sep, ...propLines);
    }
    if (methodLines.length > 0) {
      parts.push(sep, ...methodLines);
    }

    return parts.join('\n');
  }

}
