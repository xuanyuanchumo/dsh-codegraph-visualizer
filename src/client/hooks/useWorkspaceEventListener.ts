import { useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';

export function useWorkspaceEventListener() {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string };
      if (detail?.path) useGraphStore.getState().setCurrentWorkspace(detail.path);
    };
    window.addEventListener(DOM_EVENTS.WORKSPACE, handler);
    return () => window.removeEventListener(DOM_EVENTS.WORKSPACE, handler);
  }, []);
}