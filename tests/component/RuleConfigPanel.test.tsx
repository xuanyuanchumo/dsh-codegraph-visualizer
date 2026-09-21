/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { RuleConfigPanel } from '../../src/client/components/RuleConfigPanel.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { getPresetRules } from '../../src/shared/analysis/RuleEngine.ts';
import type { RuleViolation } from '../../src/shared/analysis/RuleEngine.ts';

const sampleViolations: RuleViolation[] = [
  { ruleId: 'r1', nodeId: 'n1' as RuleViolation['nodeId'], message: 'Node A violates r1', severity: 'error' },
  { ruleId: 'r1', nodeId: 'n2' as RuleViolation['nodeId'], message: 'Node B violates r1', severity: 'error' },
  { ruleId: 'r2', nodeId: 'n3' as RuleViolation['nodeId'], message: 'Node C violates r2', severity: 'warning' },
];

beforeEach(() => {
  useGraphStore.setState({ rules: getPresetRules() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RuleConfigPanel (FR-34) component', () => {
  it('renders preset rules with checkbox state and counts violations by severity', () => {
    render(<RuleConfigPanel violations={sampleViolations} onCheckRules={vi.fn()} onClose={vi.fn()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(getPresetRules().length);
    const errorBadge = document.querySelector('.cg-violation-badge.cg-error');
    const warningBadge = document.querySelector('.cg-violation-badge.cg-warning');
    expect(errorBadge?.textContent).toBe('2');
    expect(warningBadge?.textContent).toBe('1');
  });

  it('toggling a rule flips its enabled state in the store', async () => {
    const user = userEvent.setup();
    render(<RuleConfigPanel violations={[]} onCheckRules={vi.fn()} onClose={vi.fn()} />);
    const firstRule = useGraphStore.getState().rules[0]!;
    const firstCheckbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    const initialState = firstRule.enabled;
    expect(firstCheckbox.checked).toBe(initialState);
    await user.click(firstCheckbox);
    const updated = useGraphStore.getState().rules.find((r) => r.id === firstRule.id)!;
    expect(updated.enabled).toBe(!initialState);
  });

  it('check button is disabled when no rules are enabled and calls onCheckRules otherwise', async () => {
    const user = userEvent.setup();
    const onCheckRules = vi.fn();
    useGraphStore.setState({ rules: getPresetRules().map((r) => ({ ...r, enabled: false })) });
    render(<RuleConfigPanel violations={[]} onCheckRules={onCheckRules} onClose={vi.fn()} />);
    const checkBtn = screen.getByRole('button', { name: '检查违规' }) as HTMLButtonElement;
    expect(checkBtn.disabled).toBe(true);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    expect((screen.getByRole('button', { name: '检查违规' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: '检查违规' }));
    expect(onCheckRules).toHaveBeenCalledOnce();
  });

  it('renders violation messages with stable keys and severity class', () => {
    render(<RuleConfigPanel violations={sampleViolations} onCheckRules={vi.fn()} onClose={vi.fn()} />);
    const items = screen.getAllByText(/violates/);
    expect(items.length).toBe(3);
    const first = items[0]!.closest('.cg-violation-item')!;
    expect(first.className).toContain('cg-error');
  });
});