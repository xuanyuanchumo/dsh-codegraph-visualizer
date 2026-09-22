import type { GraphNode } from '../../types/index.ts';
import { BaseFilteringAssembler, type FilteringAssemblerConfig, type AssemblyContext } from './BaseFilteringAssembler.ts';

const CLASS_NODE_TYPES = new Set(['class', 'interface', 'type']);
const CLASS_EDGE_TYPES = new Set(['extend', 'implement', 'association', 'aggregation', 'composition']);

interface ClassMember {
  name: string;
  type: 'method' | 'property';
  signature?: string;
  visibility: 'public' | 'private' | 'protected';
}

export class ClassAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: CLASS_NODE_TYPES,
    edgeTypes: CLASS_EDGE_TYPES,
    rootDirection: 'no-out-edges',
    depthDirection: 'source',
  };

  private membersByClass = new Map<string, ClassMember[]>();

  protected prepare(ctx: AssemblyContext): void {
    this.membersByClass = this.associateMembers(ctx.filteredNodes, ctx.allNodes);
  }

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    const members = this.membersByClass.get(node.id) ?? [];
    const methodCount = members.filter((m) => m.type === 'method').length;
    const propertyCount = members.filter((m) => m.type === 'property').length;
    const parentEdges = ctx.outEdges.get(node.id) ?? [];
    const childEdges = ctx.inEdges.get(node.id) ?? [];

    const memberSignatures = members.slice(0, 10).map((m) => ({
      name: m.name,
      type: m.type,
      visibility: m.visibility,
      ...(m.signature ? { signature: m.signature } : {}),
    }));

    const umlLabel = this.buildUmlLabel(node, members);

    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
        isRoot: !ctx.outEdges.has(node.id),
        parentCount: parentEdges.length,
        childCount: childEdges.length,
        methodCount,
        propertyCount,
        members: memberSignatures,
        umlLabel,
        isAbstract: this.checkAbstract(node),
      },
    };
  }

  private associateMembers(
    classNodes: GraphNode[],
    allNodes: GraphNode[],
  ): Map<string, ClassMember[]> {
    const result = new Map<string, ClassMember[]>();
    const classIdSet = new Set(classNodes.map((n) => n.id));

    for (const member of allNodes) {
      if (member.type !== 'function' && member.type !== 'variable') continue;
      if (CLASS_NODE_TYPES.has(member.type)) continue;

      let assignedClass: GraphNode | null = null;

      if (member.parentId && classIdSet.has(member.parentId)) {
        assignedClass = classNodes.find((n) => n.id === member.parentId) ?? null;
      }

      if (!assignedClass) {
        const classesByFile = new Map<string, GraphNode[]>();
        for (const cls of classNodes) {
          const list = classesByFile.get(cls.filePath) ?? [];
          list.push(cls);
          classesByFile.set(cls.filePath, list);
        }
        const sameFileClasses = classesByFile.get(member.filePath);
        if (sameFileClasses) {
          const sortedClasses = [...sameFileClasses].sort(
            (a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0),
          );
          for (let i = sortedClasses.length - 1; i >= 0; i--) {
            const cls = sortedClasses[i];
            if (cls && (cls.lineNumber ?? 0) <= (member.lineNumber ?? 0)) {
              assignedClass = cls;
              break;
            }
          }
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
