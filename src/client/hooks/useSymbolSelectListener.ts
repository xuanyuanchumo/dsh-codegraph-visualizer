import { useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { NodeId } from '../../types/index.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

interface RendererRef {
  focusOnNode: (id: string) => void;
  selectNode: (id: NodeId) => void;
}

interface UseSymbolSelectListenerOpts {
  rendererRef: React.RefObject<RendererRef | null>;
}

export function useSymbolSelectListener(opts: UseSymbolSelectListenerOpts): void {
  useEffect(() => {
    const symbolHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { symbol?: string };
      if (!detail?.symbol) return;
      const sym = detail.symbol;
      const store = useGraphStore.getState();
      const match = store.rawNodes.find((n) =>
        n.label === sym || n.label.endsWith(`.${sym}`) || n.label.includes(sym),
      );
      if (match) {
        store.setSelectedNode(NodeId(match.id));
        opts.rendererRef.current?.focusOnNode(match.id);
        opts.rendererRef.current?.selectNode(NodeId(match.id));
      }
    };
    window.addEventListener(DOM_EVENTS.SYMBOL_SELECT, symbolHandler);
    return () => window.removeEventListener(DOM_EVENTS.SYMBOL_SELECT, symbolHandler);
  }, [opts.rendererRef]);
}