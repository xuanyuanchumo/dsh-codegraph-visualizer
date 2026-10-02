import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useT } from '../../i18n/index.ts';

export interface DropdownItem {
  panel: string;
  Icon: React.ComponentType<{ size?: number }>;
  key: string;
  btnClass?: string;
  active?: boolean;
  onClick: () => void;
  role?: 'menuitem' | 'menuitemcheckbox';
}

interface ToolbarDropdownProps {
  items: DropdownItem[];
  triggerContent: React.ReactNode;
  triggerTitle: string;
  triggerClassName?: string;
  contentClassName?: string;
  triggerAriaLabel?: string;
  triggerAriaHasPopup?: 'menu' | 'listbox' | 'dialog';
}

export function ToolbarDropdown({
  items,
  triggerContent,
  triggerTitle,
  triggerClassName = '',
  contentClassName = '',
  triggerAriaLabel,
  triggerAriaHasPopup = 'menu',
}: ToolbarDropdownProps) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, close]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        close();
        triggerRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, close]);

  return (
    <div className={`cg-toolbar-dropdown ${triggerClassName}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`cg-toolbar-dropdown-trigger ${isOpen ? 'cg-active' : ''}`}
        onClick={toggleOpen}
        title={triggerTitle}
        aria-label={triggerAriaLabel || triggerTitle}
        aria-haspopup={triggerAriaHasPopup}
        aria-expanded={isOpen}
      >
        {triggerContent}
      </button>
      {isOpen && (
        <div className={`cg-toolbar-dropdown-content ${contentClassName}`} role="menu">
          {items.map((item, idx) => (
            <button
              key={item.panel || idx}
              type="button"
              className={`cg-dropdown-item ${item.btnClass || ''} ${item.active ? 'cg-active' : ''}`}
              onClick={() => {
                item.onClick();
                close();
              }}
              role={item.role || 'menuitemcheckbox'}
              aria-checked={item.active}
            >
              {item.Icon && <item.Icon size={14} />}
              <span>{t(item.key)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}