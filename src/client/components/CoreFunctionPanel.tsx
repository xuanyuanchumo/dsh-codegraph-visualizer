import { memo } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import type { CoreFunction, CoreFunctionCategory } from '../../shared/analysis/CoreFunctionAnalyzer.ts';

interface CoreFunctionPanelProps {
  coreFunctions: CoreFunction[];
  onClose: () => void;
  label: string;
  onSelectFunction: (nodeId: string) => void;
}

const CATEGORY_COLORS: Record<CoreFunctionCategory, string> = {
  entry: 'var(--cg-node-function)',
  hub: 'var(--cg-accent)',
  api: 'var(--cg-node-interface)',
  critical: 'var(--cg-node-class)',
};

export const CoreFunctionPanel = memo(function CoreFunctionPanel({ coreFunctions, onClose, label, onSelectFunction }: CoreFunctionPanelProps) {
  const t = useT();
  const categoryLabel = (cat: CoreFunctionCategory): string => t(`coreFunction.category.${cat}`);
  const reasonLabel = (r: string): string => t(`coreFunction.reason.${r}`);

  return (
    <AnalysisPanelShell variant="core-function" label={label} onClose={onClose}>
      {coreFunctions.slice(0, 20).map((fn) => (
        <div
          key={fn.nodeId}
          className="cg-core-function-item"
          onClick={() => onSelectFunction(fn.nodeId)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectFunction(fn.nodeId); } }}
        >
          <span
            className="cg-core-function-category-badge"
            style={{ backgroundColor: CATEGORY_COLORS[fn.category] }}
          >
            {categoryLabel(fn.category)}
          </span>
          <span className="cg-core-function-label">{fn.label}</span>
          <span className="cg-core-function-score">{fn.score}</span>
          <div className="cg-core-function-reasons">
            {fn.reasons.map((r) => (
              <span key={r} className="cg-core-function-reason-tag">{reasonLabel(r)}</span>
            ))}
          </div>
          <div className="cg-core-function-stats">
            <span title={t('coreFunction.inDegree')}>in:{fn.inDegree}</span>
            <span title={t('coreFunction.outDegree')}>out:{fn.outDegree}</span>
            <span title={t('coreFunction.influenceReach')}>reach:{fn.influenceReach}</span>
            <span title={t('coreFunction.callChainDepth')}>depth:{fn.callChainDepth}</span>
          </div>
        </div>
      ))}
    </AnalysisPanelShell>
  );
});