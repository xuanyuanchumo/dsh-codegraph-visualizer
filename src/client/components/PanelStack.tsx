import type { ReactNode } from 'react';
import { GraphErrorBoundary } from './ErrorBoundary.tsx';

export interface PanelStackItem {
  visible: boolean;
  children: ReactNode;
}

interface PanelStackProps {
  side: 'left' | 'right';
  isCollapsed: boolean;
  items: PanelStackItem[];
}

export function PanelStack({ side, isCollapsed, items }: PanelStackProps) {
  if (isCollapsed) return null;
  return (
    <div className={`cg-panel-stack cg-panel-stack-${side}`}>
      {items.map(({ visible, children }, i) =>
        visible ? <GraphErrorBoundary key={i}>{children}</GraphErrorBoundary> : null,
      )}
    </div>
  );
}