import { createInterface } from 'node:readline';
import { scoped } from '../shared/Logger.ts';
import { PLUGIN_VERSION } from '../generated/version.ts';
import type { GraphData, GraphNode, GraphEdge } from '../types/index.ts';

const log = scoped('mcp-server');
const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024;

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export class McpServer {
  private tools: Map<string, McpTool> = new Map();
  private running = false;
  private rl: ReturnType<typeof createInterface> | null = null;

  registerTool(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  async start(getGraphData: () => GraphData | null): Promise<void> {
    this.registerGraphTools(getGraphData);

    this.rl = createInterface({ input: process.stdin, output: process.stdout });
    this.running = true;

    this.rl.on('line', async (line: string) => {
      try {
        if (line.length > MAX_MESSAGE_LENGTH) {
          log.warn('MCP message too large, skipping', { length: line.length });
          return;
        }
        const msg = JSON.parse(line);
        const response = await this.handleMessage(msg);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (e) {
        log.warn('MCP message handling failed', e);
        try {
          const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          };
          process.stdout.write(JSON.stringify(errorResponse) + '\n');
        } catch { /* best-effort */ }
      }
    });

    this.rl.on('close', () => {
      this.running = false;
      log.info('MCP server stopped');
    });

    log.info('MCP server started', { tools: this.tools.size });
  }


  private async handleMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const method = msg['method'] as string;
    const id = msg['id'];

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'dsh-codegraph-visualizer', version: PLUGIN_VERSION },
        },
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    }

    if (method === 'tools/call') {
      const params = msg['params'] as Record<string, unknown>;
      if (typeof params !== 'object' || params === null) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Invalid params: expected object' },
        };
      }
      const toolName = typeof params['name'] === 'string' ? params['name'] : '';
      const args = (typeof params['arguments'] === 'object' && params['arguments'] !== null
        ? params['arguments'] as Record<string, unknown>
        : {});
      const tool = this.tools.get(toolName);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }
      try {
        const result = await tool.handler(args);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    return null;
  }

  private registerGraphTools(getGraphData: () => GraphData | null): void {
    this.registerTool({
      name: 'graph_status',
      description: 'Get the current graph status including node and edge counts',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const data = getGraphData();
        if (!data) return { status: 'no data', nodes: 0, edges: 0 };
        return { status: 'ready', nodes: data.metadata.nodeCount, edges: data.metadata.edgeCount };
      },
    });

    this.registerTool({
      name: 'graph_data',
      description: 'Get the full graph data (nodes and edges)',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max nodes to return (default 100)' },
        },
      },
      handler: async (args) => {
        const data = getGraphData();
        if (!data) return { nodes: [], edges: [] };
        const limit = (args['limit'] as number) || 100;
        return {
          nodes: data.nodes.slice(0, limit).map((n: GraphNode) => ({ id: n.id, label: n.label, type: n.type, filePath: n.filePath })),
          edges: data.edges.slice(0, limit * 2).map((e: GraphEdge) => ({ source: e.source, target: e.target, type: e.type })),
          totalNodes: data.metadata.nodeCount,
          totalEdges: data.metadata.edgeCount,
        };
      },
    });

    this.registerTool({
      name: 'graph_symbol',
      description: 'Search for symbols in the graph by name',
      inputSchema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Symbol name to search for' },
        },
        required: ['search'],
      },
      handler: async (args) => {
        const data = getGraphData();
        if (!data) return { results: [] };
        const search = (args['search'] as string).toLowerCase();
        const exact: GraphNode[] = [];
        const partial: GraphNode[] = [];
        for (const n of data.nodes) {
          const labelLower = n.label.toLowerCase();
          if (labelLower === search) exact.push(n);
          else if (labelLower.includes(search)) partial.push(n);
        }
        const results = [...exact, ...partial].slice(0, 20)
          .map((n: GraphNode) => ({ id: n.id, label: n.label, type: n.type, filePath: n.filePath, lineNumber: n.lineNumber }));
        return { results, count: results.length };
      },
    });

    this.registerTool({
      name: 'graph_impact',
      description: 'Get impact analysis for a symbol (what depends on it)',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to analyze' },
          depth: { type: 'number', description: 'Depth of impact analysis (default 2)' },
        },
        required: ['symbol'],
      },
      handler: async (args) => {
        const data = getGraphData();
        if (!data) return { impacted: [] };
        const symbol = args['symbol'] as string;
        const depth = (args['depth'] as number) || 2;

        const targetNode = data.nodes.find((n: GraphNode) => n.label === symbol || n.label.endsWith(`.${symbol}`));
        if (!targetNode) return { impacted: [], message: 'Symbol not found' };

        const reverseAdj = new Map<string, string[]>();
        for (const edge of data.edges) {
          const list = reverseAdj.get(edge.target);
          if (list) list.push(edge.source);
          else reverseAdj.set(edge.target, [edge.source]);
        }
        const MAX_IMPACT_RESULTS = 500;
        const impacted = new Set<string>();
        let frontier = new Set<string>([targetNode.id]);
        for (let d = 0; d < depth && impacted.size < MAX_IMPACT_RESULTS; d++) {
          const nextFrontier = new Set<string>();
          for (const id of frontier) {
            if (impacted.size >= MAX_IMPACT_RESULTS) break;
            const sources = reverseAdj.get(id) ?? [];
            for (const src of sources) {
              if (impacted.size >= MAX_IMPACT_RESULTS) break;
              if (!impacted.has(src)) {
                impacted.add(src);
                nextFrontier.add(src);
              }
            }
          }
          frontier = nextFrontier;
        }
        return { impacted: Array.from(impacted), count: impacted.size, truncated: impacted.size >= MAX_IMPACT_RESULTS };
      },
    });
  }

  stop(): void {
    this.running = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}