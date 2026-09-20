import { memo } from 'react';
import { CloseIcon } from './Icons.tsx';
import { useT } from '../i18n/index.ts';
import type { CoreFunction, CoreFunctionCategory } from '../../shared/analysis/CoreFunctionAnalyzer.ts';

interface CoreFunctionPanelProps {
  coreFunctions: CoreFunction[];
  onClose: () => void;
  label: string;
  onSelectFunction: (nodeId: string) => void;
}

const CATEGORY_COLORS: Record<CoreFunctionCategory, string> = {
  entry: '#4caf50',
  hub: '#ff9800',
  api: '#2196f3',
  critical: '#f44336',
};

export const CoreFunctionPanel = memo(function CoreFunctionPanel({ coreFunctions, onClose, label, onSelectFunction }: CoreFunctionPanelProps) {
  const t = useT();
  const categoryLabel = (cat: CoreFunctionCategory): string => t(`coreFunction.category.${cat}`) ?? cat;
  const reasonLabel = (r: string): string => t(`coreFunction.reason.${r}`) ?? r;

  return (
    <div className="analysis-panel core-function-panel" role="region" aria-label={label} aria-live="polite">
      <div className="analysis-panel-header">
        <span>{label}</span>
        <button onClick={onClose} className="cg-close-btn"><CloseIcon size={14} /></button>
      </div>
      <div className="analysis-panel-content">
        {coreFunctions.slice(0, 20).map((fn) => (
          <div
            key={fn.nodeId}
            className="core-function-item"
            onClick={() => onSelectFunction(fn.nodeId)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelectFunction(fn.nodeId); }}
          >
            <span
              className="core-function-category-badge"
              style={{ backgroundColor: CATEGORY_COLORS[fn.category] }}
            >
              {categoryLabel(fn.category)}
            </span>
            <span className="core-function-label">{fn.label}</span>
            <span className="core-function-score">{fn.score}</span>
            <div className="core-function-reasons">
              {fn.reasons.map((r) => (
                <span key={r} className="core-function-reason-tag">{reasonLabel(r)}</span>
              ))}
            </div>
            <div className="core-function-stats">
              <span title={t('coreFunction.inDegree')}>in:{fn.inDegree}</span>
              <span title={t('coreFunction.outDegree')}>out:{fn.outDegree}</span>
              <span title={t('coreFunction.influenceReach')}>reach:{fn.influenceReach}</span>
              <span title={t('coreFunction.callChainDepth')}>depth:{fn.callChainDepth}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
})