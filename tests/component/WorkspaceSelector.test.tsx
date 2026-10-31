/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { WorkspaceSelector } from '../../src/client/components/WorkspaceSelector.tsx';
import type { WorkspaceInfo } from '../../src/client/store/graphStore.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
});

const noop = vi.fn();

function makeWorkspaceList(overrides: Partial<WorkspaceInfo>[] = []): WorkspaceInfo[] {
  const defaults: WorkspaceInfo[] = [
    { path: '/home/user/project-a', name: 'project-a', lastUsed: Date.now() - 5_000 },
    { path: '/home/user/project-b', name: 'project-b', lastUsed: Date.now() - 3_600_000 },
  ];
  if (overrides.length === 0) return defaults;
  return overrides.map((o, i) => ({ ...defaults[i]!, ...o }));
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    currentWorkspace: '.',
    workspaceList: [] as WorkspaceInfo[],
    onSwitchWorkspace: noop,
    onAddWorkspace: noop,
    onRemoveWorkspace: noop,
    ...overrides,
  };
}

describe('WorkspaceSelector component', () => {
  // ── 基本渲染 ──
  it('renders trigger button with workspace name', () => {
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/home/user/my-repo' })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('my-repo');
  });

  it('shows "默认" for default workspace (".")', () => {
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '.' })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    expect(trigger.textContent).toContain('默认');
  });

  it('sets aria-expanded to false initially', () => {
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('sets title attribute to currentWorkspace path', () => {
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/some/path' })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    expect(trigger.getAttribute('title')).toBe('/some/path');
  });

  // ── 下拉菜单交互 ──
  it('opens dropdown on trigger click and sets aria-expanded to true', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('closes dropdown on second trigger click', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders dropdown via portal to document.body', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const dropdown = document.body.querySelector('.cg-workspace-dropdown-portal');
    expect(dropdown).toBeTruthy();
  });

  // ── 工作区列表渲染 ──
  it('renders workspace list items when dropdown is open', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(2);
    expect(options[0]!.textContent).toContain('project-a');
    expect(options[1]!.textContent).toContain('project-b');
  });

  it('marks current workspace with "current" class and aria-selected', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/home/user/project-a', workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    expect(options[0]!.className).toContain('current');
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(options[1]!.className).not.toContain('current');
    expect(options[1]!.getAttribute('aria-selected')).toBe('false');
  });

  it('shows "活跃" badge for current workspace in list', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/home/user/project-a', workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const badges = screen.getAllByText('活跃');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  // ── 切换工作区 ──
  it('calls onSwitchWorkspace when a workspace item is clicked', async () => {
    const user = userEvent.setup();
    const onSwitchWorkspace = vi.fn();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ workspaceList: list, onSwitchWorkspace })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    await user.click(options[1]!);
    expect(onSwitchWorkspace).toHaveBeenCalledWith('/home/user/project-b');
  });

  it('closes dropdown after switching workspace', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    await user.click(options[0]!);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // ── 添加工作区 ──
  it('shows add form when add button is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    expect(screen.getByPlaceholderText(/工作区路径或名称/)).toBeTruthy();
  });

  it('calls onAddWorkspace when path is entered and confirm button clicked', async () => {
    const user = userEvent.setup();
    const onAddWorkspace = vi.fn();
    render(<WorkspaceSelector {...makeProps({ onAddWorkspace })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    const input = screen.getByPlaceholderText(/工作区路径或名称/);
    await user.type(input, '/new/workspace');
    const confirmBtn = screen.getAllByRole('button', { name: /添加工作区/ })[1]!;
    await user.click(confirmBtn);
    expect(onAddWorkspace).toHaveBeenCalledWith('/new/workspace');
  });

  it('calls onAddWorkspace when Enter key is pressed in input', async () => {
    const user = userEvent.setup();
    const onAddWorkspace = vi.fn();
    render(<WorkspaceSelector {...makeProps({ onAddWorkspace })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    const input = screen.getByPlaceholderText(/工作区路径或名称/);
    await user.type(input, '/new/path{Enter}');
    expect(onAddWorkspace).toHaveBeenCalledWith('/new/path');
  });

  it('does not call onAddWorkspace when path is empty', async () => {
    const user = userEvent.setup();
    const onAddWorkspace = vi.fn();
    render(<WorkspaceSelector {...makeProps({ onAddWorkspace })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    const confirmBtn = screen.getAllByRole('button', { name: /添加工作区/ })[1]!;
    await user.click(confirmBtn);
    expect(onAddWorkspace).not.toHaveBeenCalled();
  });

  it('disables confirm button when path is empty', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    const confirmBtn = screen.getAllByRole('button', { name: /添加工作区/ })[1]!;
    expect(confirmBtn.getAttribute('disabled')).not.toBeNull();
  });

  it('hides add form when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    const input = screen.getByPlaceholderText(/工作区路径或名称/);
    await user.type(input, '{Escape}');
    expect(screen.queryByPlaceholderText(/工作区路径或名称/)).toBeNull();
  });

  it('closes dropdown after adding workspace', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    const input = screen.getByPlaceholderText(/工作区路径或名称/);
    await user.type(input, '/new/path{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // ── 删除工作区 ──
  it('calls onRemoveWorkspace when remove button is clicked', async () => {
    const user = userEvent.setup();
    const onRemoveWorkspace = vi.fn();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ workspaceList: list, onRemoveWorkspace })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const removeBtns = screen.getAllByRole('button', { name: /移除/ });
    await user.click(removeBtns[0]!);
    expect(onRemoveWorkspace).toHaveBeenCalledWith('/home/user/project-a');
  });

  it('does not call onSwitchWorkspace when remove button is clicked', async () => {
    const user = userEvent.setup();
    const onSwitchWorkspace = vi.fn();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ workspaceList: list, onSwitchWorkspace })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const removeBtns = screen.getAllByRole('button', { name: /移除/ });
    await user.click(removeBtns[0]!);
    expect(onSwitchWorkspace).not.toHaveBeenCalled();
  });

  // ── 显式工作区（当前工作区不在列表中） ──
  it('shows explicit workspace item when currentWorkspace is not in list', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/other/path', workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    // 2 list items + 1 explicit item = 3
    expect(options.length).toBe(3);
    const explicitItem = options.find((o) => o.textContent?.includes('/other/path'));
    expect(explicitItem).toBeTruthy();
    expect(explicitItem?.className).toContain('current');
  });

  it('shows "活跃" badge for explicit current workspace', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/other/path', workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const badges = screen.getAllByText('活跃');
    expect(badges.length).toBe(1);
  });

  it('does not show explicit item when currentWorkspace is in list', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '/home/user/project-a', workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(2);
  });

  it('does not show explicit item when currentWorkspace is "."', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '.', workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(2);
  });

  // ── 空状态 ──
  it('shows empty message when no workspaces and no explicit item', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '.', workspaceList: [] })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('暂无工作区')).toBeTruthy();
  });

  it('does not show empty message when workspaces exist', async () => {
    const user = userEvent.setup();
    const list = makeWorkspaceList();
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.queryByText('暂无工作区')).toBeNull();
  });

  // ── 外部点击关闭 ──
  it('closes dropdown when clicking outside', async () => {
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    // Simulate click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // ── 相对时间格式化 ──
  it('shows "—" for workspace with lastUsed = 0', async () => {
    const user = userEvent.setup();
    const list: WorkspaceInfo[] = [
      { path: '/path/unused', name: 'unused', lastUsed: 0 },
    ];
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows "刚刚" for workspace used less than 1 minute ago', async () => {
    const user = userEvent.setup();
    const list: WorkspaceInfo[] = [
      { path: '/path/recent', name: 'recent', lastUsed: Date.now() - 10_000 },
    ];
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('刚刚')).toBeTruthy();
  });

  it('shows minutes ago for workspace used less than 1 hour ago', async () => {
    const user = userEvent.setup();
    const list: WorkspaceInfo[] = [
      { path: '/path/mins', name: 'mins', lastUsed: Date.now() - 120_000 },
    ];
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('2分钟前')).toBeTruthy();
  });

  it('shows hours ago for workspace used less than 1 day ago', async () => {
    const user = userEvent.setup();
    const list: WorkspaceInfo[] = [
      { path: '/path/hours', name: 'hours', lastUsed: Date.now() - 7_200_000 },
    ];
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('2小时前')).toBeTruthy();
  });

  it('shows days ago for workspace used more than 1 day ago', async () => {
    const user = userEvent.setup();
    const list: WorkspaceInfo[] = [
      { path: '/path/days', name: 'days', lastUsed: Date.now() - 172_800_000 },
    ];
    render(<WorkspaceSelector {...makeProps({ workspaceList: list })} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('2天前')).toBeTruthy();
  });

  // ── 下拉菜单头部 ──
  it('renders "当前工作区" header in dropdown', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    expect(screen.getByText('当前工作区')).toBeTruthy();
  });

  // ── 添加表单切换 ──
  it('toggles add form visibility on repeated add button clicks', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps()} />);
    const trigger = screen.getByRole('button', { name: /切换工作区/ });
    await user.click(trigger);
    const addBtn = screen.getByRole('button', { name: /添加工作区/ });
    await user.click(addBtn);
    expect(screen.getByPlaceholderText(/工作区路径或名称/)).toBeTruthy();
    await user.click(addBtn);
    expect(screen.queryByPlaceholderText(/工作区路径或名称/)).toBeNull();
  });

  // ── 英文语言支持 ──
  it('shows English labels when lang is set to en', async () => {
    setLang('en');
    const user = userEvent.setup();
    render(<WorkspaceSelector {...makeProps({ currentWorkspace: '.' })} />);
    const trigger = screen.getByRole('button', { name: /Switch Workspace/ });
    expect(trigger.textContent).toContain('Default');
  });

  // ── 会话跟随徽标（session-follow 可观测性，见 runtime/sessionFollow.ts）──
  describe('session-follow badge', () => {
    async function openDropdown(props: Record<string, unknown>) {
      const user = userEvent.setup();
      render(<WorkspaceSelector {...makeProps(props)} />);
      await user.click(screen.getByRole('button', { name: /切换工作区/ }));
      return user;
    }

    it('跟随态：sessionWorkspace 非空且未 pin → 显示「跟随对话」非按钮徽标', async () => {
      await openDropdown({ sessionWorkspace: '/ws/session', pinnedWorkspace: null });
      const badge = screen.getByText(/跟随对话/);
      expect(badge.tagName).toBe('SPAN'); // 信息态不可点
    });

    it('固定态：pin 在场 → 显示「已固定 · 回到对话」按钮，点击触发解除', async () => {
      const onUnpinWorkspace = vi.fn();
      const user = await openDropdown({
        sessionWorkspace: '/ws/session',
        pinnedWorkspace: '/pinned',
        onUnpinWorkspace,
      });
      const btn = screen.getByRole('button', { name: /已固定 · 回到对话/ });
      await user.click(btn);
      expect(onUnpinWorkspace).toHaveBeenCalledTimes(1);
    });

    it('不可知态：sessionWorkspace 为 null 且未 pin → 不渲染徽标（宁缺勿猜）', async () => {
      await openDropdown({ sessionWorkspace: null, pinnedWorkspace: null });
      expect(screen.queryByText(/跟随对话/)).toBeNull();
      expect(screen.queryByText(/已固定/)).toBeNull();
    });

    it('pin 在场但无解除回调 → 退化为不可点徽标（不渲染死按钮）', async () => {
      await openDropdown({ sessionWorkspace: '/ws/session', pinnedWorkspace: '/pinned' });
      const badge = screen.getByText(/已固定 · 回到对话/);
      expect(badge.tagName).toBe('SPAN');
    });
  });
});