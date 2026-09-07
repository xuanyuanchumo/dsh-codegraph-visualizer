import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchStatus,
  fetchGraphData,
  fetchWorkspace,
  requestScan,
  requestInit,
  requestWatch,
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
        json: async () => ({ codegraph: true, lens: false }),
      }) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({ codegraph: true, lens: false });
    });

    it('returns false/false when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({ codegraph: false, lens: false });
    });

    it('returns false/false on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchStatus();
      expect(result).toEqual({ codegraph: false, lens: false });
    });
  });

  describe('fetchGraphData', () => {
    it('returns validated graph data on success', async () => {
      const graphData = {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        metadata: { repoId: 'r1', timestamp: 1, nodeCount: 1, edgeCount: 0 },
      };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => graphData,
      }) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(1);
    });

    it('returns null when response not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).toBeNull();
    });

    it('returns null on fetch error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).toBeNull();
    });

    it('returns null when validateGraphData returns null (empty nodes)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nodes: [], edges: [], metadata: {} }),
      }) as unknown as typeof fetch;
      const result = await fetchGraphData();
      expect(result).toBeNull();
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
});