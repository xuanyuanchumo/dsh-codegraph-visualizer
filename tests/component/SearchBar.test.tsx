/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { SearchBar } from '../../src/client/components/SearchBar.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SearchBar (FR-07) component', () => {
  it('renders input with placeholder', () => {
    render(<SearchBar query="" matchCount={null} onChange={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox');
    expect(input).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBeTruthy();
  });

  it('calls onChange when typing in the input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar query="" matchCount={null} onChange={onChange} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'foo');
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchBar query="" matchCount={null} onChange={vi.fn()} onClose={onClose} />);
    const closeBtn = screen.getByRole('button');
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows match count when query and matchCount are present', () => {
    render(<SearchBar query="foo" matchCount={3} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows no-match message when matchCount is 0', () => {
    render(<SearchBar query="foo" matchCount={0} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows debounced hint when query is empty', () => {
    render(<SearchBar query="" matchCount={null} onChange={vi.fn()} onClose={vi.fn()} />);
    const hints = document.querySelectorAll('.search-hint');
    expect(hints.length).toBeGreaterThan(0);
  });
});
