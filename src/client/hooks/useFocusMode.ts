import { useCallback } from 'react';
import { NodeId } from '../../types/index.ts';
import type { IRenderer } from '../renderer/IRenderer.ts';

interface UseFocusModeOpts {
  focusNodeId: string | null;
  focusDepth: number;
  setFocusDepth: (depth: number) => void;
  setSelectedNode: (id: NodeId | null) => void;
  setFocusNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  rendererRef: React.RefObject<IRenderer | null>;
}

interface UseFocusModeReturn {
  handleFocusExpand: () => void;
  handleFocusContract: () => void;
  handleFocusExit: () => void;
}

export function useFocusMode(opts: UseFocusModeOpts): UseFocusModeReturn {
  const { focusNodeId, focusDepth, setFocusDepth, setSelectedNode, setFocusNodeId, rendererRef } = opts;

  const handleFocusExpand = useCallback(() => {
    if (!focusNodeId) return;
    const newDepth = focusDepth + 1;
    setFocusDepth(newDepth);
    rendererRef.current?.expandNeighborhood(NodeId(focusNodeId), newDepth);
  }, [focusNodeId, focusDepth, setFocusDepth, rendererRef]);

  const handleFocusContract = useCallback(() => {
    if (!focusNodeId || focusDepth <= 1) return;
    const newDepth = focusDepth - 1;
    setFocusDepth(newDepth);
    rendererRef.current?.expandNeighborhood(NodeId(focusNodeId), newDepth);
  }, [focusNodeId, focusDepth, setFocusDepth, rendererRef]);

  const handleFocusExit = useCallback(() => {
    setFocusNodeId(null);
    setFocusDepth(1);
    setSelectedNode(null);
    rendererRef.current?.focusNeighborhood(null);
  }, [setFocusNodeId, setFocusDepth, setSelectedNode, rendererRef]);

  return { handleFocusExpand, handleFocusContract, handleFocusExit };
}