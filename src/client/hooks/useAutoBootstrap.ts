import { useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('auto-bootstrap');

interface UseAutoBootstrapOpts {
  collapsed: boolean;
  nodesLength: number;
  rawNodesLength: number;
  codegraphReady: boolean;
  currentWorkspace: string;
  handleScanWorkspace: () => void;
}

export function useAutoBootstrap(opts: UseAutoBootstrapOpts): void {
  const hasAutoScannedRef = useRef(false);
  useEffect(() => {
    if (hasAutoScannedRef.current) return;
    if (opts.collapsed) return;
    if (opts.nodesLength > 0 || opts.rawNodesLength > 0) return;
    if (!opts.codegraphReady) return;
    if (!opts.currentWorkspace) return;
    hasAutoScannedRef.current = true;
    log.info('auto-fill: triggering bootstrap on first open', { path: opts.currentWorkspace });
    useGraphStore.getState().loadBootstrap().then((ok) => {
      if (!ok) {
        log.info('auto-fill: bootstrap failed, falling back to scan', { path: opts.currentWorkspace });
        opts.handleScanWorkspace();
      }
    });
  }, [opts.collapsed, opts.nodesLength, opts.rawNodesLength, opts.codegraphReady, opts.currentWorkspace, opts.handleScanWorkspace]);
}