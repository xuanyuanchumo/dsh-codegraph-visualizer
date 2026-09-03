import React from 'react';
import { useT } from '../i18n/index.ts';

interface KeyboardHelpProps {
  visible: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: '/', descKey: 'shortcut.search' },
  { key: 'Esc', descKey: 'shortcut.closeAll' },
  { key: 'Ctrl+C', descKey: 'shortcut.callChain' },
  { key: 'Ctrl+M', descKey: 'shortcut.minimap' },
  { key: 'Ctrl+L', descKey: 'shortcut.layout' },
  { key: 'Ctrl+I', descKey: 'shortcut.import' },
  { key: '?', descKey: 'shortcut.help' },
];

export function KeyboardHelp({ visible, onClose }: KeyboardHelpProps) {
  const t = useT();
  if (!visible) return null;
  return (
    <div className="keyboard-help-overlay" onClick={onClose}>
      <div className="keyboard-help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="keyboard-help-header">
          <span>{t('shortcut.title')}</span>
          <button className="keyboard-help-close" onClick={onClose} aria-label={t('shortcut.close')}>×</button>
        </div>
        <div className="keyboard-help-list">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="keyboard-help-item">
              <kbd className="keyboard-help-key">{s.key}</kbd>
              <span className="keyboard-help-desc">{t(s.descKey)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}