/**
 * `KeywordQueryPanel` 组件测试（cycle-111 / N-5）。
 *
 * 旅程覆盖：J50「关键词检索定位」（输入关键词 → 种子列表 → 点击种子 → 图选中并高亮；
 * 反向：空查询 / 无结果 / 超时 / 截断）。
 *
 * ## 为什么这个文件必须存在
 *
 * 面板落地时有 21 个 i18n key 全部命中词典、`typecheck` 零错、`oxlint` 零 warning——
 * 而这些都是**静态**证据。本仓反复记录过同一个形态：`graph_query` 工具「有实现、零验证」，
 * 结果它是一个从未被注册过的死符号；`showDiff` 的入口消失了整轮也没人发现。
 * 「实现完成」与「交付完成」之间差的就是这个文件。
 *
 * ## 四态为什么必须逐态断言**文案**
 *
 * 「空查询 / 无结果 / 失败 / 超时」在 DOM 上都可能表现为"容器在、内容空"。
 * 只断言 `.cg-keywordquery-*` 存在的话，一个把四种状态都渲染成同一个空 div 的实现
 * 也能全绿。所以每一态都断言它**自己那句文案**，并断言另外三态的关键文案**不在**——
 * 反向那半条才是让"四态互斥"可证伪的判据。
 *
 * ## fixture 必须是**稳定对象**
 *
 * 本仓踩过：`usePanelState` 的默认 mock 每次调用 `mockReturnValue` 新建对象，
 * 于是 `mock.results[0].value` 不是点击时组件持有的那个对象，断言读到
 * `Number of calls: 0`。这里用模块级 `const` 常量（见 `READY_RESULT`），
 * 让"点击时用的对象"与"断言时读的对象"按定义是同一个。
 *
 * ## 为什么直接 `useGraphStore.setState` 而不是 mock 整个 store
 *
 * 与 `FilterPanel.test.tsx` 同一取舍：面板与 store 的接缝（字段名、动作名）正是最容易
 * 写错的地方。mock 掉整个 store 会让"面板读的字段不存在"这类缺陷变成
 * `undefined` 静默渲染，而真实 store + `setState` 覆盖能同时验证接缝与渲染。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { KeywordQueryPanel } from '../../src/client/components/KeywordQueryPanel.tsx';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { KEYWORD_QUERY_KEYS } from '../../src/client/store/slices/keywordQuerySlice.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import type { KeywordQueryResult, KeywordSeed } from '../../src/client/api/keywordQuery.ts';
import type { KeywordQuerySnapshot } from '../../src/client/store/slices/keywordQuerySlice.ts';

/** 稳定 fixture：模块级常量，**不**在每次渲染/断言时新建（见文件头）。 */
const SEEDS: KeywordSeed[] = Object.freeze([
  Object.freeze({ id: 'n-alpha', label: 'alpha', score: 1000, matchedTerms: Object.freeze(['alpha']) as string[] }),
  Object.freeze({ id: 'n-beta', label: 'beta', score: 100, matchedTerms: Object.freeze(['alp']) as string[] }),
]) as unknown as KeywordSeed[];

const NODES: GraphNode[] = [
  { id: NodeId('n-alpha'), label: 'alpha', type: 'function', filePath: 'src/alpha.ts', lineNumber: 1, properties: {} },
  { id: NodeId('n-beta'), label: 'beta', type: 'function', filePath: 'src/beta.ts', lineNumber: 2, properties: {} },
];

const EDGES: GraphEdge[] = [
  { id: EdgeId('e1'), source: NodeId('n-alpha'), target: NodeId('n-beta'), type: 'call', properties: {} },
];

const BASE_RESULT: KeywordQueryResult = {
  query: 'alpha',
  terms: ['alpha'],
  seeds: SEEDS,
  nodes: NODES,
  edges: EDGES,
  text: 'seeds=n-alpha\nNODE n-alpha alpha *\nNODE n-beta beta\nEDGE n-alpha -> n-beta (call)',
  tokens: 42,
  truncated: false,
  reason: 'fits',
  meta: { depth: 2, depthEffective: 2, tokenBudget: 800, source: 'slot', revision: 1000, reason: 'fits' },
};

const READY_RESULT: KeywordQuerySnapshot = Object.freeze({
  ...BASE_RESULT,
  workspace: '/test/workspace',
  completedAt: 1_700_000_000_000,
}) as KeywordQuerySnapshot;

const TRUNCATED_RESULT: KeywordQuerySnapshot = Object.freeze({
  ...BASE_RESULT,
  truncated: true,
  reason: 'nodes-only',
  tokens: 800,
  meta: { ...BASE_RESULT.meta, reason: 'nodes-only' },
  workspace: '/test/workspace',
  completedAt: 1_700_000_000_001,
}) as KeywordQuerySnapshot;

let runKeywordQuery: ReturnType<typeof vi.fn>;
let clearKeywordQuery: ReturnType<typeof vi.fn>;
let selectKeywordSeed: ReturnType<typeof vi.fn>;

/** 把 store 拨到某个状态，并替换三个动作（真实 store，覆盖字段）。 */
function primeStore(overrides: Record<string, unknown> = {}): void {
  useGraphStore.setState({
    keywordQuery: '',
    keywordQueryStatus: 'idle',
    keywordQueryResult: null,
    keywordQueryError: null,
    keywordQuerySeq: 0,
    rawNodes: NODES,
    highlightedNodeIds: [],
    selectedNodeId: null,
    ...overrides,
  });
}

function renderPanel() {
  return render(React.createElement(KeywordQueryPanel, { onClose: vi.fn(), label: 'Keyword graph query' }));
}

const input = (): HTMLInputElement =>
  screen.getByRole('searchbox') as HTMLInputElement;

beforeEach(() => {
  resetI18nListeners();
  // 用中文断言：词典里这四态是**不同**的中文串，英文版有两处共用单词（"Search" 既是
  // 提交按钮又是段标题），会让 `getByText` 的定位变得含糊。断言语言的选择由
  // "哪一份能唯一区分"决定，而不是随手默认。
  setLang('zh');
  runKeywordQuery = vi.fn().mockResolvedValue(true);
  clearKeywordQuery = vi.fn();
  selectKeywordSeed = vi.fn();
  primeStore({ runKeywordQuery, clearKeywordQuery, selectKeywordSeed });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('store / component seam', () => {
  it('the slice really extends GraphState (declaration merging is live)', () => {
    // 本切片的字段是用 `declare module` 合并进 `GraphState` 的。合并失效（例如有人把
    // `createKeywordQuerySlice` 从 graphStore.ts 的 spread 里删掉）在类型层未必报错，
    // 但在运行时会读到 `undefined`，面板静默渲染空态。这条用例是那个失效的探测器。
    const state = useGraphStore.getState() as unknown as Record<string, unknown>;
    const missing = KEYWORD_QUERY_KEYS.filter((key) => !(key in state));
    expect(missing, `GraphState 缺少关键词检索切片的键：${missing.join(', ')}`).toEqual([]);
    // 防空转：键表本身必须非空，否则上面的 filter 恒为 []。
    expect(KEYWORD_QUERY_KEYS.length).toBeGreaterThan(5);
  });
});

describe('four visible states (J50)', () => {
  it('idle: shows the "type a keyword" hint instead of an empty box', () => {
    primeStore({ keywordQueryStatus: 'idle' });
    renderPanel();
    expect(screen.getByText('输入关键词后回车开始检索')).toBeInTheDocument();
    expect(screen.getByText('支持中文、标识符与文件路径片段')).toBeInTheDocument();
    // 反向：其它三态的文案不得出现（四态互斥）。
    expect(screen.queryByText('没有匹配的节点，换个词试试')).toBeNull();
    expect(screen.queryByText('检索失败')).toBeNull();
    expect(screen.queryByText('检索超时')).toBeNull();
  });

  it('loading: shows the progress text and disables the submit button', () => {
    primeStore({ keywordQueryStatus: 'loading', keywordQuery: 'alpha' });
    renderPanel();
    // 提交按钮本身变成「检索中…」，同时加载块也显示同一句——两处都是刻意的：
    // 前者告诉用户"按钮已接管这次请求"，后者在按钮滚出视野时仍然可见。
    expect(screen.getAllByText('检索中…').length).toBeGreaterThanOrEqual(1);
    const submit = document.querySelector('.cg-keywordquery-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    // 反向：loading 时不应同时显示 idle 的空态提示。
    expect(screen.queryByText('输入关键词后回车开始检索')).toBeNull();
  });

  it('empty: shows the no-match text plus the hint about what is matched', () => {
    primeStore({ keywordQueryStatus: 'empty', keywordQuery: 'zzzz' });
    renderPanel();
    // 空态文案在两处出现：一个**可见的空态块** + 一个 `aria-live` 播报区。
    // 后者是刻意的（屏幕阅读器需要听到"没有匹配"），所以断言必须按**容器**取，
    // 不能用 `getByText`（它会因为两处匹配而抛 "Found multiple elements"——
    // 这不是缺陷，是"同一句话有两种用途"）。
    const block = document.querySelector('.cg-keywordquery-empty')!;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('没有匹配的节点，换个词试试');
    expect(block.textContent).toContain('支持中文、标识符与文件路径片段');
    // 反向：其它三态的**可见块**不得存在（用容器而不是文本，理由同上）。
    expect(document.querySelector('.cg-keywordquery-idle')).toBeNull();
    expect(document.querySelector('.cg-keywordquery-error')).toBeNull();
    expect(document.querySelector('.cg-keywordquery-timeout')).toBeNull();
  });

  it('error: shows the failure text and offers a retry', () => {
    primeStore({ keywordQueryStatus: 'error', keywordQueryError: 'keywordQuery.error', keywordQuery: 'alpha' });
    renderPanel();
    const block = document.querySelector('.cg-keywordquery-error')!;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('检索失败');
    // 反向：空态/超时块不得存在。
    expect(document.querySelector('.cg-keywordquery-idle')).toBeNull();
    expect(document.querySelector('.cg-keywordquery-timeout')).toBeNull();
    const retry = screen.getByRole('button', { name: '重试' });
    fireEvent.click(retry);
    // 重试必须真的再发一次**同一个词**：只断开错误 UI 而不重试等于让用户以为在等。
    expect(runKeywordQuery).toHaveBeenCalledWith('alpha', { depth: 2, tokenBudget: 800 });
  });

  it('timeout is its own state, not a rewording of error', () => {
    // 超时与失败的下一步动作不同（重试/换词 vs 看服务端错误），合并会让用户无从判断。
    primeStore({ keywordQueryStatus: 'timeout', keywordQueryError: 'keywordQuery.timeout', keywordQuery: 'alpha' });
    renderPanel();
    const block = document.querySelector('.cg-keywordquery-timeout')!;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('检索超时');
    // 反向：失败块（`.cg-keywordquery-error`）**不得**存在——这是"两种状态互斥"的判据。
    // 注意不能用 `queryByText('检索失败')`：aria-live 播报区在 timeout 状态下的文案
    // 是"检索超时"，不冲突；但 timeout 与 error 共用 `.cg-keywordquery-retry` 类，
    // 所以这里按**块类名**而不是按钮断言。
    expect(document.querySelector('.cg-keywordquery-error')).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});

describe('keyboard and submission', () => {
  it('Enter in the input submits the trimmed draft', () => {
    renderPanel();
    const box = input();
    fireEvent.change(box, { target: { value: '  alpha  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // 参数必须是**去掉首尾空白**的输入值：把空格原样发出去会让宿主的空查询分支
    // 与用户输入的实际词不一致（`q='  '` 是 400）。
    expect(runKeywordQuery).toHaveBeenCalledTimes(1);
    expect(runKeywordQuery).toHaveBeenCalledWith('alpha', { depth: 2, tokenBudget: 800 });
  });

  it('an empty query does NOT issue a request', () => {
    // 防止 `/query?q=` 空请求：宿主会回 400，而用户看到的只是"点了一下没反应"。
    renderPanel();
    const box = input();
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(runKeywordQuery).not.toHaveBeenCalled();
    // 空提交应回到 idle（而不是停在 loading）。
    expect(clearKeywordQuery).toHaveBeenCalled();
  });

  it('Esc closes the panel and stops the event from reaching the global handler', () => {
    // `usePanelKeyboard` 的全局 Esc 会 `panel.closeAll()` 一次性关掉所有面板；
    // 用户按 Esc 的期望只是关掉当前这个，所以必须 `stopPropagation`。
    const onClose = vi.fn();
    const outer = vi.fn();
    render(
      // 外层监听冒泡上来的 keydown：若面板没有 stopPropagation，它会被调用。
      React.createElement('div', { onKeyDown: outer },
        React.createElement(KeywordQueryPanel, { onClose, label: 'Keyword graph query' })),
    );
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer, 'Esc 必须 stopPropagation，否则全局 closeAll 会把所有面板一起关掉').not.toHaveBeenCalled();
  });

  it('the submit button submits the draft too (mouse path)', () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: 'beta' } });
    fireEvent.click(document.querySelector('.cg-keywordquery-submit') as HTMLButtonElement);
    // cycle-120：阈值控件引入后，提交总是携带夹紧后的默认 options。
    expect(runKeywordQuery).toHaveBeenCalledWith('beta', { depth: 2, tokenBudget: 800 });
  });

  // ── 阈值控件（cycle-120 / graphify 关键词检索产品化）────────────────────────
  // graphify 原则「截断必须显式」的另一半是「预算必须可调」：写死 800/2 让
  // 「大词查不到」与「截断」无法区分。控件只存在于面板本地（击键 UI 态），
  // 提交时夹紧——下面的用例钉的是「夹紧发生在提交时」与「retry 共用同一夹紧」。

  it('tuning controls: custom depth/budget flow through to runKeywordQuery', () => {
    renderPanel();
    const depth = document.querySelector('#cg-keywordquery-depth') as HTMLInputElement;
    const budget = document.querySelector('#cg-keywordquery-budget') as HTMLInputElement;
    expect(depth).not.toBeNull();
    expect(budget).not.toBeNull();
    fireEvent.change(depth, { target: { value: '4' } });
    fireEvent.change(budget, { target: { value: '2000' } });
    fireEvent.change(input(), { target: { value: 'gamma' } });
    fireEvent.click(document.querySelector('.cg-keywordquery-submit') as HTMLButtonElement);
    expect(runKeywordQuery).toHaveBeenCalledWith('gamma', { depth: 4, tokenBudget: 2000 });
  });

  it('tuning controls: out-of-range values are clamped at submit time (not on keystroke)', () => {
    renderPanel();
    const depth = document.querySelector('#cg-keywordquery-depth') as HTMLInputElement;
    const budget = document.querySelector('#cg-keywordquery-budget') as HTMLInputElement;
    // 逐键不夹紧：输入框里的中间态可以是任意文本（用户可能想先打完整数字再退格修正）。
    fireEvent.change(depth, { target: { value: '99' } });
    fireEvent.change(budget, { target: { value: '10' } });
    expect((depth as HTMLInputElement & { value: string }).value).toBe('99');
    // 提交时才夹紧：depth 99→5（MAX_DEPTH），budget 10→50（MIN_TOKEN_BUDGET）。
    // **必须用 fireEvent.submit(form) 或 Enter 键**：click submit 按钮会走 HTML 约束校验，
    // 越界的 min/max 值（99 > max=5）让 jsdom（与真实浏览器一致）取消隐式提交——
    // 那是浏览器对"number 越界"的保护行为，不是组件缺陷；显式 submit 事件绕过它，
    // 走组件自己的 onSubmit → clampInt 夹紧路径，正是本用例要钉的契约。
    fireEvent.change(input(), { target: { value: 'gamma' } });
    fireEvent.submit(document.querySelector('.cg-keywordquery-form') as HTMLFormElement);
    expect(runKeywordQuery).toHaveBeenCalledWith('gamma', { depth: 5, tokenBudget: 50 });
  });
  it('tuning controls: retry after error reuses the same clamped thresholds (no silent fallback)', () => {
    primeStore({ keywordQueryStatus: 'error', keywordQueryError: 'keywordQuery.error', keywordQuery: 'alpha' });
    renderPanel();
    // 用户在出错前调过阈值：retry 必须沿用（cycle-119「两个按钮各写一份调用」的 UI 对应形态）。
    fireEvent.change(document.querySelector('#cg-keywordquery-depth') as HTMLInputElement, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(runKeywordQuery).toHaveBeenCalledWith('alpha', { depth: 3, tokenBudget: 800 });
  });
});

describe('truncation must be visible (graphify 原则)', () => {
  it('renders the truncation notice with the reason interpolated when truncated', () => {
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: TRUNCATED_RESULT });
    renderPanel();
    const notice = document.querySelector('.cg-keywordquery-truncated');
    expect(notice, '截断时必须渲染显式提示').not.toBeNull();
    // 文案必须带 reason 的**语义**（不是原始 key）：`nodes-only` ⇒ 「边被省略」。
    expect(notice!.textContent).toContain('已按 token 预算截断');
    expect(notice!.textContent).toContain('边被省略');
  });

  it('does NOT render the truncation notice when the result is complete', () => {
    // 与上一条成对：只测"截断时出现"的话，一个恒渲染的实现也能过。
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    expect(document.querySelector('.cg-keywordquery-truncated')).toBeNull();
  });
});

describe('seeds and highlight', () => {
  it('renders each seed with its score and matched terms', () => {
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    expect(screen.getByText('种子（2）')).toBeInTheDocument();
    // `alpha` 在页面上出现两次：种子 label **与** 它自己的命中词 `<mark>`。
    // 这不是重复渲染，而是"种子名 + 为什么命中"两件事；所以按种子按钮取而非按文本。
    const seedButtons = document.querySelectorAll('.cg-keywordquery-seed');
    expect(seedButtons[0]!.querySelector('.cg-keywordquery-seed-label')!.textContent).toBe('alpha');
    expect(seedButtons[1]!.querySelector('.cg-keywordquery-seed-label')!.textContent).toBe('beta');
    expect(seedButtons[0]!.querySelector('.cg-keywordquery-seed-score')!.textContent).toBe('1000');
    // 命中词用 `<mark>` 渲染：它是"为什么这个种子被选中"的唯一解释。
    const marks = document.querySelectorAll('.cg-keywordquery-term');
    expect(marks.length).toBe(2);
    expect(marks[0]!.textContent).toBe('alpha');
  });

  it('clicking a seed asks the store to select THAT seed id', () => {
    // 稳定 fixture 的用处就在这里：断言读到的对象与点击时组件持有的对象是同一个，
    // 否则会得到 `Number of calls: 0`（本仓踩过）。
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    const seedButtons = document.querySelectorAll('.cg-keywordquery-seed');
    expect(seedButtons.length).toBe(2);
    fireEvent.click(seedButtons[0]!);
    expect(selectKeywordSeed).toHaveBeenCalledTimes(1);
    expect(selectKeywordSeed).toHaveBeenCalledWith(SEEDS[0]!.id);
  });

  it('summarises node / edge / token counts and the graph source', () => {
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    const summary = document.querySelector('.cg-keywordquery-summary');
    expect(summary!.textContent).toContain('2 节点');
    expect(summary!.textContent).toContain('1 边');
    expect(summary!.textContent).toContain('42 tokens');
    // 数据来源（缓存图 / 现场取图）必须可见：两者的新鲜度不同，用户需要知道。
    expect(screen.getByText('来自缓存图')).toBeInTheDocument();
  });

  it('shows the raw subgraph text so the UI can be compared with the tool output', () => {
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    const raw = document.querySelector('.cg-keywordquery-raw-text');
    expect(raw, '原始子图文本必须可展开，供与 graph_query 的输出对照').not.toBeNull();
    expect(raw!.textContent).toBe(BASE_RESULT.text);
  });
});

describe('a11y: aria-live announces terminal states', () => {
  it('has a polite live region', () => {
    renderPanel();
    const live = document.querySelector('.cg-keywordquery-live');
    expect(live).not.toBeNull();
    expect(live!.getAttribute('aria-live')).toBe('polite');
  });

  it('announces the seed / node counts after a result lands', () => {
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    const live = document.querySelector('.cg-keywordquery-live');
    expect(live!.textContent).toContain('检索完成');
    expect(live!.textContent).toContain('2 个种子');
    expect(live!.textContent).toContain('2 个节点');
  });

  it('stays silent while loading (no noise on every keystroke-submit)', () => {
    primeStore({ keywordQueryStatus: 'loading', keywordQuery: 'alpha' });
    renderPanel();
    expect(document.querySelector('.cg-keywordquery-live')!.textContent).toBe('');
  });

  it('the seed buttons are reachable by keyboard (real buttons, not divs)', () => {
    primeStore({ keywordQueryStatus: 'ready', keywordQuery: 'alpha', keywordQueryResult: READY_RESULT });
    renderPanel();
    for (const node of document.querySelectorAll('.cg-keywordquery-seed')) {
      expect(node.tagName).toBe('BUTTON');
    }
  });
});
