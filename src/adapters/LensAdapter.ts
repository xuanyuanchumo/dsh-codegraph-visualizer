// LensAdapter - adapter for the optional dsh-tool-lens data source.
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { UpstreamInvoker } from './CodeGraphAdapter.ts';

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

  async fetchData(repoId: string, invoke: UpstreamInvoker): Promise<AdapterResult> {
    try {
      const raw = (await invoke('lens_analyze', { repoId })) as LensToolResult | null;
      if (!raw) return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };

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
    } catch {
      // Lens is optional - return empty result on failure.
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