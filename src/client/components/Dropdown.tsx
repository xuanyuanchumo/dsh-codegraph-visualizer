import { useRef, useCallback, memo, useState, type ReactNode } from 'react';
import { useDismissable } from '../hooks/useDismissable.ts';

export type DropdownChildren = ReactNode | ((close: () => void) => ReactNode);

export interface DropdownProps {
  triggerClassName: string;
  triggerTitle: string;
  triggerAriaLabel: string;
  triggerContent: ReactNode;
  triggerAriaHasPopup?: 'menu' | 'true' | 'false';
  contentClassName?: string;
  contentRole?: string;
  children: DropdownChildren;
  onOpenChange?: (open: boolean) => void;
  closeOnOutsideClick?: boolean;
  containerClassName?: string;
}

export const Dropdown = memo(function Dropdown({
  triggerClassName,
  triggerTitle,
  triggerAriaLabel,
  triggerContent,
  triggerAriaHasPopup,
  contentClassName = 'cg-dropdown-content',
  contentRole,
  children,
  onOpenChange,
  closeOnOutsideClick = true,
  containerClassName = 'cg-dropdown-menu',
}: DropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  useDismissable(containerRef, open, close, { closeOnOutsideClick });

  return (
    <div className={containerClassName} ref={containerRef}>
      <button
        className={`${triggerClassName} ${open ? 'cg-active' : ''}`}
        onClick={toggle}
        title={triggerTitle}
        aria-label={triggerAriaLabel}
        aria-expanded={open}
        aria-haspopup={triggerAriaHasPopup}
      >
        {triggerContent}
      </button>
      {open && (
        <div className={contentClassName} role={contentRole}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
});