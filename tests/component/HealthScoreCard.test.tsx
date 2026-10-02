/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { HealthScoreCard } from '../../src/client/components/HealthScoreCard.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import type { HealthScore } from '../../src/types/index.ts';

const sampleScore: HealthScore = {
  coupling: 75,
  cohesion: 82,
  cyclicDependencyRate: 90,
  modularity: 68,
  overall: 79,
};

beforeEach(() => {
  useGraphStore.setState({ healthScore: sampleScore });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HealthScoreCard (FR-32) component', () => {
  it('renders overall score and dimension bars when healthScore is present', () => {
    render(<HealthScoreCard onClose={vi.fn()} />);
    expect(screen.getByText('79')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
  });

  it('shows empty message when healthScore is null', () => {
    useGraphStore.setState({ healthScore: null });
    render(<HealthScoreCard onClose={vi.fn()} />);
    const emptyEl = document.querySelector('.cg-health-score-empty');
    expect(emptyEl).toBeInTheDocument();
    expect(emptyEl?.textContent).toBeTruthy();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HealthScoreCard onClose={onClose} />);
    const closeBtn = screen.getByRole('button');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies correct color class for high score (>=80)', () => {
    useGraphStore.setState({
      healthScore: { coupling: 85, cohesion: 90, cyclicDependencyRate: 95, modularity: 88, overall: 89 },
    });
    render(<HealthScoreCard onClose={vi.fn()} />);
    const fills = document.querySelectorAll('.cg-health-dimension-fill');
    expect(fills.length).toBe(4);
  });

  it('applies warning color for medium score (60-79)', () => {
    useGraphStore.setState({
      healthScore: { coupling: 65, cohesion: 70, cyclicDependencyRate: 60, modularity: 75, overall: 67 },
    });
    render(<HealthScoreCard onClose={vi.fn()} />);
    const fills = document.querySelectorAll('.cg-health-dimension-fill');
    expect(fills.length).toBe(4);
  });

  it('applies error color for low score (<60)', () => {
    useGraphStore.setState({
      healthScore: { coupling: 40, cohesion: 35, cyclicDependencyRate: 50, modularity: 45, overall: 42 },
    });
    render(<HealthScoreCard onClose={vi.fn()} />);
    const fills = document.querySelectorAll('.cg-health-dimension-fill');
    expect(fills.length).toBe(4);
  });
});
