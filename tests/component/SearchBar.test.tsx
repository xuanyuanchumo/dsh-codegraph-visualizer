/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { SearchBar } from '../../src/client/components/SearchBar.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = vi.fn();

describe('SearchBar (FR-07) component', () => {
  it('renders input with placeholder', () => {
    render(<SearchBar query="" matchCount={null} searchResults={[]} onChange={noop} onClose={noop} onSelectResult={noop} />);
    const input = screen.getByRole('textbox');
    expect(input).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBeTruthy();
  });

  it('calls onChange when typing in the input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar query="" matchCount={null} searchResults={[]} onChange={onChange} onClose={noop} onSelectResult={noop} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'foo');
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchBar query="" matchCount={null} searchResults={[]} onChange={noop} onClose={onClose} onSelectResult={noop} />);
    const closeBtn = screen.getByRole('button');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows match count when query and matchCount are present', () => {
    render(<SearchBar query="foo" matchCount={3} searchResults={[]} onChange={noop} onClose={noop} onSelectResult={noop} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows no-match message when matchCount is 0', () => {
    render(<SearchBar query="foo" matchCount={0} searchResults={[]} onChange={noop} onClose={noop} onSelectResult={noop} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows debounced hint when query is empty', () => {
    render(<SearchBar query="" matchCount={null} searchResults={[]} onChange={noop} onClose={noop} onSelectResult={noop} />);
    const hints = document.querySelectorAll('.cg-search-hint');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('shows search results dropdown when results are present', () => {
    const results = [
      { id: 'n1', label: 'GraphPanel', type: 'function', filePath: 'src/GraphPanel.tsx' },
      { id: 'n2', label: 'GraphStore', type: 'class', filePath: 'src/GraphStore.ts' },
    ];
    render(<SearchBar query="Graph" matchCount={2} searchResults={results} onChange={noop} onClose={noop} onSelectResult={noop} />);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(2);
  });

  it('calls onSelectResult when a result item is clicked', async () => {
    const user = userEvent.setup();
    const onSelectResult = vi.fn();
    const results = [
      { id: 'n1', label: 'GraphPanel', type: 'function', filePath: 'src/GraphPanel.tsx' },
    ];
    render(<SearchBar query="Graph" matchCount={1} searchResults={results} onChange={noop} onClose={noop} onSelectResult={onSelectResult} />);
    const option = screen.getByRole('option');
    await user.click(option);
    expect(onSelectResult).toHaveBeenCalledWith('n1');
  });

  it('calls onSelectResult when Enter is pressed on a result item', () => {
    const onSelectResult = vi.fn();
    const results = [
      { id: 'n1', label: 'GraphPanel', type: 'function', filePath: 'src/GraphPanel.tsx' },
    ];
    render(<SearchBar query="Graph" matchCount={1} searchResults={results} onChange={noop} onClose={noop} onSelectResult={onSelectResult} />);
    const option = screen.getByRole('option');
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(onSelectResult).toHaveBeenCalledWith('n1');
  });

  it('does not show dropdown when searchResults is empty', () => {
    render(<SearchBar query="foo" matchCount={0} searchResults={[]} onChange={noop} onClose={noop} onSelectResult={noop} />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
