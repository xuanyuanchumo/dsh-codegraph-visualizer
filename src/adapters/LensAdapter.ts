// LensAdapter - Adapter for dsh-tool-lens data source
import type { GraphNode, GraphEdge, GraphData, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId, RepoId } from '../types/index.ts';

interface LensToolResult {
  symbols: Array<{
    id: string;
    name: string;
    scope: string;
    file: string;
    line: number;
    category: string;
  }>;
  references: Array<{
    from: string;
    to: string;
    relation: string;
  }>;
}

export class LensAdapter {
  private readonly source: DataSourceType = 'lens';

  async fetchData(repoId: RepoId, ctx: { tools: { invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown> } }): Promise<AdapterResult> {
    try {
      const raw = await ctx.tools.invoke('lens_analyze', { repoId: repoId }) as LensToolResult;
      
      const nodes: GraphNode[] = raw.symbols.map(s => ({
        id: NodeId(s.id),
        label: s.name,
        type: this.mapCategory(s.category),
        filePath: s.file,
        lineNumber: s.line,
        properties: { scope: s.scope },
      }));

      const edges: GraphEdge[] = raw.references.map(r => ({
        id: EdgeId(`${r.from}->${r.to}`),
        source: NodeId(r.from),
        target: NodeId(r.to),
        type: this.mapRelation(r.relation),
        properties: {},
      }));

      return { nodes, edges, source: this.source, timestamp: Date.now() };
    } catch (error) {
      // Lens is optional - return empty result on failure
      return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };
    }
  }

  private mapCategory(cat: string): GraphNode['type'] {
    const map: Record<string, GraphNode['type']> = {
      function: 'function',
      class: 'class',
      variable: 'variable',
      module: 'module',
      interface: 'interface',
      type: 'type',
    };
    return map[cat] ?? 'module';
  }

  private mapRelation(rel: string): GraphEdge['type'] {
    const map: Record<string, GraphEdge['type']> = {
      call: 'call',
      reference: 'dependency',
      import: 'import',
      extend: 'extend',
      implement: 'implement',
    };
    return map[rel] ?? 'dependency';
  }
}
