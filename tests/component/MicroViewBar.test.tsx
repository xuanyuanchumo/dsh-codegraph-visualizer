/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { MicroViewPrompt, MicroFunctionBar } from '../../src/client/components/MicroViewBar.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MicroViewPrompt component', () => {
  it('displays CFG label when viewMode is cfg', () => {
    render(
      <MicroViewPrompt
        viewMode="cfg"
        selectFunctionPrompt="Select a function"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back"
        onBackToCode={vi.fn()}
      />
    );
    expect(screen.getByText('CFG')).toBeInTheDocument();
  });

  it('displays flowchartLabel when viewMode is flowchart', () => {
    render(
      <MicroViewPrompt
        viewMode="flowchart"
        selectFunctionPrompt="Select a function"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back"
        onBackToCode={vi.fn()}
      />
    );
    expect(screen.getByText('Flow')).toBeInTheDocument();
  });

  it('displays sequenceLabel when viewMode is sequence', () => {
    render(
      <MicroViewPrompt
        viewMode="sequence"
        selectFunctionPrompt="Select a function"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back"
        onBackToCode={vi.fn()}
      />
    );
    expect(screen.getByText('Seq')).toBeInTheDocument();
  });

  it('displays selectFunctionPrompt text', () => {
    render(
      <MicroViewPrompt
        viewMode="cfg"
        selectFunctionPrompt="Please select a function node"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back"
        onBackToCode={vi.fn()}
      />
    );
    expect(screen.getByText('Please select a function node')).toBeInTheDocument();
  });

  it('renders back button with backToCodeLabel', () => {
    render(
      <MicroViewPrompt
        viewMode="cfg"
        selectFunctionPrompt="Select a function"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back to Code"
        onBackToCode={vi.fn()}
      />
    );
    expect(screen.getByText('Back to Code')).toBeInTheDocument();
  });

  it('calls onBackToCode when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBackToCode = vi.fn();
    render(
      <MicroViewPrompt
        viewMode="cfg"
        selectFunctionPrompt="Select a function"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back to Code"
        onBackToCode={onBackToCode}
      />
    );
    await user.click(screen.getByText('Back to Code'));
    expect(onBackToCode).toHaveBeenCalledOnce();
  });

  it('renders with correct CSS class structure', () => {
    const { container } = render(
      <MicroViewPrompt
        viewMode="cfg"
        selectFunctionPrompt="Select a function"
        flowchartLabel="Flow"
        sequenceLabel="Seq"
        backToCodeLabel="Back"
        onBackToCode={vi.fn()}
      />
    );
    expect(container.querySelector('.cg-micro-empty-prompt')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-empty-icon')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-empty-text')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-empty-back-btn')).toBeInTheDocument();
  });
});

describe('MicroFunctionBar component', () => {
  it('displays CFG label when viewMode is cfg', () => {
    render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('CFG')).toBeInTheDocument();
  });

  it('displays translated flowchart label when viewMode is flowchart', () => {
    render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="flowchart"
        onClose={vi.fn()}
      />
    );
    // useT() defaults to zh dictionary, viewMode.flowchart = '流程'
    expect(screen.getByText('流程')).toBeInTheDocument();
  });

  it('displays translated sequence label when viewMode is sequence', () => {
    render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="sequence"
        onClose={vi.fn()}
      />
    );
    // useT() defaults to zh dictionary, viewMode.sequence = '时序'
    expect(screen.getByText('时序')).toBeInTheDocument();
  });

  it('does not render mode label when viewMode is unknown', () => {
    const { container } = render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="unknown"
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('.cg-micro-function-mode')).toBeNull();
  });

  it('does not render mode label when viewMode is undefined', () => {
    const { container } = render(
      <MicroFunctionBar
        functionName="myFunc"
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('.cg-micro-function-mode')).toBeNull();
  });

  it('displays functionName', () => {
    render(
      <MicroFunctionBar
        functionName="calculateSum"
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('calculateSum')).toBeInTheDocument();
  });

  it('displays shortened file path (last 2 segments) when filePath is provided', () => {
    render(
      <MicroFunctionBar
        functionName="myFunc"
        filePath="/src/client/utils/helper.ts"
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('utils/helper.ts')).toBeInTheDocument();
  });

  it('displays shortened Windows-style file path correctly', () => {
    render(
      <MicroFunctionBar
        functionName="myFunc"
        filePath={'C:\\projects\\src\\components\\Bar.tsx'}
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('components/Bar.tsx')).toBeInTheDocument();
  });

  it('does not render file path when filePath is undefined', () => {
    const { container } = render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('.cg-micro-function-path')).toBeNull();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="cfg"
        onClose={onClose}
      />
    );
    const closeBtn = document.querySelector('.cg-micro-function-close') as HTMLButtonElement;
    expect(closeBtn).toBeInTheDocument();
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders close button with correct aria-label', () => {
    render(
      <MicroFunctionBar
        functionName="myFunc"
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    const closeBtn = document.querySelector('.cg-micro-function-close') as HTMLButtonElement;
    expect(closeBtn).toBeInTheDocument();
    // useT() defaults to zh dictionary, micro.closeView = '关闭微观视图'
    expect(closeBtn.getAttribute('aria-label')).toBe('关闭微观视图');
  });

  it('renders with correct CSS class structure', () => {
    const { container } = render(
      <MicroFunctionBar
        functionName="myFunc"
        filePath="/src/utils/helper.ts"
        viewMode="cfg"
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('.cg-micro-function-bar')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-function-mode')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-function-name')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-function-path')).toBeInTheDocument();
    expect(container.querySelector('.cg-micro-function-close')).toBeInTheDocument();
  });
});