import { useMemo, useState, memo } from 'react';
import type { GraphEdge } from '../../types/index.ts';
import { useT } from '../i18n/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { useNodeEdgeList } from '../hooks/useNodeEdgeList.ts';

interface NodeEdgeListProps {
  /** Selected node id, or null when nothing is selected. */
  nodeId: string | null;
  /** Skip fetching when the host panel cannot display edges. */
  enabled?: boolean;
}

function basename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

function endpointLabel(edge: GraphEdge, nodeId: string, labels: Map<string, string>): string {
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  const label = labels.get(otherId);
  if (label) return label;
  const filePair = edge.properties?.filePair;
  if (typeof filePair === 'string') return basename(otherId);
  return otherId;
}

/**
 * Authoritative edge neighbourhood for the selected node, served by
 * `GET /api/v1/codegraph/edges`.
 *
 * The rendered graph only holds edges reachable from expanded nodes, so this
 * list is what makes the panel's connection count trustworthy: it reports the
 * server total, pages through it on demand, and surfaces the file-pair
 * aggregation the server applies to dense neighbourhoods.
 */
export const NodeEdgeList = memo(function NodeEdgeList({ nodeId, enabled = true }: NodeEdgeListProps) {
  const t = useT();
  const rawNodes = useGraphStore((s) => s.rawNodes);
  const { edges, total, isLoading, isAggregated, hasMore, previewLimit, loadMore } = useNodeEdgeList(nodeId, enabled);
  const [showAll, setShowAll] = useState(false);

  const labels = useMemo(
    () => new Map(rawNodes.map((n) => [n.id as string, n.label])),
    [rawNodes],
  );

  if (nodeId === null) return null;

  const visibleEdges = showAll ? edges : edges.slice(0, previewLimit);
  const hiddenCount = edges.length - visibleEdges.length;
  const remaining = total !== null ? Math.max(total - visibleEdges.length, 0) : hiddenCount;

  const action = hiddenCount > 0
    ? { label: t('detail.edgesShowMore', { count: remaining }), run: () => setShowAll(true) }
    : hasMore
      ? { label: t('detail.edgesShowMore', { count: remaining }), run: loadMore }
      : null;

  return (
    <div className="cg-detail-edges" role="region" aria-label={t('detail.edgesTitle')}>
      <div className="cg-detail-section-title">
        {t('detail.edgesTitle')}
        {total !== null && total > 0 && (
          <span className="cg-detail-edges-count">
            {t('detail.edgesLoadedOf', { loaded: edges.length, total })}
          </span>
        )}
      </div>
      {isAggregated && <div className="cg-detail-edges-aggregated">{t('detail.edgesAggregated')}</div>}
      {isLoading && edges.length === 0 && (
        <div className="cg-detail-edges-status">{t('detail.edgesLoading')}</div>
      )}
      {!isLoading && edges.length === 0 && (
        <div className="cg-detail-edges-status">{t('detail.edgesEmpty')}</div>
      )}
      <ul className="cg-detail-edge-list">
        {visibleEdges.map((edge) => {
          const outgoing = edge.source === nodeId;
          return (
            <li className="cg-detail-edge-item" key={edge.id} title={edge.id}>
              <span
                className={`cg-detail-edge-dir cg-detail-edge-dir--${outgoing ? 'out' : 'in'}`}
                aria-label={t(outgoing ? 'detail.edgeOutgoing' : 'detail.edgeIncoming')}
              >
                {t(outgoing ? 'detail.edgeOutgoing' : 'detail.edgeIncoming')}
              </span>
              <span className="cg-detail-edge-label">{endpointLabel(edge, nodeId, labels)}</span>
              <span className="cg-detail-edge-type">{edge.type}</span>
            </li>
          );
        })}
      </ul>
      {action && (
        <button type="button" className="cg-detail-edges-more" onClick={action.run} disabled={isLoading}>
          {action.label}
        </button>
      )}
    </div>
  );
});
