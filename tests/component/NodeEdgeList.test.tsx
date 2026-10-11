/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ fetchEdges: vi.fn() }));
vi.mock('../../src/client/api/index.ts', () => ({ fetchEdges: mocks.fetchEdges }));

import { NodeEdgeList } from '../../src/client/components/NodeEdgeList.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { internals } from '../../src/client/store/internals.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';
import type { GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeEdge(
  id: string,
  source: string,
  target: string,
  type: GraphEdge['type'] = 'call',
  properties: Record<string, unknown> = {},
): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties };
}

function page(edges: GraphEdge[], total = edges.length, hasMore = false) {
  return { edges, total, cursor: edges.length, hasMore };
}

beforeEach(() => {
  resetI18nListeners();
  setLang('en');
  mocks.fetchEdges.mockReset();
  mocks.fetchEdges.mockResolvedValue(page([]));
  internals.expandGeneration = 0;
  internals.edgeRequestSeq.clear();
  internals.expandAbortControllers.clear();
  internals.persistentCache = null;
  useGraphStore.setState({
    rawNodes: [],
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set(),
    detailEdgeNodeIds: new Set(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NodeEdgeList component', () => {
  it('renders the section heading and an empty state when there are no edges', async () => {
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-status')).toBeTruthy());
    expect(document.querySelector('.cg-detail-edges')).toBeTruthy();
    expect(screen.getByText('No edges for this node')).toBeTruthy();
  });

  it('loads the neighbourhood on mount', async () => {
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'n2')]));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(mocks.fetchEdges).toHaveBeenCalledTimes(1));
    expect(mocks.fetchEdges).toHaveBeenCalledWith(
      'n1', 'file', 0, 100, expect.any(AbortSignal), '.', false,
    );
  });

  it('renders each edge with a direction badge, endpoint label and type', async () => {
    useGraphStore.setState({ rawNodes: [{ id: NodeId('n2'), label: 'targetFn', type: 'function', filePath: 'b.ts', lineNumber: 1, properties: {} }] });
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'n2', 'import')]));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edge-item')).toBeTruthy());
    expect(document.querySelector('.cg-detail-edge-dir--out')).toBeTruthy();
    expect(screen.getByText('targetFn')).toBeTruthy();
    expect(screen.getByText('import')).toBeTruthy();
  });

  it('marks incoming edges with the inbound badge', async () => {
    useGraphStore.setState({ rawNodes: [{ id: NodeId('n3'), label: 'caller', type: 'function', filePath: 'c.ts', lineNumber: 1, properties: {} }] });
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n3', 'n1')]));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edge-item')).toBeTruthy());
    expect(document.querySelector('.cg-detail-edge-dir--in')).toBeTruthy();
    expect(screen.getByText('caller')).toBeTruthy();
  });

  it('falls back to the aggregated file pair for an unknown endpoint', async () => {
    mocks.fetchEdges.mockResolvedValue(page([
      makeEdge('agg:1', 'n1', 'file:src/deep/mod.ts', 'dependency', { aggregated: true, filePair: 'a\0b' }),
    ]));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edge-item')).toBeTruthy());
    expect(screen.getByText('mod.ts')).toBeTruthy();
  });

  it('falls back to the raw endpoint id when no label and no file pair exist', async () => {
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'mystery-id')]));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edge-item')).toBeTruthy());
    expect(screen.getByText('mystery-id')).toBeTruthy();
  });

  it('shows the loaded-of-total counter', async () => {
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'n2')], 7));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-count')).toBeTruthy());
    expect(document.querySelector('.cg-detail-edges-count')?.textContent).toBe('1 of 7 edges');
  });

  it('notes when the server aggregated the neighbourhood by file pair', async () => {
    mocks.fetchEdges.mockResolvedValue({
      edges: [makeEdge('agg:1', 'n1', 'file:b.ts', 'dependency', { aggregated: true })],
      total: 1, cursor: 0, hasMore: false, aggregated: true,
    });
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-aggregated')).toBeTruthy());
    expect(screen.getByText('Aggregated by file pair')).toBeTruthy();
  });

  // --- Scenario 8d: expanding a file-pair aggregate (P1-3) -------------------
  // An aggregate page reports hasMore:false and total===edges.length, so the
  // generic "show more" path can never reveal the collapsed edges.

  it('offers to expand an aggregated neighbourhood into raw edges', async () => {
    mocks.fetchEdges.mockResolvedValue({
      edges: [makeEdge('agg:1', 'n1', 'file:b.ts', 'dependency', { aggregated: true, count: 25 })],
      total: 1, cursor: 0, hasMore: false, aggregated: true,
    });
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-expand-aggregated')).toBeTruthy());
    const button = document.querySelector('.cg-detail-edges-expand-aggregated') as HTMLButtonElement;
    expect(button.textContent).toBe('Expand into individual edges');
    // The aggregate is one edge, below the 5-edge preview, so no generic
    // "show more" affordance exists — the expand action is the only way out.
    expect(button.classList.contains('cg-detail-edges-more')).toBe(true);
  });

  it('requests unaggregated edges with detail=1 when the aggregate is expanded', async () => {
    mocks.fetchEdges.mockResolvedValue({
      edges: [makeEdge('agg:1', 'n1', 'file:b.ts', 'dependency', { aggregated: true, count: 25 })],
      total: 1, cursor: 0, hasMore: false, aggregated: true,
    });
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-expand-aggregated')).toBeTruthy());
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n1', 'n3')], 2, false));
    await userEvent.click(document.querySelector('.cg-detail-edges-expand-aggregated') as HTMLElement);

    await waitFor(() => expect(mocks.fetchEdges).toHaveBeenCalledTimes(2));
    expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
      'n1', 'file', 0, 100, expect.any(AbortSignal), '.', true,
    );
  });

  it('replaces the aggregate with the raw edges and discloses the switch', async () => {
    mocks.fetchEdges.mockResolvedValue({
      edges: [makeEdge('agg:1', 'n1', 'file:b.ts', 'dependency', { aggregated: true, count: 25 })],
      total: 1, cursor: 0, hasMore: false, aggregated: true,
    });
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-expand-aggregated')).toBeTruthy());
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'n2')], 1, false));
    await userEvent.click(document.querySelector('.cg-detail-edges-expand-aggregated') as HTMLElement);

    await waitFor(() => expect(screen.getByText('Expanded — no longer aggregated')).toBeTruthy());
    // The aggregate notice and its action are both gone.
    expect(document.querySelector('.cg-detail-edges-expand-aggregated')).toBeNull();
    expect(screen.queryByText('Aggregated by file pair')).toBeNull();
    expect(document.querySelectorAll('.cg-detail-edge-item')).toHaveLength(1);
  });

  it('caps the preview at five edges and offers to reveal the rest', async () => {
    const edges = Array.from({ length: 8 }, (_, i) => makeEdge(`e${i}`, 'n1', `n${i + 2}`));
    mocks.fetchEdges.mockResolvedValue(page(edges, 8));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelectorAll('.cg-detail-edge-item')).toHaveLength(5));
    const more = document.querySelector('.cg-detail-edges-more');
    expect(more?.textContent).toBe('Show more edges (3 remaining)');

    await userEvent.click(more as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('.cg-detail-edge-item')).toHaveLength(8));
    // Everything is visible now, so the affordance disappears.
    expect(document.querySelector('.cg-detail-edges-more')).toBeNull();
  });

  it('requests the next page when more edges remain on the server', async () => {
    const first = Array.from({ length: 5 }, (_, i) => makeEdge(`e${i}`, 'n1', `n${i + 2}`));
    mocks.fetchEdges.mockResolvedValueOnce(page(first, 6, true));
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges-more')).toBeTruthy());
    // The preview is exhausted, so the action switches to pagination.
    expect(document.querySelector('.cg-detail-edges-more')?.textContent).toBe('Show more edges (1 remaining)');

    mocks.fetchEdges.mockResolvedValueOnce(page([makeEdge('e9', 'n1', 'n9')], 6, false));
    await userEvent.click(document.querySelector('.cg-detail-edges-more') as HTMLElement);

    await waitFor(() => expect(mocks.fetchEdges).toHaveBeenCalledTimes(2));
    expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
      'n1', 'file', 5, 100, expect.any(AbortSignal), '.', false,
    );
  });

  it('disables the action while a request is in flight', async () => {
    let release: ((v: unknown) => void) | null = null;
    mocks.fetchEdges.mockResolvedValueOnce(page([makeEdge('e1', 'n1', 'n2')], 2, true));
    render(<NodeEdgeList nodeId="n1" />);

    const button = () => document.querySelector('.cg-detail-edges-more') as HTMLButtonElement;
    await waitFor(() => expect(button()).toBeTruthy());
    expect(button().disabled).toBe(false);

    mocks.fetchEdges.mockImplementation(() => new Promise((r) => { release = r; }));
    fireEvent.click(button());

    await waitFor(() => expect(button().disabled).toBe(true));

    release!(page([makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n1', 'n3')], 2, false));
    await waitFor(() => expect(button()).toBeNull());
  });

  it('renders nothing for a null node id and issues no request', async () => {
    const { container } = render(<NodeEdgeList nodeId={null} />);

    expect(container.querySelector('.cg-detail-edges')).toBeNull();
    expect(mocks.fetchEdges).not.toHaveBeenCalled();
  });

  it('skips loading entirely when disabled', async () => {
    render(<NodeEdgeList nodeId="n1" enabled={false} />);

    expect(mocks.fetchEdges).not.toHaveBeenCalled();
  });

  it('switches to the newly selected node when the node id changes', async () => {
    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e1', 'n1', 'n2')]));
    const { rerender } = render(<NodeEdgeList nodeId="n1" />);
    await waitFor(() => expect(mocks.fetchEdges).toHaveBeenCalledTimes(1));

    mocks.fetchEdges.mockResolvedValue(page([makeEdge('e2', 'n9', 'n8')]));
    rerender(<NodeEdgeList nodeId="n9" />);

    await waitFor(() => expect(mocks.fetchEdges).toHaveBeenCalledTimes(2));
    expect(mocks.fetchEdges).toHaveBeenLastCalledWith(
      'n9', 'file', 0, 100, expect.any(AbortSignal), '.', false,
    );
  });

  it('does not refetch when re-rendered with the same node id', async () => {
    const { rerender } = render(<NodeEdgeList nodeId="n1" />);
    await waitFor(() => expect(mocks.fetchEdges).toHaveBeenCalledTimes(1));

    rerender(<NodeEdgeList nodeId="n1" />);

    expect(mocks.fetchEdges).toHaveBeenCalledTimes(1);
  });

  it('labels the region for assistive technology', async () => {
    render(<NodeEdgeList nodeId="n1" />);

    await waitFor(() => expect(document.querySelector('.cg-detail-edges')).toBeTruthy());
    const region = document.querySelector('.cg-detail-edges');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBe('Edges');
  });
});
