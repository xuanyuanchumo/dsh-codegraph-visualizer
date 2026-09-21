import { useState, useCallback, memo } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, RuleIcon, AlertIcon } from './Icons.tsx';
import { getPresetRules, type RuleViolation } from '../../shared/analysis/RuleEngine.ts';

interface RuleConfigPanelProps {
  violations: RuleViolation[];
  onCheckRules: () => void;
  onClose: () => void;
}

export const RuleConfigPanel = memo(function RuleConfigPanel({ violations, onCheckRules, onClose }: RuleConfigPanelProps) {
  const t = useT();
  const rules = useGraphStore((s) => s.rules);
  const setRules = useGraphStore((s) => s.setRules);
  const [showViolations, setShowViolations] = useState(true);

  const handleToggleRule = useCallback((ruleId: string) => {
    const newRules = rules.map((r) => r.id === ruleId ? { ...r, enabled: !r.enabled } : r);
    setRules(newRules);
  }, [rules, setRules]);

  const handleLoadPresets = useCallback(() => {
    setRules(getPresetRules());
  }, [setRules]);

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;

  return (
    <div className="cg-rule-panel" role="region" aria-label={t('rules.title')}>
      <div className="cg-rule-panel-header">
        <RuleIcon size={14} />
        <span>{t('rules.title')}</span>
        <button onClick={onClose} aria-label={t('rules.close')} className="cg-close-btn">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="cg-rule-panel-content">
        <div className="cg-rule-config-section">
          <div className="cg-rule-config-header">
            <span>{t('rules.config')}</span>
            <button onClick={handleLoadPresets} className="cg-rule-preset-btn">{t('rules.loadPresets')}</button>
          </div>
          {rules.length === 0 && <div className="cg-rule-empty">{t('rules.noRules')}</div>}
          {rules.map((rule) => (
            <div key={rule.id} className="cg-rule-item">
              <label className="cg-rule-toggle">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggleRule(rule.id)}
                />
                <span className="cg-rule-name">{rule.name}</span>
                <span className={`cg-rule-severity cg-${rule.severity}`}>{rule.severity}</span>
              </label>
            </div>
          ))}
          <button onClick={onCheckRules} disabled={rules.filter((r) => r.enabled).length === 0} className="cg-rule-check-btn">
            {t('rules.check')}
          </button>
        </div>

        <div className="cg-rule-violations-section">
          <div className="cg-rule-violations-header" onClick={() => setShowViolations((v) => !v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowViolations((v) => !v); } }}>
            <span>{t('rules.violations')}</span>
            {errorCount > 0 && <span className="cg-violation-badge cg-error">{errorCount}</span>}
            {warningCount > 0 && <span className="cg-violation-badge cg-warning">{warningCount}</span>}
          </div>
          {showViolations && (
            <div className="cg-rule-violations-list">
              {violations.length === 0 && <div className="cg-rule-empty">{t('rules.noViolations')}</div>}
              {violations.map((v) => (
                <div key={`${v.ruleId}-${v.edgeId ?? v.nodeId ?? v.message}`} className={`cg-violation-item cg-${v.severity}`}>
                  <AlertIcon size={12} />
                  <span className="cg-violation-message">{v.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
})