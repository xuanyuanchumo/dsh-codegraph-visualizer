import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

interface LayoutWorkerRequest {
  nodes: { id: string; label: string; type: string }[];
  edges: { id: string; source: string; target: string; type: string }[];
  layout: string;
}

interface LayoutWorkerResponse {
  positions: Record<string, { x: number; y: number }>;
  error?: string;
}

const mockPostMessage = vi.fn();
const selfMock = {
  onmessage: null as ((e: MessageEvent<LayoutWorkerRequest>) => void) | null,
  postMessage: mockPostMessage,
};

(globalThis as unknown as { self: typeof selfMock }).self = selfMock;

beforeAll(async () => {
  await import('../../src/client/worker/layoutWorker.ts');
}, 30000);

function sendMessage(req: LayoutWorkerRequest): LayoutWorkerResponse {
  mockPostMessage.mockClear();
  selfMock.onmessage!({ data: req } as MessageEvent<LayoutWorkerRequest>);
  return mockPostMessage.mock.calls[0]?.[0] as LayoutWorkerResponse;
}

const sampleNodes = [
  { id: 'n1', label: 'A', type: 'function' },
  { id: 'n2', label: 'B', type: 'function' },
  { id: 'n3', label: 'C', type: 'class' },
];

const sampleEdges = [
  { id: 'e1', source: 'n1', target: 'n2', type: 'call' },
  { id: 'e2', source: 'n2', target: 'n3', type: 'import' },
];

describe('layoutWorker', () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
  });

  it('computes positions for cose layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'cose' });
    expect(response.positions).toBeDefined();
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.positions.n1).toHaveProperty('x');
    expect(response.positions.n1).toHaveProperty('y');
    expect(response.error).toBeUndefined();
  });

  it('computes positions for dagre layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'dagre' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('computes positions for circle layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'circle' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('computes positions for grid layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'grid' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('computes positions for radial layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'radial' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('computes positions for tree layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'tree' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('falls back to grid for unknown layout', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: sampleEdges, layout: 'unknown' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('handles single node', () => {
    const response = sendMessage({ nodes: [sampleNodes[0]!], edges: [], layout: 'grid' });
    expect(Object.keys(response.positions)).toHaveLength(1);
    expect(response.positions.n1).toBeDefined();
  });

  it('handles empty nodes', () => {
    const response = sendMessage({ nodes: [], edges: [], layout: 'grid' });
    expect(response.positions).toEqual({});
    expect(response.error).toBeUndefined();
  });

  it('handles nodes without edges', () => {
    const response = sendMessage({ nodes: sampleNodes, edges: [], layout: 'cose' });
    expect(Object.keys(response.positions)).toHaveLength(3);
    expect(response.error).toBeUndefined();
  });

  it('returns error in response when cytoscape throws', () => {
    const response = sendMessage({
      nodes: [{ id: '', label: 'bad', type: 'function' }],
      edges: [],
      layout: 'grid',
    });
    expect(mockPostMessage).toHaveBeenCalled();
    expect(response).toHaveProperty('positions');
  });
});