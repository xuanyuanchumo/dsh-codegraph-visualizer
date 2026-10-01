import React from 'react';
import { GraphIcon } from './Icons.tsx';
import { GraphErrorBoundary } from './ErrorBoundary.tsx';
import { GraphPanel } from '../GraphPanel.tsx';
import { t } from '../i18n/index.ts';

export function SidebarNavButton({ onClick, active }: { onClick: () => void; active: boolean }): React.ReactElement {
  return React.createElement('button', {
    onClick,
    className: `cg-sidebar-nav-btn${active ? ' cg-sidebar-nav-btn-active' : ''}`,
    title: t('nav.title'),
    'aria-label': t('nav.ariaLabel'),
  }, React.createElement(GraphIcon, { size: 18 }));
}

export function FloatingGraphPanel({ onClose, onMinimize }: { onClose: () => void; onMinimize: () => void }): React.ReactElement {
  return React.createElement('div', { className: 'cg-floating-overlay' },
    React.createElement('div', { className: 'cg-floating-panel' },
      React.createElement('div', { className: 'cg-floating-header' },
        React.createElement('div', { className: 'cg-floating-header-left' },
          React.createElement('span', { className: 'cg-floating-title' }, t('nav.title')),
          React.createElement('span', { className: 'cg-floating-mode-badge' }, t('nav.modeFloating')),
        ),
        React.createElement('div', { className: 'cg-floating-header-actions' },
          React.createElement('button', {
            onClick: onMinimize,
            className: 'cg-floating-minimize',
            'aria-label': t('nav.minimizePanel'),
            title: t('nav.minimizePanel'),
          }, '\u2013'),
          React.createElement('button', {
            onClick: onClose,
            className: 'cg-floating-close',
            'aria-label': t('nav.closePanel'),
          }, '\u00d7'),
        ),
      ),
      React.createElement('div', { className: 'cg-floating-content' },
        React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)),
      ),
    ),
  );
}

export function MinimizedFloatingButton({ onRestore }: { onRestore: () => void }): React.ReactElement {
  return React.createElement('button', {
    onClick: onRestore,
    className: 'cg-floating-minimized-btn',
    'aria-label': t('nav.restorePanel'),
    title: t('nav.restorePanel'),
  }, React.createElement(GraphIcon, { size: 20 }));
}