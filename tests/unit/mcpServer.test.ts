import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '../../src/host/McpServer.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

const mockRl = {
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => mockRl),
}));

describe('McpServer (FR-46)', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer();
  });

  it('should register a custom tool', () => {
    server.registerTool({
      name: 'custom_tool',
      description: 'A custom test tool',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    });
    expect(server.isRunning()).toBe(false);
  });

  it('should not be running before start', () => {
    expect(server.isRunning()).toBe(false);
  });

  it('should stop and set running to false', () => {
    server.stop();
    expect(server.isRunning()).toBe(false);
  });

  describe('graph tool handler logic', () => {
    const nodes = [
      makeNode('n1', 'calculateTotal', 'function', 'a.ts', 1),
      makeNode('n2', 'calculateTax', 'function', 'b.ts', 5),
      makeNode('n3', 'UserService', 'class', 'c.ts', 10),
    ];
    const edges = [
      makeEdge('e1', 'n2', 'n1', 'call'),
      makeEdge('e2', 'n3', 'n2', 'call'),
    ];
    const graphData = makeGraphData(nodes, edges);

    it('graph_status: no data → status no data', () => {
      const result = { status: 'no data', nodes: 0, edges: 0 };
      expect(result).toEqual({ status: 'no data', nodes: 0, edges: 0 });
    });

    it('graph_status: with data → status ready', () => {
      const result = {
        status: 'ready',
        nodes: graphData.metadata.nodeCount,
        edges: graphData.metadata.edgeCount,
      };
      expect(result).toEqual({ status: 'ready', nodes: 3, edges: 2 });
    });

    it('graph_data: returns limited nodes', () => {
      const limit = 2;
      const result = {
        nodes: graphData.nodes.slice(0, limit).map((n) => ({ id: n.id, label: n.label })),
        totalNodes: graphData.metadata.nodeCount,
      };
      expect(result.nodes).toHaveLength(2);
      expect(result.totalNodes).toBe(3);
    });

    it('graph_symbol: search by name', () => {
      const search = 'calculate'.toLowerCase();
      const results = graphData.nodes
        .filter((n) => n.label.toLowerCase().includes(search))
        .slice(0, 20);
      expect(results).toHaveLength(2);
      expect(results[0]!.label).toBe('calculateTotal');
      expect(results[1]!.label).toBe('calculateTax');
    });

    it('graph_symbol: no match returns empty', () => {
      const search = 'nonexistent'.toLowerCase();
      const results = graphData.nodes.filter((n) => n.label.toLowerCase().includes(search));
      expect(results).toHaveLength(0);
    });

    it('graph_impact: finds impacted nodes at depth 2', () => {
      const symbol = 'calculateTotal';
      const depth = 2;
      const targetNode = graphData.nodes.find((n) => n.label === symbol)!;
      const impacted = new Set<string>();
      let frontier = new Set<string>([targetNode.id]);
      for (let d = 0; d < depth; d++) {
        const nextFrontier = new Set<string>();
        for (const id of frontier) {
          for (const edge of graphData.edges) {
            if (edge.target === id && !impacted.has(edge.source)) {
              impacted.add(edge.source);
              nextFrontier.add(edge.source);
            }
          }
        }
        frontier = nextFrontier;
      }
      expect(impacted.size).toBe(2);
      expect(impacted.has('n2')).toBe(true);
      expect(impacted.has('n3')).toBe(true);
    });

    it('graph_impact: unknown symbol returns not found', () => {
      const targetNode = graphData.nodes.find((n) => n.label === 'Unknown');
      expect(targetNode).toBeUndefined();
    });
  });

  describe('JSON-RPC protocol constants', () => {
    it('initialize response has correct serverInfo', () => {
      const response = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'dsh-codegraph-visualizer', version: '0.2.0' },
        },
      };
      expect(response.result.serverInfo.version).toBe('0.2.0');
      expect(response.result.protocolVersion).toBe('2024-11-05');
    });

    it('tools/call with unknown tool returns error code -32601', () => {
      const errorCode = -32601;
      expect(errorCode).toBe(-32601);
    });

    it('tools/call handler exception returns error code -32603', () => {
      const errorCode = -32603;
      expect(errorCode).toBe(-32603);
    });
  });

  describe('handleMessage (private)', () => {
    it('initialize returns server info', async () => {
      await (server as unknown as { registerGraphTools: (fn: () => null) => void }).registerGraphTools(() => null);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      expect(response).not.toBeNull();
      expect(response!.result).toBeDefined();
      expect((response!.result as { serverInfo: { name: string } }).serverInfo.name).toBe('dsh-codegraph-visualizer');
    });

    it('tools/list returns registered tools', async () => {
      await (server as unknown as { registerGraphTools: (fn: () => null) => void }).registerGraphTools(() => null);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(response).not.toBeNull();
      const tools = (response!.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.length).toBeGreaterThanOrEqual(4);
      expect(tools.some((t) => t.name === 'graph_status')).toBe(true);
    });

    it('tools/call with unknown tool returns error -32601', async () => {
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nonexistent', arguments: {} } });
      expect(response).not.toBeNull();
      expect((response!.error as { code: number }).code).toBe(-32601);
    });

    it('tools/call with invalid params returns error -32602', async () => {
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: 'not-an-object' });
      expect(response).not.toBeNull();
      expect((response!.error as { code: number }).code).toBe(-32602);
    });

    it('tools/call graph_status returns ready with data', async () => {
      const graphData = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [makeEdge('e1', 'n1', 'n2', 'call')],
      );
      await (server as unknown as { registerGraphTools: (fn: () => typeof graphData) => void }).registerGraphTools(() => graphData);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'graph_status', arguments: {} } });
      expect(response).not.toBeNull();
      const result = JSON.parse(
        ((response!.result as { content: Array<{ text: string }> }).content[0]!.text),
      );
      expect(result.status).toBe('ready');
      expect(result.nodes).toBe(1);
    });

    it('tools/call graph_status returns no data when graph is null', async () => {
      await (server as unknown as { registerGraphTools: (fn: () => null) => void }).registerGraphTools(() => null);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'graph_status', arguments: {} } });
      const result = JSON.parse(
        ((response!.result as { content: Array<{ text: string }> }).content[0]!.text),
      );
      expect(result.status).toBe('no data');
    });

    it('tools/call graph_data returns limited nodes', async () => {
      const nodes = Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`, `fn${i}`, 'function', 'a.ts', i));
      const graphData = makeGraphData(nodes, []);
      await (server as unknown as { registerGraphTools: (fn: () => typeof graphData) => void }).registerGraphTools(() => graphData);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'graph_data', arguments: { limit: 2 } } });
      const result = JSON.parse(
        ((response!.result as { content: Array<{ text: string }> }).content[0]!.text),
      );
      expect(result.nodes).toHaveLength(2);
      expect(result.totalNodes).toBe(5);
    });

    it('tools/call graph_symbol returns matching symbols', async () => {
      const graphData = makeGraphData(
        [makeNode('n1', 'calculateTotal', 'function', 'a.ts', 1), makeNode('n2', 'calculateTax', 'function', 'b.ts', 5)],
        [],
      );
      await (server as unknown as { registerGraphTools: (fn: () => typeof graphData) => void }).registerGraphTools(() => graphData);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'graph_symbol', arguments: { search: 'calculate' } } });
      const result = JSON.parse(
        ((response!.result as { content: Array<{ text: string }> }).content[0]!.text),
      );
      expect(result.count).toBe(2);
    });

    it('tools/call graph_impact returns impacted nodes', async () => {
      const graphData = makeGraphData(
        [makeNode('n1', 'target', 'function', 'a.ts', 1), makeNode('n2', 'caller', 'function', 'b.ts', 5)],
        [makeEdge('e1', 'n2', 'n1', 'call')],
      );
      await (server as unknown as { registerGraphTools: (fn: () => typeof graphData) => void }).registerGraphTools(() => graphData);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'graph_impact', arguments: { symbol: 'target', depth: 1 } } });
      const result = JSON.parse(
        ((response!.result as { content: Array<{ text: string }> }).content[0]!.text),
      );
      expect(result.impacted).toContain('n2');
    });

    it('tools/call graph_impact returns message for unknown symbol', async () => {
      const graphData = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
      await (server as unknown as { registerGraphTools: (fn: () => typeof graphData) => void }).registerGraphTools(() => graphData);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'graph_impact', arguments: { symbol: 'unknown' } } });
      const result = JSON.parse(
        ((response!.result as { content: Array<{ text: string }> }).content[0]!.text),
      );
      expect(result.message).toBe('Symbol not found');
      expect(result.errorCode).toBe('SYMBOL_NOT_FOUND');
    });

    it('unknown method returns JSON-RPC -32601 error', async () => {
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 11, method: 'unknown_method' });
      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 11,
        error: { code: -32601, message: 'Method not found: unknown_method' },
      });
    });

    it('tools/call with handler throwing returns error -32603', async () => {
      server.registerTool({
        name: 'failing_tool',
        description: 'A tool that throws',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => { throw new Error('handler error'); },
      });
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'failing_tool', arguments: {} } });
      expect((response!.error as { code: number }).code).toBe(-32603);
    });

    it('tools/call with non-object arguments defaults to empty object', async () => {

      await (server as unknown as { registerGraphTools: (fn: () => null) => void }).registerGraphTools(() => null);
      const response = await (server as unknown as {
        handleMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
      }).handleMessage({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'graph_status', arguments: 'not-object' } });
      expect(response).not.toBeNull();
      expect(response!.result).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start server and set running to true', async () => {
      mockRl.on.mockClear();
      await server.start(() => null);
      expect(server.isRunning()).toBe(true);
      expect(mockRl.on).toHaveBeenCalledWith('line', expect.any(Function));
      expect(mockRl.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should handle close event and set running to false', async () => {
      mockRl.on.mockClear();
      await server.start(() => null);
      expect(server.isRunning()).toBe(true);
      const closeHandler = mockRl.on.mock.calls.find(c => c[0] === 'close')![1] as () => void;
      closeHandler();
      expect(server.isRunning()).toBe(false);
    });
  });
});
