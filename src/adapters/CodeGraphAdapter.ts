// CodeGraphAdapter - Adapter for dsh-codegraph data source
import type { GraphNode, GraphEdge, GraphData, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId, RepoId } from '../types/index.ts';

interface CodeGraphToolResult {
  nodes: Array<{
    id: string;
    name: string;
    kind: string;
    file: string;
    line: number;
    details?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    kind: string;
    details?: Record<string, unknown>;
  }>;
}

export class CodeGraphAdapter {
  private readonly source: DataSourceType = 'codegraph';

  async fetchData(repoId: RepoId, ctx: { tools: { invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown> } }): Promise<AdapterResult> {
    const raw = await ctx.tools.invoke('codegraph_graph', { repoId: repoId }) as CodeGraphToolResult;
    
    const nodes: GraphNode[] = raw.nodes.map(n => ({
      id: NodeId(n.id),
      label: n.name,
      type: this.mapKind(n.kind),
      filePath: n.file,
      lineNumber: n.line,
      properties: n.details ?? {},
    }));

    const edges: GraphEdge[] = raw.edges.map(e => ({
      id: EdgeId(e.id),
      source: NodeId(e.from),
      target: NodeId(e.to),
      type: this.mapEdgeKind(e.kind),
      properties: e.details ?? {},
    }));

    return { nodes, edges, source: this.source, timestamp: Date.now() };
  }

  private mapKind(kind: string): GraphNode['type'] {
    const map: Record<string, GraphNode['type']> = {
      function: 'function',
      class: 'class',
      variable: 'variable',
      module: 'module',
      interface: 'interface',
      type: 'type',
    };
    return map[kind] ?? 'module';
  }

  private mapEdgeKind(kind: string): GraphEdge['type'] {
    const map: Record<string, GraphEdge['type']> = {
      call: 'call',
      import: 'import',
      extend: 'extend',
      implement: 'implement',
      dependency: 'dependency',
    };
    return map[kind] ?? 'dependency';
  }
}
