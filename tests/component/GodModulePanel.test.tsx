/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { GodModulePanel } from '../../src/client/components/GodModulePanel.tsx';
import type { GodModule } from '../../src/client/hooks/useAnalysisPanels.ts';

const sampleModules: GodModule[] = [
  { modulePath: 'src/core/engine.ts', nodeCount: 50, edgeCount: 120, suggestion: 'Consider splitting into smaller modules' },
  { modulePath: 'src/utils/helpers.ts', nodeCount: 30, edgeCount: 60, suggestion: 'Extract utility functions' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GodModulePanel component', () => {
  it('renders label in header', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n} nodes, ${e} edges`} />);
    expect(screen.getByText('God Modules')).toBeInTheDocument();
  });

  it('renders module paths', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n} nodes, ${e} edges`} />);
    expect(screen.getByText('src/core/engine.ts')).toBeInTheDocument();
    expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument();
  });

  it('renders stats via statsLabel callback', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}n/${e}e`} />);
    expect(screen.getByText('50n/120e')).toBeInTheDocument();
    expect(screen.getByText('30n/60e')).toBeInTheDocument();
  });

  it('renders suggestions', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}, ${e}`} />);
    expect(screen.getByText('Consider splitting into smaller modules')).toBeInTheDocument();
    expect(screen.getByText('Extract utility functions')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GodModulePanel godModules={sampleModules} onClose={onClose} label="God Modules" statsLabel={(n, e) => `${n}`} />);
    const closeBtn = screen.getByRole('button');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has role="region" with correct aria-label', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Module Detection" statsLabel={(n, e) => `${n}`} />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-label')).toBe('God Module Detection');
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}`} />);
    const region = screen.getByRole('region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('applies correct CSS class names', () => {
    render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}`} />);
    expect(document.querySelector('.cg-analysis-panel.cg-godmodule-panel')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-header')).toBeInTheDocument();
    expect(document.querySelector('.cg-analysis-panel-content')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-item')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-path')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-stats')).toBeInTheDocument();
    expect(document.querySelector('.cg-godmodule-suggestion')).toBeInTheDocument();
  });

  it('renders empty list without crashing', () => {
    render(<GodModulePanel godModules={[]} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}`} />);
    const items = document.querySelectorAll('.cg-godmodule-item');
    expect(items.length).toBe(0);
  });

  it('updates when godModules prop changes', () => {
    const { rerender } = render(<GodModulePanel godModules={sampleModules} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}`} />);
    expect(screen.getByText('src/core/engine.ts')).toBeInTheDocument();
    rerender(<GodModulePanel godModules={[{ modulePath: 'new.ts', nodeCount: 1, edgeCount: 1, suggestion: 'New' }]} onClose={vi.fn()} label="God Modules" statsLabel={(n, e) => `${n}`} />);
    expect(screen.getByText('new.ts')).toBeInTheDocument();
    expect(screen.queryByText('src/core/engine.ts')).toBeNull();
  });
});