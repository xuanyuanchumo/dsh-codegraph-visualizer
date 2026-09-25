// LensAdapter - adapter for the optional dsh-tool-lens data source.
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { IDataAdapter, UpstreamInvoker } from './IAdapter.ts';
import { scoped } from '../shared/Logger.ts';
import { inferLayerFromPath } from '../shared/layerUtils.ts';

const log = scoped('lens-adapter');

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


export class LensAdapter implements IDataAdapter {
  readonly source: DataSourceType = 'lens';

  async fetchData(repoId: string, invoke: UpstreamInvoker): Promise<AdapterResult> {
    try {
      const raw = (await invoke('lens_analyze', { repoId })) as LensToolResult | null;
      if (!raw) return { nodes: [], edges: [], source: this.source, timestamp: Date.now() };

      const symbols = Array.isArray(raw.symbols) ? raw.symbols : [];
      const references = Array.isArray(raw.references) ? raw.references : [];

      const fileNodeMap = new Map<string, string>();
      for (const s of symbols) {
        if (s.category === 'module' || s.category === 'file') {
          fileNodeMap.set(s.file, s.id);
        }
      }

      const nodes: GraphNode[] = symbols.map((s) => {
        const parentId = (s.category !== 'module' && s.category !== 'file')
          ? fileNodeMap.get(s.file)
          : undefined;
        return {
          id: NodeId(s.id),
          label: s.name,
          type: this.mapCategory(s.category),
          filePath: s.file,
          lineNumber: s.line,
          properties: { scope: s.scope },
          ...(parentId ? { parentId: NodeId(parentId) } : {}),
          layer: inferLayerFromPath(s.file),
        };
      });

      const edges: GraphEdge[] = references.map((r) => {
        const edgeType = this.mapRelation(r.relation);
        return {
          id: EdgeId(`${r.from}->${r.to}:${edgeType}`),
          source: NodeId(r.from),
          target: NodeId(r.to),
          type: edgeType,
          properties: {},
        };
      });

      return { nodes, edges, source: this.source, timestamp: Date.now() };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log.warn('Lens fetchData failed — lens is optional, returning empty', e);
      return { nodes: [], edges: [], source: this.source, timestamp: Date.now(), error: errorMsg };
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