import { memo, useEffect, useRef } from 'react';
import { useT } from '../i18n/index.ts';
import { KEYBOARD_SHORTCUTS, formatShortcutKey } from '../hooks/usePanelKeyboard.ts';

interface KeyboardHelpProps {
  visible: boolean;
  onClose: () => void;
}

export const KeyboardHelp = memo(function KeyboardHelp({ visible, onClose }: KeyboardHelpProps) {
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
    <div className="cg-keyboard-help-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shortcut.title')}>
      <div className="cg-keyboard-help-panel" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="cg-keyboard-help-header">
          <span>{t('shortcut.title')}</span>
          <button className="cg-keyboard-help-close" onClick={onClose} aria-label={t('shortcut.close')}>×</button>
        </div>
        <div className="cg-keyboard-help-list">
          {KEYBOARD_SHORTCUTS.map((s) => (
            <div key={s.key} className="cg-keyboard-help-item">
              <kbd className="cg-keyboard-help-key">{formatShortcutKey(s)}</kbd>
              <span className="cg-keyboard-help-desc">{t(s.descKey)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});