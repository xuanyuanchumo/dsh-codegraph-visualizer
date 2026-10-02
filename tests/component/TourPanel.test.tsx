/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { TourPanel } from '../../src/client/components/TourPanel.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import type { Tour, TourStep } from '../../src/shared/analysis/TourBuilder.ts';

function makeTourStep(
  id: string,
  title: string,
  nodeId: string,
  layer = 'entry',
  filePath = '/src/main.ts',
): TourStep {
  return {
    id,
    title,
    description: `Description for ${title}`,
    nodeId,
    nodeType: 'function',
    filePath,
    dependencies: [],
    dependents: [],
    layer,
  };
}

function makeTour(steps: TourStep[]): Tour {
  return {
    steps,
    totalSteps: steps.length,
    entryPoints: steps.length > 0 ? [steps[0]!.nodeId] : [],
  };
}

const sampleTour = makeTour([
  makeTourStep('s1', 'Entry Point', 'n1', 'entry', '/src/main.ts'),
  makeTourStep('s2', 'API Layer', 'n2', 'api', '/src/api.ts'),
  makeTourStep('s3', 'Service Layer', 'n3', 'service', '/src/service.ts'),
]);

beforeEach(() => {
  useGraphStore.setState({
    rawNodes: [],
    selectedNodeId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TourPanel component', () => {
  it('renders tour title and close button', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    expect(screen.getByText('代码导览')).toBeInTheDocument();
    expect(screen.getByLabelText('关闭导览')).toBeInTheDocument();
  });

  it('shows progress text 1 / total', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('renders current step title and description', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    expect(screen.getAllByText('Entry Point').length).toBeGreaterThan(0);
    expect(screen.getByText('Description for Entry Point')).toBeInTheDocument();
  });

  it('renders step list with all steps', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    expect(screen.getAllByText('Entry Point').length).toBeGreaterThan(0);
    expect(screen.getAllByText('API Layer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Service Layer').length).toBeGreaterThan(0);
  });

  it('disables prev button on first step', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const prevBtn = screen.getByLabelText('上一步');
    expect(prevBtn).toBeInTheDocument();
    expect(prevBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables next button on first step', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const nextBtn = screen.getByLabelText('下一步');
    expect(nextBtn).toBeInTheDocument();
    expect(nextBtn.hasAttribute('disabled')).toBe(false);
  });

  it('disables next button on last step', async () => {
    const user = userEvent.setup();
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const nextBtn = screen.getByLabelText('下一步');
    await user.click(nextBtn);
    await user.click(nextBtn);
    expect(nextBtn.hasAttribute('disabled')).toBe(true);
  });

  it('navigates to next step on next button click', async () => {
    const user = userEvent.setup();
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const nextBtn = screen.getByLabelText('下一步');
    await user.click(nextBtn);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('navigates to prev step on prev button click', async () => {
    const user = userEvent.setup();
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const nextBtn = screen.getByLabelText('下一步');
    await user.click(nextBtn);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    const prevBtn = screen.getByLabelText('上一步');
    await user.click(prevBtn);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TourPanel tour={sampleTour} onClose={onClose} />);
    const closeBtn = screen.getByLabelText('关闭导览');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls setSelectedNode when navigating to next step', async () => {
    const user = userEvent.setup();
    const setSelectedNode = vi.fn();
    useGraphStore.setState({ setSelectedNode });
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const nextBtn = screen.getByLabelText('下一步');
    await user.click(nextBtn);
    expect(setSelectedNode).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when tour has no steps', () => {
    const emptyTour = makeTour([]);
    render(<TourPanel tour={emptyTour} onClose={vi.fn()} />);
    expect(screen.getByText('暂无导览数据，请先加载代码图谱')).toBeInTheDocument();
  });

  it('shows filePath when current step has one', () => {
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    expect(screen.getByText('/src/main.ts')).toBeInTheDocument();
  });

  it('shows dependencies count when step has dependencies', () => {
    const tourWithDeps = makeTour([
      { ...makeTourStep('s1', 'Entry', 'n1'), dependencies: ['n2', 'n3'] },
    ]);
    render(<TourPanel tour={tourWithDeps} onClose={vi.fn()} />);
    expect(screen.getByText(/依赖/)).toBeInTheDocument();
  });

  it('shows dependents count when step has dependents', () => {
    const tourWithDependents = makeTour([
      { ...makeTourStep('s1', 'Entry', 'n1'), dependents: ['n2'] },
    ]);
    render(<TourPanel tour={tourWithDependents} onClose={vi.fn()} />);
    expect(screen.getByText(/被引用/)).toBeInTheDocument();
  });

  it('calls handleStepClick when step list item is clicked', async () => {
    const setSelectedNode = vi.fn();
    useGraphStore.setState({ setSelectedNode });
    render(<TourPanel tour={sampleTour} onClose={vi.fn()} />);
    const stepItems = document.querySelectorAll('.cg-tour-step-item');
    expect(stepItems.length).toBe(3);
    fireEvent.click(stepItems[1]!);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(setSelectedNode).toHaveBeenCalled();
  });
});