import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithTimeout,
  fetchStatus,
  fetchWorkspace,
  requestScan,
  requestInit,
  requestWatch,
  fetchBootstrap,
  fetchNodeChildren,
  fetchGraphDataIncremental,
  fetchFileOutline,
  fetchSymbolAST,
  fetchAst,
  fetchEdges,
  fetchGraphDiff,
  createEtagSink,
  commitEtag,
  clearEtagCache,
} from '../../src/client/api/index.ts';

describe('client api', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchStatus', () => {
    it('returns parsed status on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          codegraph: true, lens: false, astSource: true, graphSource: true, builtin: true,
        }),
      }) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({
        codegraph: true, lens: false, astSource: true, graphSource: true, builtin: true,
      });
    });

    it('returns every capability false when the response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const result = await fetchStatus();
      // 「宿主没应答」必须是「不知道」而不是「内置可用」：修前这里回落 `builtin: true`，
      // 那正是 §61.10 那条恒真式在客户端的镜像。
      expect(result).toEqual({
        codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false,
      });
    });

    it('returns every capability false on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({
        codegraph: false, lens: false, astSource: false, graphSource: false, builtin: false,
      });
    });
  });

  describe('fetchWorkspace', () => {
    it('returns parsed workspace on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: '/repo', list: ['a.ts', 'b.ts'] }),
      }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '/repo', list: ['a.ts', 'b.ts'] });
    });

    it('returns defaults when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '.', list: [] });
    });

    it('returns defaults on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '.', list: [] });
    });

    it('fills missing path/list with defaults', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result).toEqual({ path: '.', list: [] });
    });

    it('passes through the allowed-roots diagnostics', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: '/repo',
          list: ['/repo'],
          rootSource: 'registry',
          allowedRoots: ['/repo'],
          resolvedFrom: ['/repo'],
        }),
      }) as unknown as typeof fetch;
      const result = await fetchWorkspace();
      expect(result.rootSource).toBe('registry');
      expect(result.allowedRoots).toEqual(['/repo']);
      expect(result.resolvedFrom).toEqual(['/repo']);
    });
  });

  describe('fetchAst', () => {
    it('posts filePath and returns the AST', async () => {
      const ast = { type: 'program', children: [] };
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ast });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const result = await fetchAst('src/a.ts');
      expect(result).toEqual(ast);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/ast', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'src/a.ts' }),
      }));
    });

    it('carries the selected workspace so the host resolves filePath against it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'program' }) });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchAst('src/a.ts', undefined, 'D:\\Projects\\repo');
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url.startsWith('/api/v1/codegraph/ast?')).toBe(true);
      expect(new URL(url, 'http://localhost').searchParams.get('workspace')).toBe('D:\\Projects\\repo');
    });

    it('omits the workspace parameter when unset or "."', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'program' }) });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchAst('src/a.ts', undefined, '.');
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/ast');
    });

    it('returns null when the response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      expect(await fetchAst('src/a.ts')).toBeNull();
    });

    it('returns null on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      expect(await fetchAst('src/a.ts')).toBeNull();
    });
  });

  describe('requestScan', () => {
    it('returns scan result on success', async () => {
      const payload = { success: true, nodes: [], edges: [], metadata: { foo: 'bar' } };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      }) as unknown as typeof fetch;
      const result = await requestScan('/repo', 100);
      expect(result).toEqual(payload);
    });

    it('sends POST with path and maxNodes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, nodes: [], edges: [] }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await requestScan('/repo', 50);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/scan', expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/repo', maxNodes: 50 }),
      }));
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await requestScan('/repo');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await requestScan('/repo');
      expect(result).toBeNull();
    });
  });

  describe('requestInit', () => {
    it('returns init result on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'ok' }),
      }) as unknown as typeof fetch;
      const result = await requestInit('/repo');
      expect(result).toEqual({ success: true, message: 'ok' });
    });

    it('sends POST with path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'ok' }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await requestInit('/repo');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/init', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/repo' }),
      }));
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await requestInit('/repo');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await requestInit('/repo');
      expect(result).toBeNull();
    });
  });

  describe('requestWatch', () => {
    it('returns true when response ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
      const result = await requestWatch(true, '/repo');
      expect(result).toBe(true);
    });

    it('returns false when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
      const result = await requestWatch(false, '/repo');
      expect(result).toBe(false);
    });

    it('sends POST with enabled and path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await requestWatch(true, '/repo');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/codegraph/watch', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enabled: true, path: '/repo' }),
      }));
    });

    it('returns false on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await requestWatch(true, '/repo');
      expect(result).toBe(false);
    });
  });

  describe('fetchBootstrap', () => {
    it('returns parsed bootstrap data on success', async () => {
      const bootstrapData = {
        rootNodes: [{ id: 'r1', label: 'root', type: 'module', filePath: '/', lineNumber: 0, properties: {} }],
        topLevelNodes: [{ id: 't1', label: 'top', type: 'directory', filePath: '/src', lineNumber: 0, properties: {} }],
        topLevelTotal: 1,
        edges: [],
        indexStatus: 'ready',
        metadata: { repoId: 'repo1', timestamp: 123, totalNodeCount: 100, totalEdgeCount: 50 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => bootstrapData,
      }) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).not.toBeNull();
      expect(result!.rootNodes).toHaveLength(1);
      expect(result!.topLevelNodes).toHaveLength(1);
      expect(result!.indexStatus).toBe('ready');
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).toBeNull();
    });

    it('fills missing fields with defaults', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchBootstrap();
      expect(result).not.toBeNull();
      expect(result!.rootNodes).toEqual([]);
      expect(result!.topLevelNodes).toEqual([]);
      expect(result!.topLevelTotal).toBe(0);
      expect(result!.indexStatus).toBe('empty');
      expect(result!.metadata).toEqual({ repoId: '', timestamp: 0, totalNodeCount: 0, totalEdgeCount: 0 });
    });
  });

  describe('fetchNodeChildren', () => {
    it('returns parsed children data on success', async () => {
      const childrenData = {
        nodes: [{ id: 'c1', label: 'child', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        cursor: 'next-page',
        total: 10,
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => childrenData,
      }) as unknown as typeof fetch;
      const result = await fetchNodeChildren('node-1');
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(1);
      expect(result!.cursor).toBe('next-page');
      expect(result!.total).toBe(10);
    });

    it('sends request with nodeId and default limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [], cursor: null, total: 0 }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchNodeChildren('node-1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/codegraph/children?'),
        expect.anything(),
      );
      expect(mockFetch.mock.calls[0]![0]).toContain('nodeId=node-1');
      expect(mockFetch.mock.calls[0]![0]).toContain('limit=50');
    });

    it('sends request with cursor and custom limit when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [], cursor: null, total: 0 }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchNodeChildren('node-1', 'cursor-abc', 100);
      expect(mockFetch.mock.calls[0]![0]).toContain('cursor=cursor-abc');
      expect(mockFetch.mock.calls[0]![0]).toContain('limit=100');
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchNodeChildren('node-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchNodeChildren('node-1');
      expect(result).toBeNull();
    });
  });

  describe('fetchGraphDataIncremental', () => {
    it('returns null on 304 Not Modified', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ status: 304, ok: false }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', 'r1');
      expect(result).toBeNull();
    });

    it('returns validated graph data on success', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'r1', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', 'r1');
      expect(result).not.toBeNull();
      expect(result!.data.nodes).toHaveLength(1);
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', 'r1');
      expect(result).toBeNull();
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', 'r1');
      expect(result).toBeNull();
    });

    // P0-R16-01：`/api/v1/codegraph/data` 读的是 host 单槽，槽里可能是另一个工作区的图。
    // 守卫必须在取数层就把外来负载挡掉，调用点无需再自行判定。
    it('returns null when the payload belongs to another workspace', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: '/repo/other', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', '/repo/current');
      expect(result).toBeNull();
    });

    it('accepts the payload when the scope has no workspace identity yet', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: '/repo/other', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', null);
      expect(result).not.toBeNull();
      expect(result!.data.nodes).toHaveLength(1);
    });

    it('accepts a separator-only difference as the same workspace', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'D:\\Projects\\repo', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"1-abc"', 'D:/Projects/repo');
      expect(result).not.toBeNull();
    });

    // P0-R16-02：校验值必须原样回传。客户端无从推导宿主的 `W/"<revision>-<hash>"`，
    // 用展示时钟（`lastUpdated`）代替会同时造成"304 永不命中"与"假 304 吞掉真实更新"。
    it('echoes the server etag verbatim and returns it with the payload', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'r1', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
        headers: { get: (name: string) => (name === 'etag' ? 'W/"7-deadbeef"' : null) },
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental('W/"6-cafe"', 'r1');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/codegraph/data',
        expect.objectContaining({ headers: { 'if-none-match': 'W/"6-cafe"' } }),
      );
      expect(result!.etag).toBe('W/"7-deadbeef"');
    });

    it('sends no if-none-match when there is no usable etag yet', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'r1', timestamp: 2, nodeCount: 1, edgeCount: 0 },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => graphData,
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const result = await fetchGraphDataIncremental(null, 'r1');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/codegraph/data',
        expect.objectContaining({ headers: {} }),
      );
      expect(result!.etag).toBeNull();
    });
  });

  describe('fetchFileOutline', () => {
    it('returns parsed outline data on success', async () => {
      const outlineData = {
        symbols: [{ id: 's1', label: 'funcA', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
        edges: [{ id: 'e1', source: 's1', target: 's2', type: 'calls', properties: {} }],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => outlineData,
      }) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).not.toBeNull();
      expect(result!.symbols).toHaveLength(1);
      expect(result!.edges).toHaveLength(1);
    });

    it('encodes nodeId in the URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ symbols: [], edges: [] }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchFileOutline('path/to/file.ts');
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/files/path%2Fto%2Ffile.ts/outline');
    });

    it('fills missing symbols/edges with empty arrays', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).not.toBeNull();
      expect(result!.symbols).toEqual([]);
      expect(result!.edges).toEqual([]);
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchFileOutline('file-1');
      expect(result).toBeNull();
    });
  });

  describe('fetchSymbolAST', () => {
    it('returns parsed AST data on success', async () => {
      const astData = {
        astNodes: [{ id: 'n1', label: 'node', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
        astEdges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'calls', properties: {} }],
        sourceLines: ['line1', 'line2'],
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => astData,
      }) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).not.toBeNull();
      expect(result!.astNodes).toHaveLength(1);
      expect(result!.astEdges).toHaveLength(1);
      expect(result!.sourceLines).toEqual(['line1', 'line2']);
    });

    it('encodes nodeId in the URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ astNodes: [], astEdges: [], sourceLines: [] }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchSymbolAST('sym/with/slashes');
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/symbols/sym%2Fwith%2Fslashes/ast');
    });

    it('fills missing fields with empty arrays', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).not.toBeNull();
      expect(result!.astNodes).toEqual([]);
      expect(result!.astEdges).toEqual([]);
      expect(result!.sourceLines).toEqual([]);
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchSymbolAST('sym-1');
      expect(result).toBeNull();
    });

    it('passes cursor and surfaces total/cursor/hasMore', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          astNodes: [{ id: 'n1', label: 'node', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
          astEdges: [],
          sourceLines: [],
          total: 900,
          cursor: 801,
          hasMore: true,
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchSymbolAST('sym-1', undefined, '.', 800);
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/symbols/sym-1/ast?cursor=800');
      expect(result!.total).toBe(900);
      expect(result!.cursor).toBe(801);
      expect(result!.hasMore).toBe(true);
    });

    it('omits the cursor param for the first page and degrades missing fields to a complete single page', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          astNodes: [{ id: 'n1', label: 'node', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
          astEdges: [],
          sourceLines: [],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchSymbolAST('sym-1', undefined, '.', 0);
      expect(mockFetch.mock.calls[0]![0]).toBe('/api/v1/codegraph/symbols/sym-1/ast');
      // 旧服务端不返回分页字段时，必须退化为「本页即全部」，绝不虚报 hasMore。
      expect(result!.total).toBe(1);
      expect(result!.cursor).toBe(1);
      expect(result!.hasMore).toBe(false);
    });
  });

  describe('fetchEdges', () => {
    it('returns parsed edges data on success', async () => {
      const edgesData = {
        edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} }],
        total: 10,
        cursor: 5,
        hasMore: true,
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => edgesData,
      }) as unknown as typeof fetch;
      const result = await fetchEdges('node-1');
      expect(result).not.toBeNull();
      expect(result!.edges).toHaveLength(1);
      expect(result!.total).toBe(10);
      expect(result!.cursor).toBe(5);
      expect(result!.hasMore).toBe(true);
    });

    it('sends request with from and default scope/limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ edges: [], total: 0, cursor: 0, hasMore: false }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchEdges('node-1');
      expect(mockFetch.mock.calls[0]![0]).toContain('from=node-1');
      expect(mockFetch.mock.calls[0]![0]).toContain('scope=file');
      expect(mockFetch.mock.calls[0]![0]).toContain('limit=500');
    });

    it('sends request with symbol scope and custom cursor/limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ edges: [], total: 0, cursor: 0, hasMore: false }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchEdges('node-1', 'symbol', 100, 200);
      expect(mockFetch.mock.calls[0]![0]).toContain('scope=symbol');
      expect(mockFetch.mock.calls[0]![0]).toContain('cursor=100');
      expect(mockFetch.mock.calls[0]![0]).toContain('limit=200');
    });

    it('omits the detail param by default so the server may aggregate', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ edges: [], total: 0, cursor: 0, hasMore: false }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchEdges('node-1');
      expect(mockFetch.mock.calls[0]![0]).not.toContain('detail=');
    });

    it('requests unaggregated edges when detail is true', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ edges: [], total: 0, cursor: 0, hasMore: false }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchEdges('node-1', 'file', 0, 100, undefined, undefined, true);
      expect(mockFetch.mock.calls[0]![0]).toContain('detail=1');
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchEdges('node-1');
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchEdges('node-1');
      expect(result).toBeNull();
    });
  });

  // P3-R18-02：按需路由的条件请求。
  //
  // 缺陷的形状是"校验器可达但校验值不可达"：五条路由都能回 304，但 200 从不带 `etag`，
  // 客户端手里永远没有可回传的值。修好之后还有第二个坑：**304 不是失败**。
  // 这四个 fetcher 的返回类型是 `T | null`，`null` 已被"失败"占用；若把 304 也当失败，
  // "服务器说没变"就变成"客户端当作没有数据"，面板静默清空。
  describe('conditional requests (EtagSink)', () => {
    const outlinePayload = {
      symbols: [{ id: 's1', label: 'f', type: 'function', filePath: '/src/a.ts', lineNumber: 1, properties: {} }],
      edges: [],
    };

    function okResponse(payload: unknown, etag: string | null): Response {
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        headers: { get: (name: string) => (name === 'etag' ? etag : null) },
      } as unknown as Response;
    }

    function notModifiedResponse(etag: string | null): Response {
      return {
        ok: false,
        status: 304,
        json: async () => null,
        headers: { get: (name: string) => (name === 'etag' ? etag : null) },
      } as unknown as Response;
    }

    /** 读第 `index` 次 fetch 调用的 `if-none-match`（没有则返回 undefined）。 */
    function sentEtag(mock: ReturnType<typeof vi.fn>, index = 0): string | undefined {
      const options = mock.mock.calls[index]![1] as RequestInit | undefined;
      return (options?.headers as Record<string, string> | undefined)?.['if-none-match'];
    }

    beforeEach(() => {
      clearEtagCache();
    });

    it('a 304 is reported through the sink, not through the null-on-failure channel', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(notModifiedResponse('W/"1-abc"')) as unknown as typeof fetch;
      const sink = createEtagSink();
      const result = await fetchFileOutline('file1', undefined, undefined, sink);
      // 返回 null 是"没有新载荷"，但 sink 明确区分了"没变"与"失败"。
      expect(result).toBeNull();
      expect(sink.notModified).toBe(true);
      expect(sink.etag).toBe('W/"1-abc"');
    });

    it('a 304 without a sink stays indistinguishable from a failure (old call sites unchanged)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(notModifiedResponse('W/"1-abc"')) as unknown as typeof fetch;
      const result = await fetchFileOutline('file1');
      expect(result).toBeNull();
    });

    it('a validator is only replayed after the payload was actually committed', async () => {
      const mock = vi.fn().mockResolvedValue(okResponse(outlinePayload, 'W/"1-abc"'));
      globalThis.fetch = mock as unknown as typeof fetch;

      const sink = createEtagSink();
      const first = await fetchFileOutline('file1', undefined, undefined, sink);
      expect(first).not.toBeNull();
      // 关键：收到 200 之后、调用方提交之前，**不得**登记校验值。
      // 否则"拿到 200 但因代际过期丢弃载荷"会让下一次请求收到 304，而客户端从未应用过那份数据。
      await fetchFileOutline('file1', undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 1)).toBeUndefined();

      // 提交之后才允许回传。
      commitEtag(sink);
      await fetchFileOutline('file1', undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 2)).toBe('W/"1-abc"');
    });

    it('commitEtag is a no-op for a 304 and for a sink that never fetched', async () => {
      // 一个 304 的 sink：`notModified` 为 true，提交它不得把校验值写进缓存
      // （否则会把"没变"变成下一轮的"没变"循环，而客户端可能已经丢了载荷）。
      const notModified = createEtagSink();
      notModified.etag = 'W/"1-abc"';
      notModified.notModified = true;
      notModified.key = 'outline:file1';
      commitEtag(notModified);

      // 一个从未取数的 sink：`key` 为 null，提交它是空操作。
      commitEtag(createEtagSink());

      const mock = vi.fn().mockResolvedValue(okResponse(outlinePayload, 'W/"1-abc"'));
      globalThis.fetch = mock as unknown as typeof fetch;
      await fetchFileOutline('file1');
      expect(sentEtag(mock, 0)).toBeUndefined();
    });

    it('a validator is scoped to one request key, not to the whole resource', async () => {
      const mock = vi.fn().mockResolvedValue(okResponse(outlinePayload, 'W/"1-abc"'));
      globalThis.fetch = mock as unknown as typeof fetch;

      const sink = createEtagSink();
      await fetchFileOutline('file1', undefined, undefined, sink);
      commitEtag(sink);

      // 同一资源、不同节点：不得复用 file1 的校验值，否则 file2 会收到"没变"而客户端没有它的数据。
      await fetchFileOutline('file2', undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 1)).toBeUndefined();
      // 同一个键才复用。
      await fetchFileOutline('file1', undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 2)).toBe('W/"1-abc"');
    });

    it('pagination parameters are part of the request key', async () => {
      const mock = vi.fn().mockResolvedValue(okResponse({ nodes: [], edges: [], cursor: null, total: 0 }, 'W/"1-abc"'));
      globalThis.fetch = mock as unknown as typeof fetch;

      const sink = createEtagSink();
      await fetchNodeChildren('node-1', undefined, undefined, undefined, undefined, sink);
      commitEtag(sink);

      // 第 2 页是不同的载荷，不得命中第 1 页的校验值。
      await fetchNodeChildren('node-1', 'cursor-2', undefined, undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 1)).toBeUndefined();
      // 同一个 (node, cursor, limit) 才复用。
      await fetchNodeChildren('node-1', undefined, undefined, undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 2)).toBe('W/"1-abc"');
    });

    it('a 500 is still a failure even when a sink is passed', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'boom' }),
        headers: { get: () => null },
      }) as unknown as typeof fetch;
      const sink = createEtagSink();
      const result = await fetchFileOutline('file1', undefined, undefined, sink);
      expect(result).toBeNull();
      // 失败与"没变"必须可区分：`notModified` 保持 false。
      expect(sink.notModified).toBe(false);
    });

    it('a 304 keeps the last known validator usable for the next round trip', async () => {
      // 304 响应未必带 etag（代理可能剥掉）；此时必须回落到缓存里的值，否则客户端下一轮
      // 就发不出条件请求，每次全量重取——正是本缺陷的原始症状。
      const mock = vi.fn().mockResolvedValueOnce(okResponse(outlinePayload, 'W/"1-abc"'));
      globalThis.fetch = mock as unknown as typeof fetch;
      const first = createEtagSink();
      await fetchFileOutline('file1', undefined, undefined, first);
      commitEtag(first);

      mock.mockResolvedValueOnce(notModifiedResponse(null));
      const second = createEtagSink();
      const result = await fetchFileOutline('file1', undefined, undefined, second);
      expect(result).toBeNull();
      expect(second.notModified).toBe(true);
      expect(second.etag).toBe('W/"1-abc"');

      // 再问一次：仍然带上同一个校验值（没有因为 304 而丢掉它）。
      mock.mockResolvedValueOnce(notModifiedResponse('W/"1-abc"'));
      await fetchFileOutline('file1', undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 2)).toBe('W/"1-abc"');
    });

    it('the edges request key includes scope, limit and detail', async () => {
      const mock = vi.fn().mockResolvedValue(okResponse({ edges: [], total: 0, cursor: 0, hasMore: false }, 'W/"1-abc"'));
      globalThis.fetch = mock as unknown as typeof fetch;

      const sink = createEtagSink();
      await fetchEdges('node-1', 'file', undefined, undefined, undefined, undefined, undefined, sink);
      commitEtag(sink);

      // `detail=1` 决定这一页是聚合摘要还是原始边，载荷完全不同。
      await fetchEdges('node-1', 'file', undefined, undefined, undefined, undefined, true, createEtagSink());
      expect(sentEtag(mock, 1)).toBeUndefined();
      // scope 变了同理。
      await fetchEdges('node-1', 'symbol', undefined, undefined, undefined, undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 2)).toBeUndefined();
      // 完全相同的请求才复用。
      await fetchEdges('node-1', 'file', undefined, undefined, undefined, undefined, undefined, createEtagSink());
      expect(sentEtag(mock, 3)).toBe('W/"1-abc"');
    });
  });

  describe('fetchWithTimeout', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('passes through to fetch with signal in options', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      await fetchWithTimeout('/api/test', { method: 'GET' }, 5000);
      expect(mockFetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }));
    });

    it('aborts when external signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      globalThis.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
          }
        });
      }) as unknown as typeof fetch;
      await expect(fetchWithTimeout('/api/test', { signal: controller.signal }, 5000)).rejects.toThrow();
    });

    it('aborts when external signal fires during request', async () => {
      const controller = new AbortController();
      globalThis.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }
          setTimeout(() => controller.abort(), 10);
        });
      }) as unknown as typeof fetch;
      await expect(fetchWithTimeout('/api/test', { signal: controller.signal }, 5000)).rejects.toThrow();
    });

    it('clears timeout after successful response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
      globalThis.fetch = mockFetch as unknown as typeof fetch;
      const result = await fetchWithTimeout('/api/test', {}, 5000);
      expect(result.ok).toBe(true);
    });

    it('clears timeout after error response', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      await expect(fetchWithTimeout('/api/test', {}, 5000)).rejects.toThrow('network');
    });

    it('aborts after timeout period', async () => {
      vi.useFakeTimers();
      globalThis.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }
        });
      }) as unknown as typeof fetch;
      const promise = fetchWithTimeout('/api/test', {}, 100);
      vi.advanceTimersByTime(150);
      await expect(promise).rejects.toThrow();
      vi.useRealTimers();
    });
  });

  /**
   * 版本对比取数（cycle-104，研究报告 §六 #13）。
   *
   * 这一族用例的重点不是「解析对不对」，而是三条会静默出错的契约：
   *   1. 请求必须真的是 POST 且带 `{from,to}` —— 用 GET 会 404，而 404 被
   *      `withAbortGuard` 变成 `null`，用户只看到「对比失败」；
   *   2. 端点不在本次负载里的边必须被丢弃 —— 留着会让 cytoscape 抛
   *      「edge endpoint not found」并整块渲染失败；
   *   3. 失败必须返回 `null` 而不是空 diff —— 空 diff 会被面板显示成
   *      「两版本没有任何变更」这个虚假结论。
   */
  describe('fetchGraphDiff', () => {
    it('POSTs from/to to the diff endpoint and returns normalized nodes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: { diffStatus: 'added' } },
            { id: 'n2', label: 'B', type: 'function', filePath: 'a.ts', lineNumber: 2, properties: { diffStatus: 'removed' } },
          ],
          edges: [],
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchGraphDiff('main', 'feature');

      expect(result).not.toBeNull();
      expect(result!.from).toBe('main');
      expect(result!.to).toBe('feature');
      expect(result!.nodes).toHaveLength(2);
      // diffStatus 落在 properties 里，必须原样保留（渲染层靠它决定标记）
      expect(result!.nodes[0]!.properties?.['diffStatus']).toBe('added');

      const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('/api/v1/codegraph/diff');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ from: 'main', to: 'feature' });
    });

    it('normalizes upstream from/to edge field names into source/target', async () => {
      // 上游可能给 `from`/`to` 而不是 `source`/`target`；coerceEdge 负责归一化。
      // 不走归一化的话所有边的端点在后续 nodeIds 过滤里都会落空，整批边消失。
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            { id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1 },
            { id: 'n2', label: 'B', type: 'function', filePath: 'a.ts', lineNumber: 2 },
          ],
          edges: [{ id: 'e1', from: 'n1', to: 'n2', type: 'call' }],
        }),
      }) as unknown as typeof fetch;

      const result = await fetchGraphDiff('HEAD~1', 'HEAD');
      expect(result!.edges).toHaveLength(1);
      expect(result!.edges[0]!.source).toBe('n1');
      expect(result!.edges[0]!.target).toBe('n2');
    });

    it('drops edges whose endpoints are absent from the payload', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1 }],
          edges: [
            { id: 'e-ok', source: 'n1', target: 'n1', type: 'call' },
            { id: 'e-dangling', source: 'n1', target: 'ghost', type: 'call' },
          ],
        }),
      }) as unknown as typeof fetch;

      const result = await fetchGraphDiff('a', 'b');
      // 自环边被 coerceEdge 之外的同一条 nodeIds 过滤保留（nodeIds 含 n1），
      // 但悬空端点边必须消失。
      expect(result!.edges.map((e) => e.id)).toEqual(['e-ok']);
    });

    it('sends workspace only when it is not the default "."', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nodes: [], edges: [] }) });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await fetchGraphDiff('a', 'b', undefined, '.');
      expect(JSON.parse(String((mockFetch.mock.calls[0]![1] as RequestInit).body))).toEqual({ from: 'a', to: 'b' });

      await fetchGraphDiff('a', 'b', undefined, 'D:/repo');
      expect(JSON.parse(String((mockFetch.mock.calls[1]![1] as RequestInit).body))).toEqual({
        from: 'a', to: 'b', workspace: 'D:/repo',
      });
    });

    it('returns null on a non-ok response instead of an empty diff', async () => {
      // 关键：失败与「无变更」必须可区分。返回空 diff 会让面板显示
      // 「两个引用之间没有图结构变更」——这是把一次失败说成事实。
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
      expect(await fetchGraphDiff('a', 'b')).toBeNull();
    });

    it('returns null when the network throws', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
      expect(await fetchGraphDiff('a', 'b')).toBeNull();
    });

    it('tolerates a payload with no nodes/edges arrays', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
      const result = await fetchGraphDiff('a', 'b');
      expect(result).not.toBeNull();
      expect(result!.nodes).toEqual([]);
      expect(result!.edges).toEqual([]);
    });
  });
});