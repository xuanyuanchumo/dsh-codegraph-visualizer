
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, ExpandIcon, ContractIcon, FocusIcon } from './Icons.tsx';

interface FocusModeBarProps {
  focusNodeId: string | null;
  onExpand: () => void;
  onContract: () => void;
  onExit: () => void;
}

export function FocusModeBar({ focusNodeId, onExpand, onContract, onExit }: FocusModeBarProps) {
  const t = useT();
  const focusDepth = useGraphStore((s) => s.focusDepth);
  const focusLabel = useGraphStore((s) => {
    if (!focusNodeId) return null;
    return s.rawNodes.find((n) => n.id === focusNodeId)?.label ?? focusNodeId;
  });

  if (!focusNodeId) return null;

  return (
    <div className="focus-mode-bar" role="region" aria-label={t('focus.title')}>
      <FocusIcon size={14} />
      <span className="focus-label">{t('focus.mode')}: {focusLabel}</span>
      <span className="focus-depth">{t('focus.depth')}: {focusDepth}</span>
      <button onClick={onExpand} className="focus-expand-btn" title={t('focus.expand')} aria-label={t('focus.expand')}>
        <ExpandIcon size={14} />
      </button>
      <button onClick={onContract} className="focus-contract-btn" title={t('focus.contract')} aria-label={t('focus.contract')} disabled={focusDepth <= 1}>
        <ContractIcon size={14} />
      </button>
      <button onClick={onExit} className="focus-exit-btn" title={t('focus.exit')} aria-label={t('focus.exit')}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}