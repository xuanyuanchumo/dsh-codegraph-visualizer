import { useEffect, useRef } from 'react';
import { useT } from '../i18n/index.ts';

interface KeyboardHelpProps {
  visible: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: '/', descKey: 'shortcut.search' },
  { key: 'Esc', descKey: 'shortcut.closeAll' },
  { key: 'Ctrl+C', descKey: 'shortcut.callChain' },
  { key: 'Ctrl+E', descKey: 'shortcut.impact' },
  { key: 'Ctrl+H', descKey: 'shortcut.inheritance' },
  { key: 'Ctrl+M', descKey: 'shortcut.minimap' },
  { key: 'Ctrl+L', descKey: 'shortcut.layout' },
  { key: 'Ctrl+I', descKey: 'shortcut.import' },
  { key: 'Ctrl+Z', descKey: 'shortcut.undo' },
  { key: 'Ctrl+Y', descKey: 'shortcut.redo' },
  { key: '?', descKey: 'shortcut.help' },
];

export function KeyboardHelp({ visible, onClose }: KeyboardHelpProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>('button, [tabindex]');
    const first = focusable[0];
    first?.focus();

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && focusable.length > 0) {
        const active = document.activeElement;
        const lastIndex = focusable.length - 1;
        const currentIndex = Array.from(focusable).indexOf(active as HTMLElement);
        if (e.shiftKey && currentIndex <= 0) {
          e.preventDefault();
          focusable[lastIndex]?.focus();
        } else if (!e.shiftKey && currentIndex >= lastIndex) {
          e.preventDefault();
          focusable[0]?.focus();
        }
      }
    };
    panel.addEventListener('keydown', onKeydown);
    return () => panel.removeEventListener('keydown', onKeydown);
  }, [visible, onClose]);

  if (!visible) return null;
  return (
    <div className="keyboard-help-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shortcut.title')}>
      <div className="keyboard-help-panel" ref={panelRef} onClick={(e) => e.stopPropagation()}>
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