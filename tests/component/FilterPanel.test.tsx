/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { FilterPanel } from '../../src/client/components/FilterPanel.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
  useGraphStore.setState({
    fanInThreshold: 0,
    fanOutThreshold: 0,
    visibleNodeTypes: new Set(),
    visibleEdgeTypes: new Set(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilterPanel component', () => {
  it('renders filter panel with title and close button', () => {
    render(<FilterPanel onClose={vi.fn()} />);
    expect(document.querySelector('.cg-filter-panel')).toBeTruthy();
    expect(document.querySelector('.cg-filter-panel-close')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<FilterPanel onClose={onClose} />);
    const closeBtn = document.querySelector('.cg-filter-panel-close') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('fanIn slider', () => {
    it('renders fanIn slider with current value', () => {
      useGraphStore.setState({ fanInThreshold: 5 });
      render(<FilterPanel onClose={vi.fn()} />);
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
      expect(slider).toBeTruthy();
      expect(slider.value).toBe('5');
      expect(screen.getByText('5')).toBeTruthy();
    });

    it('calls setFanInThreshold when slider value changes', () => {
      const setFanInThreshold = vi.fn();
      useGraphStore.setState({ setFanInThreshold });
      render(<FilterPanel onClose={vi.fn()} />);
      const sliders = document.querySelectorAll('input[type="range"]');
      const fanInSlider = sliders[0] as HTMLInputElement;
      fireEvent.change(fanInSlider, { target: { value: '10' } });
      expect(setFanInThreshold).toHaveBeenCalledWith(10);
    });
  });

  describe('fanOut slider', () => {
    it('renders fanOut slider with current value', () => {
      useGraphStore.setState({ fanOutThreshold: 3 });
      render(<FilterPanel onClose={vi.fn()} />);
      const sliders = document.querySelectorAll('input[type="range"]');
      const fanOutSlider = sliders[1] as HTMLInputElement;
      expect(fanOutSlider).toBeTruthy();
      expect(fanOutSlider.value).toBe('3');
    });

    it('calls setFanOutThreshold when slider value changes', () => {
      const setFanOutThreshold = vi.fn();
      useGraphStore.setState({ setFanOutThreshold });
      render(<FilterPanel onClose={vi.fn()} />);
      const sliders = document.querySelectorAll('input[type="range"]');
      const fanOutSlider = sliders[1] as HTMLInputElement;
      fireEvent.change(fanOutSlider, { target: { value: '7' } });
      expect(setFanOutThreshold).toHaveBeenCalledWith(7);
    });
  });

  describe('node type checkboxes', () => {
    it('renders all 5 node type checkboxes', () => {
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      const nodeCheckboxes = Array.from(checkboxes).slice(0, 5);
      expect(nodeCheckboxes.length).toBe(5);
    });

    it('checkbox is checked when node type is in visibleNodeTypes', () => {
      useGraphStore.setState({ visibleNodeTypes: new Set(['function', 'class']) });
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      const functionCheckbox = checkboxes[0] as HTMLInputElement;
      const classCheckbox = checkboxes[1] as HTMLInputElement;
      expect(functionCheckbox.checked).toBe(true);
      expect(classCheckbox.checked).toBe(true);
    });

    it('checkbox is unchecked when node type is not in visibleNodeTypes', () => {
      useGraphStore.setState({ visibleNodeTypes: new Set() });
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      const functionCheckbox = checkboxes[0] as HTMLInputElement;
      expect(functionCheckbox.checked).toBe(false);
    });

    it('calls setVisibleNodeTypes with added type when unchecked checkbox is clicked', () => {
      const setVisibleNodeTypes = vi.fn();
      useGraphStore.setState({ visibleNodeTypes: new Set(), setVisibleNodeTypes });
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      fireEvent.click(checkboxes[0]!);
      expect(setVisibleNodeTypes).toHaveBeenCalled();
      const newSet = setVisibleNodeTypes.mock.calls[0]![0] as Set<string>;
      expect(newSet.has('function')).toBe(true);
    });

    it('calls setVisibleNodeTypes with removed type when checked checkbox is clicked', () => {
      const setVisibleNodeTypes = vi.fn();
      useGraphStore.setState({ visibleNodeTypes: new Set(['function']), setVisibleNodeTypes });
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      fireEvent.click(checkboxes[0]!);
      expect(setVisibleNodeTypes).toHaveBeenCalled();
      const newSet = setVisibleNodeTypes.mock.calls[0]![0] as Set<string>;
      expect(newSet.has('function')).toBe(false);
    });
  });

  describe('edge type checkboxes', () => {
    it('renders all 6 edge type checkboxes', () => {
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      const edgeCheckboxes = Array.from(checkboxes).slice(5);
      expect(edgeCheckboxes.length).toBe(6);
    });

    it('checkbox is checked when edge type is in visibleEdgeTypes', () => {
      useGraphStore.setState({ visibleEdgeTypes: new Set(['call', 'extend']) });
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      const callCheckbox = checkboxes[5] as HTMLInputElement;
      expect(callCheckbox.checked).toBe(true);
    });

    it('calls setVisibleEdgeTypes with added type when unchecked checkbox is clicked', () => {
      const setVisibleEdgeTypes = vi.fn();
      useGraphStore.setState({ visibleEdgeTypes: new Set(), setVisibleEdgeTypes });
      render(<FilterPanel onClose={vi.fn()} />);
      const checkboxes = document.querySelectorAll('.cg-filter-checkbox-item input[type="checkbox"]');
      fireEvent.click(checkboxes[5]!);
      expect(setVisibleEdgeTypes).toHaveBeenCalled();
      const newSet = setVisibleEdgeTypes.mock.calls[0]![0] as Set<string>;
      expect(newSet.has('call')).toBe(true);
    });
  });

  describe('quick action buttons', () => {
    it('renders Hide Orphans and Hide Leaves buttons', () => {
      render(<FilterPanel onClose={vi.fn()} />);
      const quickBtns = document.querySelectorAll('.cg-filter-quick-btn');
      expect(quickBtns.length).toBe(2);
    });

    it('Hide Orphans button sets fanInThreshold to 1 when current is 0', () => {
      const setFanInThreshold = vi.fn();
      useGraphStore.setState({ fanInThreshold: 0, setFanInThreshold });
      render(<FilterPanel onClose={vi.fn()} />);
      const orphanBtn = document.querySelectorAll('.cg-filter-quick-btn')[0] as HTMLButtonElement;
      fireEvent.click(orphanBtn);
      expect(setFanInThreshold).toHaveBeenCalledWith(1);
    });

    it('Hide Orphans button resets fanInThreshold to 0 when current is >0', () => {
      const setFanInThreshold = vi.fn();
      useGraphStore.setState({ fanInThreshold: 1, setFanInThreshold });
      render(<FilterPanel onClose={vi.fn()} />);
      const orphanBtn = document.querySelectorAll('.cg-filter-quick-btn')[0] as HTMLButtonElement;
      fireEvent.click(orphanBtn);
      expect(setFanInThreshold).toHaveBeenCalledWith(0);
    });

    it('Hide Leaves button sets fanOutThreshold to 1 when current is 0', () => {
      const setFanOutThreshold = vi.fn();
      useGraphStore.setState({ fanOutThreshold: 0, setFanOutThreshold });
      render(<FilterPanel onClose={vi.fn()} />);
      const leavesBtn = document.querySelectorAll('.cg-filter-quick-btn')[1] as HTMLButtonElement;
      fireEvent.click(leavesBtn);
      expect(setFanOutThreshold).toHaveBeenCalledWith(1);
    });

    it('Hide Leaves button resets fanOutThreshold to 0 when current is >0', () => {
      const setFanOutThreshold = vi.fn();
      useGraphStore.setState({ fanOutThreshold: 1, setFanOutThreshold });
      render(<FilterPanel onClose={vi.fn()} />);
      const leavesBtn = document.querySelectorAll('.cg-filter-quick-btn')[1] as HTMLButtonElement;
      fireEvent.click(leavesBtn);
      expect(setFanOutThreshold).toHaveBeenCalledWith(0);
    });
  });

  describe('reset button', () => {
    it('renders reset button', () => {
      render(<FilterPanel onClose={vi.fn()} />);
      expect(document.querySelector('.cg-filter-reset-btn')).toBeTruthy();
    });

    it('calls all reset functions when clicked', () => {
      const setFanInThreshold = vi.fn();
      const setFanOutThreshold = vi.fn();
      const setVisibleNodeTypes = vi.fn();
      const setVisibleEdgeTypes = vi.fn();
      useGraphStore.setState({
        fanInThreshold: 5,
        fanOutThreshold: 3,
        visibleNodeTypes: new Set(['function']),
        visibleEdgeTypes: new Set(['call']),
        setFanInThreshold,
        setFanOutThreshold,
        setVisibleNodeTypes,
        setVisibleEdgeTypes,
      });
      render(<FilterPanel onClose={vi.fn()} />);
      const resetBtn = document.querySelector('.cg-filter-reset-btn') as HTMLButtonElement;
      fireEvent.click(resetBtn);
      expect(setFanInThreshold).toHaveBeenCalledWith(0);
      expect(setFanOutThreshold).toHaveBeenCalledWith(0);
      expect(setVisibleNodeTypes).toHaveBeenCalledWith(new Set());
      expect(setVisibleEdgeTypes).toHaveBeenCalledWith(new Set());
    });
  });

  it('has accessible region with aria-label', () => {
    render(<FilterPanel onClose={vi.fn()} />);
    const region = document.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-label')).toBeTruthy();
  });
});