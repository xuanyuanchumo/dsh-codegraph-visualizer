/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSymbolSelectListener } from '../../../src/client/hooks/useSymbolSelectListener.ts';
import { useGraphStore } from '../../../src/client/store/graphStore.ts';
import { logger } from '../../../src/shared/Logger.ts';
import { DOM_EVENTS } from '../../../src/shared/domEvents.ts';
import { NodeId, type GraphNode } from '../../../src/types/index.ts';

function makeNode(id: string, label: string): GraphNode {
  return { id: NodeId(id), label, type: 'function', filePath: `/src/${id}.ts`, properties: {} };
}

function dispatchSymbolSelect(detail?: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(DOM_EVENTS.SYMBOL_SELECT, { detail }));
}

describe('useSymbolSelectListener', () => {
  beforeEach(() => {
    logger.clear();
    useGraphStore.setState({ rawNodes: [makeNode('n1', 'loadGraph'), makeNode('n2', 'Other.loadGraph')] });
  });

  it('ignores an event without a symbol', () => {
    const revealNode = vi.fn(() => true);
    const selectNode = vi.fn();
    renderHook(() => useSymbolSelectListener({ rendererRef: { current: { revealNode, selectNode } } }));
    dispatchSymbolSelect({});
    dispatchSymbolSelect();
    expect(revealNode).not.toHaveBeenCalled();
    expect(selectNode).not.toHaveBeenCalled();
  });

  it('ignores a symbol that matches no raw node', () => {
    const revealNode = vi.fn(() => true);
    const selectNode = vi.fn();
    renderHook(() => useSymbolSelectListener({ rendererRef: { current: { revealNode, selectNode } } }));
    dispatchSymbolSelect({ symbol: 'nothingMatchesThis' });
    expect(revealNode).not.toHaveBeenCalled();
    expect(selectNode).not.toHaveBeenCalled();
  });

  it('reveals, selects and marks the matched node as selected', () => {
    const revealNode = vi.fn(() => true);
    const selectNode = vi.fn();
    renderHook(() => useSymbolSelectListener({ rendererRef: { current: { revealNode, selectNode } } }));
    dispatchSymbolSelect({ symbol: 'loadGraph' });
    expect(revealNode).toHaveBeenCalledWith('n1');
    expect(selectNode).toHaveBeenCalledWith(NodeId('n1'));
    expect(useGraphStore.getState().selectedNodeId).toBe(NodeId('n1'));
  });

  it('selects the node without panning when the match cannot be revealed', () => {
    // A node hidden by an active filter must not be focused: that is the "clicked, nothing moved"
    // symptom this hook used to have.
    const revealNode = vi.fn(() => false);
    const selectNode = vi.fn();
    renderHook(() => useSymbolSelectListener({ rendererRef: { current: { revealNode, selectNode } } }));
    dispatchSymbolSelect({ symbol: 'loadGraph' });
    expect(revealNode).toHaveBeenCalledWith('n1');
    expect(selectNode).toHaveBeenCalledWith(NodeId('n1'));
    const warned = logger.entries().filter((e) => e.level === 'warn' && e.scope === 'symbol-select');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('not revealable');
  });

  it('stops listening after unmount', () => {
    const revealNode = vi.fn(() => true);
    const selectNode = vi.fn();
    const { unmount } = renderHook(() =>
      useSymbolSelectListener({ rendererRef: { current: { revealNode, selectNode } } }),
    );
    unmount();
    dispatchSymbolSelect({ symbol: 'loadGraph' });
    expect(revealNode).not.toHaveBeenCalled();
  });
});
