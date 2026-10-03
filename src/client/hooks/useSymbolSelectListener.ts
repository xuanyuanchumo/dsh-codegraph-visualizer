import { useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { NodeId } from '../../types/index.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('symbol-select');

interface RendererRef {
  selectNode: (id: NodeId) => void;
  /** Reveals a node hidden by `hideNode` and centres the viewport on it; `false` when it cannot. */
  revealNode: (id: string) => boolean;
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
      if (!match) return;
      store.setSelectedNode(NodeId(match.id));
      const revealed = opts.rendererRef.current?.revealNode(match.id) ?? false;
      if (!revealed) {
        // Absent from the rendered graph, or hidden by an active type/connection filter: do not
        // pan to an invisible element (that is the "clicked and nothing happened" symptom).
        log.warn('symbol match is not revealable in the rendered graph', { id: match.id, symbol: sym });
      }
      opts.rendererRef.current?.selectNode(NodeId(match.id));
    };
    window.addEventListener(DOM_EVENTS.SYMBOL_SELECT, symbolHandler);
    return () => window.removeEventListener(DOM_EVENTS.SYMBOL_SELECT, symbolHandler);
  }, [opts.rendererRef]);
}
