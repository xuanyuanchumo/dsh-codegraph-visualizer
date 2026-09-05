import React, { useState, useCallback } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, RuleIcon, AlertIcon } from './Icons.tsx';
import { getPresetRules, type RuleViolation } from '../analysis/RuleEngine.ts';

interface RuleConfigPanelProps {
  violations: RuleViolation[];
  onCheckRules: () => void;
  onClose: () => void;
}

export function RuleConfigPanel({ violations, onCheckRules, onClose }: RuleConfigPanelProps) {
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
    <div className="rule-panel" role="region" aria-label={t('rules.title')}>
      <div className="rule-panel-header">
        <RuleIcon size={14} />
        <span>{t('rules.title')}</span>
        <button onClick={onClose} aria-label={t('rules.close')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 'auto' }}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="rule-panel-content">
        <div className="rule-config-section">
          <div className="rule-config-header">
            <span>{t('rules.config')}</span>
            <button onClick={handleLoadPresets} className="rule-preset-btn">{t('rules.loadPresets')}</button>
          </div>
          {rules.length === 0 && <div className="rule-empty">{t('rules.noRules')}</div>}
          {rules.map((rule) => (
            <div key={rule.id} className="rule-item">
              <label className="rule-toggle">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggleRule(rule.id)}
                />
                <span className="rule-name">{rule.name}</span>
                <span className={`rule-severity ${rule.severity}`}>{rule.severity}</span>
              </label>
            </div>
          ))}
          <button onClick={onCheckRules} disabled={rules.filter((r) => r.enabled).length === 0} className="rule-check-btn">
            {t('rules.check')}
          </button>
        </div>

        <div className="rule-violations-section">
          <div className="rule-violations-header" onClick={() => setShowViolations((v) => !v)}>
            <span>{t('rules.violations')}</span>
            {errorCount > 0 && <span className="violation-badge error">{errorCount}</span>}
            {warningCount > 0 && <span className="violation-badge warning">{warningCount}</span>}
          </div>
          {showViolations && (
            <div className="rule-violations-list">
              {violations.length === 0 && <div className="rule-empty">{t('rules.noViolations')}</div>}
              {violations.map((v, i) => (
                <div key={`${v.ruleId}-${i}`} className={`violation-item ${v.severity}`}>
                  <AlertIcon size={12} />
                  <span className="violation-message">{v.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}