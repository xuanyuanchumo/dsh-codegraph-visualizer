/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { ImportPanel } from '../../src/client/components/ImportPanel.tsx';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

const noop = vi.fn();

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    onClose: noop,
    workspacePath: '/test/workspace',
    prerequisites: { codegraph: true, lens: false },
    initStatus: 'idle' as const,
    watchEnabled: false,
    onSetGraphData: noop,
    onSetLoading: noop,
    onSetError: noop,
    onSetInitStatus: noop,
    onSetWatchEnabled: noop,
    ...overrides,
  };
}

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImportPanel component', () => {
  describe('rendering', () => {
    it('renders panel with title', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(screen.getByText('导入图谱')).toBeTruthy();
    });

    it('renders close button', () => {
      render(<ImportPanel {...makeProps()} />);
      const closeBtn = document.querySelector('.cg-import-close');
      expect(closeBtn).toBeTruthy();
    });

    it('renders workspace and paste tabs', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(screen.getByText('工作区')).toBeTruthy();
      expect(screen.getByText('粘贴')).toBeTruthy();
    });

    it('shows workspace tab content by default', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(document.querySelector('.cg-workspace-zone')).toBeTruthy();
      expect(document.querySelector('.cg-paste-zone')).toBeNull();
    });

    it('shows paste tab content when paste tab is clicked', () => {
      render(<ImportPanel {...makeProps()} />);
      const pasteTab = screen.getByText('粘贴');
      fireEvent.click(pasteTab);
      expect(document.querySelector('.cg-paste-zone')).toBeTruthy();
      expect(document.querySelector('.cg-workspace-zone')).toBeNull();
    });

    it('renders workspace path input', () => {
      render(<ImportPanel {...makeProps()} />);
      const input = document.querySelector('.cg-workspace-path-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.placeholder).toBe('/test/workspace');
    });

    it('renders scan workspace button', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(screen.getByText('扫描工作区')).toBeTruthy();
    });

    it('renders init graph button', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(screen.getByText('初始化图谱')).toBeTruthy();
    });

    it('renders watch toggle button', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(screen.getByText('热更新: 关闭')).toBeTruthy();
    });

    it('renders paste textarea and import button when on paste tab', () => {
      render(<ImportPanel {...makeProps()} />);
      fireEvent.click(screen.getByText('粘贴'));
      const textarea = document.querySelector('.cg-paste-input') as HTMLTextAreaElement;
      expect(textarea).toBeTruthy();
      expect(screen.getByText('导入 JSON')).toBeTruthy();
    });
  });

  describe('prerequisite warning', () => {
    it('shows prerequisite warning when both prerequisites are missing', () => {
      render(<ImportPanel {...makeProps({ prerequisites: { codegraph: false, lens: false } })} />);
      expect(document.querySelector('.cg-prereq-warning')).toBeTruthy();
    });

    it('does not show prerequisite warning when codegraph is present', () => {
      render(<ImportPanel {...makeProps({ prerequisites: { codegraph: true, lens: false } })} />);
      expect(document.querySelector('.cg-prereq-warning')).toBeNull();
    });

    it('does not show prerequisite warning when lens is present', () => {
      render(<ImportPanel {...makeProps({ prerequisites: { codegraph: false, lens: true } })} />);
      expect(document.querySelector('.cg-prereq-warning')).toBeNull();
    });
  });

  describe('close behavior', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<ImportPanel {...makeProps({ onClose })} />);
      const closeBtn = document.querySelector('.cg-import-close') as HTMLButtonElement;
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('workspace scan', () => {
    it('calls onSetLoading and dispatches event when scan is clicked', () => {
      const onSetLoading = vi.fn();
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<ImportPanel {...makeProps({ onSetLoading })} />);
      const scanBtn = screen.getByText('扫描工作区');
      fireEvent.click(scanBtn);
      expect(onSetLoading).toHaveBeenCalledWith(true);
      expect(dispatchSpy).toHaveBeenCalled();
      const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
      expect(event.type).toBe('codegraph:import-repo');
    });

    it('uses custom path when provided', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<ImportPanel {...makeProps()} />);
      const input = document.querySelector('.cg-workspace-path-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/custom/path' } });
      fireEvent.click(screen.getByText('扫描工作区'));
      const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.path).toBe('/custom/path');
    });

    it('falls back to workspacePath when custom path is empty', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<ImportPanel {...makeProps({ workspacePath: '/fallback/path' })} />);
      fireEvent.click(screen.getByText('扫描工作区'));
      const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.path).toBe('/fallback/path');
    });

    it('disables scan button while busy', () => {
      render(<ImportPanel {...makeProps()} />);
      const scanBtn = screen.getByText('扫描工作区') as HTMLButtonElement;
      fireEvent.click(scanBtn);
      expect(scanBtn.disabled).toBe(true);
    });
  });

  describe('init graph', () => {
    it('calls onSetInitStatus and dispatches event when init is clicked', () => {
      const onSetInitStatus = vi.fn();
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<ImportPanel {...makeProps({ onSetInitStatus })} />);
      fireEvent.click(screen.getByText('初始化图谱'));
      expect(onSetInitStatus).toHaveBeenCalledWith('initializing');
      const event = dispatchSpy.mock.calls[0]![0] as CustomEvent;
      expect(event.type).toBe('codegraph:init-graph');
    });

    it('disables init button when initStatus is initializing', () => {
      render(<ImportPanel {...makeProps({ initStatus: 'initializing' })} />);
      const initBtn = screen.getByText('初始化中…') as HTMLButtonElement;
      expect(initBtn.disabled).toBe(true);
    });

    it('shows success feedback when initStatus is done', () => {
      render(<ImportPanel {...makeProps({ initStatus: 'done' })} />);
      expect(screen.getByText('图谱初始化成功')).toBeTruthy();
    });

    it('shows error feedback when initStatus is error', () => {
      render(<ImportPanel {...makeProps({ initStatus: 'error' })} />);
      expect(screen.getByText('初始化失败 — 请检查前置插件')).toBeTruthy();
    });
  });

  describe('watch toggle', () => {
    it('calls onSetWatchEnabled when watch toggle is clicked', () => {
      const onSetWatchEnabled = vi.fn();
      render(<ImportPanel {...makeProps({ onSetWatchEnabled })} />);
      fireEvent.click(screen.getByText('热更新: 关闭'));
      expect(onSetWatchEnabled).toHaveBeenCalledWith(true);
    });

    it('shows ON label when watchEnabled is true', () => {
      render(<ImportPanel {...makeProps({ watchEnabled: true })} />);
      expect(screen.getByText('热更新: 开启')).toBeTruthy();
    });

    it('dispatches toggle-watch event with enabled detail', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      render(<ImportPanel {...makeProps({ watchEnabled: false })} />);
      fireEvent.click(screen.getByText('热更新: 关闭'));
      const event = dispatchSpy.mock.calls.find(
        (c) => (c[0] as CustomEvent).type === 'codegraph:toggle-watch',
      )![0] as CustomEvent;
      expect(event.detail.enabled).toBe(true);
    });
  });

  describe('paste import', () => {
    it('shows error feedback when paste is empty and import is clicked', () => {
      render(<ImportPanel {...makeProps()} />);
      fireEvent.click(screen.getByText('粘贴'));
      fireEvent.click(screen.getByText('导入 JSON'));
      expect(screen.getByText('请先粘贴 JSON')).toBeTruthy();
    });

    it('calls onSetGraphData when valid JSON is pasted', () => {
      const onSetGraphData = vi.fn();
      render(<ImportPanel {...makeProps({ onSetGraphData })} />);
      fireEvent.click(screen.getByText('粘贴'));
      const textarea = document.querySelector('.cg-paste-input') as HTMLTextAreaElement;
      const validJson = JSON.stringify({
        nodes: [{ id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', lineNumber: 1 }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call' }],
        metadata: { repoId: 'test-repo' },
      });
      fireEvent.change(textarea, { target: { value: validJson } });
      fireEvent.click(screen.getByText('导入 JSON'));
      expect(onSetGraphData).toHaveBeenCalledOnce();
      const [nodes, edges, repoId] = onSetGraphData.mock.calls[0]!;
      expect(nodes).toHaveLength(1);
      expect(edges).toHaveLength(1);
      expect(repoId).toBe('test-repo');
    });

    it('calls onSetError when invalid JSON is pasted', () => {
      const onSetError = vi.fn();
      render(<ImportPanel {...makeProps({ onSetError })} />);
      fireEvent.click(screen.getByText('粘贴'));
      const textarea = document.querySelector('.cg-paste-input') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'not valid json' } });
      fireEvent.click(screen.getByText('导入 JSON'));
      expect(onSetError).toHaveBeenCalledOnce();
    });

    it('shows error feedback when JSON has no valid nodes', () => {
      render(<ImportPanel {...makeProps()} />);
      fireEvent.click(screen.getByText('粘贴'));
      const textarea = document.querySelector('.cg-paste-input') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: '{"nodes":[],"edges":[]}' } });
      fireEvent.click(screen.getByText('导入 JSON'));
      expect(document.querySelector('.cg-import-feedback.cg-err')).toBeTruthy();
    });

    it('generates repoId when metadata.repoId is missing', () => {
      const onSetGraphData = vi.fn();
      render(<ImportPanel {...makeProps({ onSetGraphData })} />);
      fireEvent.click(screen.getByText('粘贴'));
      const textarea = document.querySelector('.cg-paste-input') as HTMLTextAreaElement;
      const validJson = JSON.stringify({
        nodes: [{ id: 'n1', label: 'foo', type: 'function' }],
        edges: [],
      });
      fireEvent.change(textarea, { target: { value: validJson } });
      fireEvent.click(screen.getByText('导入 JSON'));
      const repoId = onSetGraphData.mock.calls[0]![2] as string;
      expect(repoId).toMatch(/^imported-/);
    });
  });

  describe('tab switching', () => {
    it('switches from workspace to paste tab', () => {
      render(<ImportPanel {...makeProps()} />);
      expect(document.querySelector('.cg-workspace-zone')).toBeTruthy();
      fireEvent.click(screen.getByText('粘贴'));
      expect(document.querySelector('.cg-paste-zone')).toBeTruthy();
    });

    it('switches from paste back to workspace tab', () => {
      render(<ImportPanel {...makeProps()} />);
      fireEvent.click(screen.getByText('粘贴'));
      expect(document.querySelector('.cg-paste-zone')).toBeTruthy();
      fireEvent.click(screen.getByText('工作区'));
      expect(document.querySelector('.cg-workspace-zone')).toBeTruthy();
    });
  });

  describe('dialog semantics', () => {
    it('has role dialog and aria-modal', () => {
      render(<ImportPanel {...makeProps()} />);
      const panel = document.querySelector('.cg-import-panel');
      expect(panel).toBeTruthy();
      expect(panel!.getAttribute('role')).toBe('dialog');
      expect(panel!.getAttribute('aria-modal')).toBe('true');
    });
  });

  describe('copy install command', () => {
    it('renders copy button when prerequisites are missing', () => {
      render(<ImportPanel {...makeProps({ prerequisites: { codegraph: false, lens: false } })} />);
      expect(document.querySelector('.cg-prereq-copy')).toBeTruthy();
    });

    it('calls clipboard.writeText when copy button is clicked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      render(<ImportPanel {...makeProps({ prerequisites: { codegraph: false, lens: false } })} />);
      const copyBtn = document.querySelector('.cg-prereq-copy') as HTMLButtonElement;
      fireEvent.click(copyBtn);
      await new Promise((r) => setTimeout(r, 0));
      expect(writeText).toHaveBeenCalledWith('dsh plugin --profile web add dsh-codegraph');
    });
  });
});