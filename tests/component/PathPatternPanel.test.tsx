/**
 * `PathPatternPanel` 组件测试（cycle-135）。
 *
 * ## 核心不变量：空结果与拼错类型名必须在 DOM 上**不同**
 *
 * 这是本任务最容易被「看起来对」骗过的地方。ρ 的「没有匹配」与「拼错类型名」
 * 在宿主返回面上都是 `paths: []`，若面板把它们都渲染成一句「没有匹配」，用户
 * 会永远以为图上真的没有这种边——而真相是自己打错了 `calls`。因此本文件用**成对**
 * 的正向与反向断言钉住这一点：
 *   - `empty` 态渲染 `.cg-pathpattern-empty` 且**不**渲染 `.cg-pathpattern-unknown`；
 *   - `unknown-types` 态渲染 `.cg-pathpattern-unknown` 且**不**渲染 `.cg-pathpattern-empty`；
 *   - 两者的可见文案互不相同（不是同一句话换类名）。
 *
 * ## fixture 必须是**稳定对象**
 *
 * 本仓踩过：`usePanelState` 的默认 mock 每次调用新建对象，断言读到 `Number of calls: 0`。
 * 这里用模块级 `const` 常量让"点击时持有的对象"与"断言时读的对象"按定义是同一个。
 *
 * ## 为什么直接 `useGraphStore.setState` 而不是 mock 整个 store
 *
 * 面板与 store 的接缝（字段名、动作名）正是最容易写错的地方。mock 掉整个 store 会让
 * "面板读的字段不存在"这类缺陷变成 `undefined` 静默渲染；真实 store + `setState` 覆盖
 * 能同时验证接缝与渲染。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { PathPatternPanel } from '../../src/client/components/PathPatternPanel.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { PATH_PATTERN_KEYS } from '../../src/client/store/slices/pathPatternSlice.ts';
import type { PathPatternSnapshot } from '../../src/client/store/slices/pathPatternSlice.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

/** 稳定 fixture：模块级常量，**不**在每次渲染/断言时新建（见文件头）。 */
const READY_RESULT: PathPatternSnapshot = Object.freeze({
  pattern: 'call+',
  paths: Object.freeze([
    Object.freeze({ ids: Object.freeze(['n1', 'n2']), labels: Object.freeze(['a', 'b']) }),
    Object.freeze({ ids: Object.freeze(['n3', 'n4', 'n5']), labels: Object.freeze(['c', 'd', 'e']) }),
  ]),
  total: 2,
  truncated: false,
  nextCursor: null,
  unknownEdgeTypes: Object.freeze([]),
  completedAt: 1_700_000_000_000,
  workspace: '/test/workspace',
}) as unknown as PathPatternSnapshot;

const TRUNCATED_RESULT: PathPatternSnapshot = Object.freeze({
  ...READY_RESULT,
  truncated: true,
  nextCursor: 2,
}) as PathPatternSnapshot;

const UNKNOWN_RESULT: PathPatternSnapshot = Object.freeze({
  pattern: 'calls+',
  paths: Object.freeze([]),
  total: 0,
  truncated: false,
  nextCursor: null,
  unknownEdgeTypes: Object.freeze(['calls']),
  completedAt: 1_700_000_000_001,
  workspace: '/test/workspace',
}) as unknown as PathPatternSnapshot;

let runPathPattern: ReturnType<typeof vi.fn>;
let clearPathPattern: ReturnType<typeof vi.fn>;
let runPathPatternNextPage: ReturnType<typeof vi.fn>;

/** 把 store 拨到某个状态，并替换三个动作（真实 store，覆盖字段）。 */
function primeStore(overrides: Record<string, unknown> = {}): void {
  useGraphStore.setState({
    pathPattern: '',
    pathPatternStatus: 'idle',
    pathPatternResult: null,
    pathPatternError: null,
    pathPatternSeq: 0,
    ...overrides,
  });
}

function renderPanel() {
  return render(React.createElement(PathPatternPanel, { onClose: vi.fn(), label: 'Path pattern' }));
}

const input = (): HTMLInputElement =>
  screen.getByRole('searchbox') as HTMLInputElement;

beforeEach(() => {
  resetI18nListeners();
  // 用中文断言：词典里五态是**不同**的中文串，便于 `getByText` 唯一定位。
  setLang('zh');
  runPathPattern = vi.fn().mockResolvedValue(true);
  clearPathPattern = vi.fn();
  runPathPatternNextPage = vi.fn().mockResolvedValue(true);
  primeStore({ runPathPattern, clearPathPattern, runPathPatternNextPage });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('store / component seam', () => {
  it('the slice really extends GraphState (declaration merging is live)', () => {
    const state = useGraphStore.getState() as unknown as Record<string, unknown>;
    const missing = PATH_PATTERN_KEYS.filter((key) => !(key in state));
    expect(missing, `GraphState 缺少 ρ 切片的键：${missing.join(', ')}`).toEqual([]);
    expect(PATH_PATTERN_KEYS.length).toBeGreaterThan(5);
  });
});

describe('empty vs unknown-types must be visually distinct (核心不变量)', () => {
  it('empty renders the "no match" block and NOT the typo block', () => {
    primeStore({ pathPatternStatus: 'empty', pathPattern: 'call+', pathPatternResult: READY_RESULT });
    // 用 paths: [] 的语义：READY_RESULT 有两条路径，这里换成空结果更贴题。
    useGraphStore.setState({
      pathPatternResult: { ...READY_RESULT, paths: [], total: 0 },
    });
    renderPanel();

    const emptyBlock = document.querySelector('.cg-pathpattern-empty');
    expect(emptyBlock, '空结果必须渲染自己的空态块').not.toBeNull();
    expect(emptyBlock!.textContent).toContain('没有匹配的路径');
    // 反向：拼错块不得出现。
    expect(document.querySelector('.cg-pathpattern-unknown')).toBeNull();
    expect(document.querySelector('.cg-pathpattern-empty-title')!.textContent).not.toContain('不认识的边类型');
  });

  it('unknown-types renders the typo block and NOT the "no match" block', () => {
    primeStore({
      pathPatternStatus: 'unknown-types',
      pathPattern: 'calls+',
      pathPatternResult: UNKNOWN_RESULT,
    });
    renderPanel();

    const unknownBlock = document.querySelector('.cg-pathpattern-unknown');
    expect(unknownBlock, '拼错类型名必须渲染自己的提示块').not.toBeNull();
    expect(unknownBlock!.textContent).toContain('ρ 里有不认识的边类型：calls');
    // 反向：空态块不得出现——这是"不把拼错显示成没有匹配"的直接判据。
    expect(document.querySelector('.cg-pathpattern-empty')).toBeNull();
    // 文案互不相同（不是同一句话换类名）。
    expect(unknownBlock!.textContent!.includes('没有匹配的路径')).toBe(false);
  });

  it('announces unknown types in the live region', () => {
    primeStore({
      pathPatternStatus: 'unknown-types',
      pathPattern: 'calls+',
      pathPatternResult: UNKNOWN_RESULT,
    });
    renderPanel();
    const live = document.querySelector('.cg-pathpattern-live')!;
    expect(live.textContent).toContain('不认识的边类型：calls');
  });
});

describe('terminal states each render their own block', () => {
  it('invalid shows the host caret diagnostic verbatim', () => {
    primeStore({
      pathPatternStatus: 'invalid',
      pathPattern: 'call+ . import',
      pathPatternError: 'call+ . import\n        ^',
    });
    renderPanel();
    const block = document.querySelector('.cg-pathpattern-invalid')!;
    expect(block.textContent).toContain('ρ 语法错误');
    // 诊断必须原样渲染（含 ^ 指位），不能只显示一句笼统的「语法错误」。
    expect(block.querySelector('.cg-pathpattern-diagnostic')!.textContent).toBe('call+ . import\n        ^');
    // 反向：拼错块/空态块不得出现。
    expect(document.querySelector('.cg-pathpattern-unknown')).toBeNull();
    expect(document.querySelector('.cg-pathpattern-empty')).toBeNull();
  });

  it('not-found renders its own block (not error, not empty)', () => {
    primeStore({ pathPatternStatus: 'not-found', pathPattern: 'call+' });
    renderPanel();
    const block = document.querySelector('.cg-pathpattern-notfound')!;
    expect(block.textContent).toContain('没有图谱数据');
    expect(document.querySelector('.cg-pathpattern-error')).toBeNull();
    expect(document.querySelector('.cg-pathpattern-empty')).toBeNull();
  });

  it('error and timeout are distinct blocks', () => {
    primeStore({ pathPatternStatus: 'error', pathPatternError: 'pathPattern.error', pathPattern: 'call+' });
    renderPanel();
    expect(document.querySelector('.cg-pathpattern-error')).not.toBeNull();
    expect(document.querySelector('.cg-pathpattern-timeout')).toBeNull();

    cleanup();
    primeStore({ pathPatternStatus: 'timeout', pathPatternError: 'pathPattern.timeout', pathPattern: 'call+' });
    renderPanel();
    expect(document.querySelector('.cg-pathpattern-timeout')).not.toBeNull();
    expect(document.querySelector('.cg-pathpattern-error')).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});

describe('keyboard and submission', () => {
  it('Enter submits the trimmed draft with clamped options', () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: '  call+  ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(runPathPattern).toHaveBeenCalledTimes(1);
    expect(runPathPattern).toHaveBeenCalledWith('call+', {
      startNode: undefined,
      endNode: undefined,
      minHops: 0,
      maxHops: 8,
      limit: 20,
    });
  });

  it('an empty pattern does NOT issue a request and clears instead', () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: '   ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(runPathPattern).not.toHaveBeenCalled();
    expect(clearPathPattern).toHaveBeenCalled();
  });

  it('submit button is disabled while the draft is empty', () => {
    renderPanel();
    const submit = document.querySelector('.cg-pathpattern-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('control values flow through and are clamped at submit', () => {
    renderPanel();
    fireEvent.change(document.querySelector('#cg-pathpattern-start') as HTMLInputElement, { target: { value: 'n1' } });
    fireEvent.change(document.querySelector('#cg-pathpattern-end') as HTMLInputElement, { target: { value: 'n2' } });
    fireEvent.change(document.querySelector('#cg-pathpattern-min-hops') as HTMLInputElement, { target: { value: '99' } });
    fireEvent.change(document.querySelector('#cg-pathpattern-max-hops') as HTMLInputElement, { target: { value: '99' } });
    fireEvent.change(document.querySelector('#cg-pathpattern-limit') as HTMLInputElement, { target: { value: '10' } });
    fireEvent.change(input(), { target: { value: 'call+' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(runPathPattern).toHaveBeenCalledWith('call+', {
      startNode: 'n1',
      endNode: 'n2',
      minHops: 12,
      maxHops: 12,
      limit: 10,
    });
  });

  it('Esc closes the panel and stops the event from reaching the global handler', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    render(
      React.createElement('div', { onKeyDown: outer },
        React.createElement(PathPatternPanel, { onClose, label: 'Path pattern' })),
    );
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer, 'Esc 必须 stopPropagation，否则全局 closeAll 会把所有面板一起关掉').not.toHaveBeenCalled();
  });
});

describe('results and pagination', () => {
  it('renders each path as labels joined by arrows with hop count', () => {
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: READY_RESULT });
    renderPanel();
    const labels = document.querySelector('.cg-pathpattern-path-labels');
    expect(labels!.textContent).toBe('a → b');
    expect(screen.getAllByText('(1 跳)')).toHaveLength(1);
    expect(screen.getAllByText('(2 跳)')).toHaveLength(1);
  });

  it('shows the truncation notice when truncated and nothing when complete', () => {
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: TRUNCATED_RESULT });
    renderPanel();
    expect(document.querySelector('.cg-pathpattern-truncated')!.textContent).toContain('结果被截断');

    cleanup();
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: READY_RESULT });
    renderPanel();
    expect(document.querySelector('.cg-pathpattern-truncated')).toBeNull();
  });

  it('"load more" calls runPathPatternNextPage when nextCursor is present', () => {
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: TRUNCATED_RESULT });
    renderPanel();
    const more = screen.getByRole('button', { name: '加载更多' });
    fireEvent.click(more);
    expect(runPathPatternNextPage).toHaveBeenCalledTimes(1);
  });

  it('does NOT render "load more" when nextCursor is null', () => {
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: READY_RESULT });
    renderPanel();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('shows the count badge only in the ready state', () => {
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: READY_RESULT });
    renderPanel();
    expect(document.querySelector('.cg-pathpattern-count-badge')!.textContent).toBe('2');

    cleanup();
    primeStore({ pathPatternStatus: 'idle', pathPatternResult: null });
    renderPanel();
    expect(document.querySelector('.cg-pathpattern-count-badge')).toBeNull();
  });
});

describe('a11y: aria-live announces terminal states', () => {
  it('has a polite live region and stays silent while loading', () => {
    renderPanel();
    const live = document.querySelector('.cg-pathpattern-live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');
  });

  it('announces the path count after a ready result lands', () => {
    primeStore({ pathPatternStatus: 'ready', pathPattern: 'call+', pathPatternResult: READY_RESULT });
    renderPanel();
    const live = document.querySelector('.cg-pathpattern-live')!;
    expect(live.textContent).toContain('枚举完成');
    expect(live.textContent).toContain('2 条路径');
  });
});
