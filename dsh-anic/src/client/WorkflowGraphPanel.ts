/**
 * ANIC 工作流图 SVG 面板（M0-① 图区 + M1 全功能面分区）。
 *
 * 纯渲染已提取至 features/graph/renderGraph.ts（12 §3.1 特性模块制）。
 * 本文件只含 React 组件：状态 + 并行 fetch + 分区编排。
 *
 * 数据热更新（三层，全部安全降级）：
 *   1. 嵌入快照（构建期生成，永远可用 —— 多代宿主安全底线）；
 *   2. live 路由 GET /anic/api/workflow-snapshot（宿主注册；挂载时与点「刷新」时拉取）；
 *   3. 路由缺失/404/5xx/无 fetch → 回退嵌入快照，底行如实显示来源。
 *
 * M1 分区（每区独立 feature 模块，开关门控走三层合并的 user 层）：
 * 图区 renderGraph / 步骤流程 renderStepTrace / 诊断 renderDiagnostics /
 * ⚙ 开关抽屉 renderPrefsDrawer / org 全景 renderOrgStatus。
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { WORKFLOW_SNAPSHOT } from './workflowGraphData.ts';
import { renderGraph, buildVerdicts, type GraphData } from './features/graph/renderGraph.ts';
import { renderStepTrace, type StepTraceJson } from './features/stepTrace/renderStepTrace.ts';
import { renderDiagnostics, type SelfCheckJson } from './features/diagnostics/renderDiagnostics.ts';
import { renderPrefsDrawer, readPrefsRaw, PREFS_PANEL_ID } from './features/prefs/prefsDrawer.ts';
import { renderOrgStatus, type OrgStatusJson } from './features/org/renderOrgStatus.ts';
import { useInvocations, renderInvocations } from './features/live/renderInvocations.ts';
import { resolveFlows, parseRawPrefs } from '../shared/flows.ts';
import { renderNodeDetail, type NodeDetail } from './features/graph/gateColors.ts';
import { resolveShellTheme, observeShellTheme, token, tokenCssBlock, THEME_ATTRIBUTE, type ShellTheme } from '../shared/tokens.ts';

const SNAPSHOT_URL = '/anic/api/workflow-snapshot';
const STEP_TRACE_URL = '/anic/api/step-trace';
const SELF_CHECK_URL = '/anic/api/self-check';
const ORG_STATUS_URL = '/anic/org-status';
const SELF_INIT_URL = '/anic/self/init';

interface FetchState { source: 'embedded' | 'live'; line: string; }

const BTN: Record<string, unknown> = {
  fontSize: 12, padding: '2px 10px', cursor: 'pointer', border: `1px solid ${token('anic-border')}`, borderRadius: 4, background: token('anic-surface'),
};


/**
 * 注入面板作用域的设计令牌（P1-TOKENS）。
 *
 * `var(--x, fallback)` 的 fallback 只在变量未定义时生效——它是兜底，不是主题机制。
 * 令牌块必须真的注入一次，否则全站都走 fallback，"换主题只需改变量"就是空话。
 * 注入挂在 document.head，卸载时移除；同页面多个面板实例不会重复注入（id 去重）。
 */
function useTokenCss(): void {
  useEffect(() => {
    const id = 'anic-design-tokens';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = tokenCssBlock();
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, []);
}

/**
 * 跟踪宿主主题并把它写到面板根属性上（P0-THEME-MISMATCH）。
 *
 * 为什么不能只靠 CSS：宿主主题是**运行时状态**（用户在设置里切），而我们的
 * 暗色令牌必须跟着它走。原实现用 `@media (prefers-color-scheme: dark)` 近似，
 * 在"OS 暗色 + 宿主浅色"时套用暗色令牌 → 深底深字，实测几乎不可读。
 *
 * 这里读 `body[data-ds-dark-theme]`（宿主 theme-presenter 的权威输出，
 * 见 `tokens.ts` 注释），并订阅其变化，把结果写成 `[data-anic-theme]`。
 * 惰性求值 + 订阅，二者缺一不可：缓存初始值会让设置里切换主题后面板不跟随；
 * 不订阅则只能等下次重挂载。
 */
function useShellTheme(): ShellTheme {
  const [theme, setTheme] = useState<ShellTheme>(() => resolveShellTheme());
  useEffect(() => {
    // 挂载后立刻再读一次：属性可能晚于首次渲染到达（DOMContentLoaded 之前）。
    setTheme(resolveShellTheme());
    return observeShellTheme(setTheme);
  }, []);
  return theme;
}


/**
 * 面板组件：挂载即并行拉 live（snapshot/step-trace/self-check/org-status；各自独立降级）。
 * 「刷新」手动重拉；「⚙」展开开关抽屉。in-flight 守卫防抖；无 fetch（smoke 沙盒）
 * → 保持嵌入快照。分区按 user 层开关门控（INV-30：关闭形态在 UI 如实呈现）。
 */
export function WorkflowGraphPanel(): ReactElement {
  const [data, setData] = useState<GraphData>({ nodes: WORKFLOW_SNAPSHOT.nodes, edges: WORKFLOW_SNAPSHOT.edges });
  const [state, setState] = useState<FetchState>({ source: 'embedded', line: 'build-time snapshot' });
  const [trace, setTrace] = useState<StepTraceJson | null>(null);
  const [traceLine, setTraceLine] = useState<string>('未加载');
  const [check, setCheck] = useState<SelfCheckJson | null>(null);
  const [checkLine, setCheckLine] = useState<string>('未加载');
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [flowTick, setFlowTick] = useState(0);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [orgStatus, setOrgStatus] = useState<OrgStatusJson | null>(null);
  const inFlight = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchLive = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    if (typeof fetch !== 'function') return;
    inFlight.current = true;
    const tasks = [
      (async (): Promise<void> => {
        try {
          const res = await fetch(SNAPSHOT_URL, { headers: { Accept: 'application/json' } });
          if (!res.ok) { setState({ source: 'embedded', line: `build-time snapshot (live route ${String(res.status)})` }); return; }
          const json = (await res.json()) as GraphData & { generatedAt?: string; counts?: { nodes: number; edges: number } };
          if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) { setState((s) => ({ source: s.source, line: 'live response malformed — kept previous data' })); return; }
          setData({ nodes: json.nodes, edges: json.edges });
          const c = json.counts;
          setState({ source: 'live', line: `live ${json.generatedAt ?? ''} · ${String(c?.nodes ?? json.nodes.length)} nodes / ${String(c?.edges ?? json.edges.length)} edges` });
        } catch (e) { setState({ source: 'embedded', line: `build-time snapshot (live fetch failed: ${e instanceof Error ? e.message : String(e)})` }); }
      })(),
      (async (): Promise<void> => {
        try {
          const res = await fetch(STEP_TRACE_URL, { headers: { Accept: 'application/json' } });
          if (!res.ok) { setTrace(null); setTraceLine(`路由不可用 (${String(res.status)})`); return; }
          const json = (await res.json()) as StepTraceJson;
          if (!Array.isArray(json.steps)) { setTrace(null); setTraceLine('响应畸形 — 未采用'); return; }
          setTrace(json); setTraceLine(`${String(json.steps.length)} 步 · 投影 ${json.generatedAt}`);
        } catch (e) { setTrace(null); setTraceLine(`拉取失败 (${e instanceof Error ? e.message : String(e)})`); }
      })(),
      (async (): Promise<void> => {
        try {
          const res = await fetch(SELF_CHECK_URL, { headers: { Accept: 'application/json' } });
          if (!res.ok) { setCheck(null); setCheckLine(`路由不可用 (${String(res.status)})`); return; }
          const json = (await res.json()) as SelfCheckJson;
          if (!Array.isArray(json.checks)) { setCheck(null); setCheckLine('响应畸形 — 未采用'); return; }
          setCheck(json); setCheckLine(json.allOk ? '全部通过' : '存在失败');
        } catch (e) { setCheck(null); setCheckLine(`拉取失败 (${e instanceof Error ? e.message : String(e)})`); }
      })(),
      (async (): Promise<void> => {
        try {
          const res = await fetch(ORG_STATUS_URL, { headers: { Accept: 'application/json' } });
          if (!res.ok) { setOrgStatus(null); return; }
          setOrgStatus((await res.json()) as OrgStatusJson);
        } catch { setOrgStatus(null); }
      })(),
    ];
    try { await Promise.all(tasks); } finally { inFlight.current = false; }
  }, []);

  useEffect(() => { void fetchLive(); }, [fetchLive, reloadKey]);

  const resolved = resolveFlows({ user: parseRawPrefs(readPrefsRaw()).prefs.flows });
  const stepTraceOn = resolved.flows['flow.stepTrace']?.enabled ?? true;
  const diagnosticsOn = resolved.flows['flow.diagnostics']?.enabled ?? true;
  useTokenCss();
  const theme = useShellTheme();
  // 实时调用流（cycle-97 动态白盒）：与静态分区并列，展示"正在发生的调用"。
  const { data: invocations, pollError: invocationsError } = useInvocations();

  return createElement(
    'div',
    // overflow 必须是 visible、且**不能**给 height:100%：宿主把本面板挂在
    // [data-conversation-scroll] 里，而挂载点的高度是 auto。给它 overflow:auto 会让它
    // 自己变成"最近的滚动容器"却永远不滚动（内容撑高它，它再撑高父级，滚动实际发生在
    // 宿主的滚动体上）——于是 position:sticky 的工具栏粘在一个不滚动的盒子上，
    // 用户往下滚时工具栏跟着滚出屏幕，等于没有粘性。实测：滚动宿主 0→500→2000→6000px
    // 时工具栏 y 依次 76→-424→-1924→-5924（完全跟走）。改回 visible 后 sticky 才绑到
    // 真正滚动的祖先，同一组滚动位置 y 恒为 76。
    //
    // data-anic-theme：面板主题的唯一开关，由 useShellTheme() 写宿主解析后的主题
    // （不是 OS 偏好）。令牌块里 `[data-anic-theme='dark']` 依赖它选暗色语义层。
    { 'data-anic-workflow': 'canvas', [THEME_ATTRIBUTE]: theme, style: { width: '100%', overflow: 'visible', minHeight: 420, background: token('anic-surface') } },
    createElement(
      'div',
      // role="toolbar"：把三个动作声明为一组，AT 才会播报"工具栏"边界；
      // 容器本身**不可聚焦**（工具栏是容器不是控件），焦点留在按钮上。
      { 'data-anic-toolbar': 'true', role: 'toolbar', 'aria-label': 'ANIC 工作流工具栏', style: { position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', background: token('anic-surface'), borderBottom: `1px solid ${token('anic-border')}`, fontSize: 12, color: token('anic-text') } },
      // role="status"：拉取结果（成功/失败/降级）是异步反馈，无 live region 时
      // 屏幕阅读器完全感知不到——刷新按钮点了"没反应"。
      createElement('span', { role: 'status', 'aria-live': 'polite' }, `ANIC · ${state.line}`),
      createElement('button', { type: 'button', 'data-anic-refresh': 'true', onClick: () => { setReloadKey((k) => k + 1); }, style: BTN }, '刷新'),
      // 抽屉开关是 disclosure：aria-expanded 报告开合，aria-controls 指向被控容器。
      createElement('button', { type: 'button', 'data-anic-prefs-toggle': 'true', 'aria-expanded': prefsOpen, 'aria-controls': PREFS_PANEL_ID, onClick: () => { setPrefsOpen((v) => !v); }, style: BTN }, '⚙ 开关'),
      createElement('button', { type: 'button', 'data-anic-self-init': 'true', onClick: () => { void fetch(SELF_INIT_URL, { method: 'POST' }); }, style: BTN, title: '对当前工作区执行技能 init-workflow（幂等）' }, '自举'),
    ),
    prefsOpen ? renderPrefsDrawer({}, () => { setFlowTick((k) => k + 1); }) : null,
    renderGraph(data, buildVerdicts(trace), (n) => { setSelectedNode({ id: n.id, label: n.label, type: n.type, result: n.result }); }),
    // 实时调用分区紧跟图区：动态白盒是本面板的主叙事（m02733），
    // 用户展开面板第一眼应看到"模型此刻在怎么调用本插件"。
    renderInvocations(invocations, invocationsError),
    stepTraceOn
      ? createElement('div', { key: `trace-${String(flowTick)}`, 'data-anic-steptrace-wrap': 'true', style: { borderTop: `1px solid ${token('anic-border')}` } },
          createElement('div', { style: { fontSize: 10, color: token('anic-text-faint'), padding: '4px 10px 0' } }, `步骤流程数据：${traceLine}`),
          trace ? renderStepTrace(trace) : createElement('div', { style: { fontSize: 11, color: token('anic-text-faint'), padding: '4px 10px' } }, '步骤流程投影不可用（见上方数据行 —— 不伪造空数据）'),
        )
      : createElement('div', { 'data-anic-steptrace-disabled': 'true', style: { fontSize: 11, color: token('anic-warn-text'), padding: '6px 10px', borderTop: `1px solid ${token('anic-border')}` } }, '步骤流程分区已按开关关闭（关闭形态契约见 ⚙ 抽屉）'),
    diagnosticsOn
      ? createElement('div', { key: `check-${String(flowTick)}`, 'data-anic-diagnostics-wrap': 'true', style: { borderTop: `1px solid ${token('anic-border')}` } },
          createElement('div', { style: { fontSize: 10, color: token('anic-text-faint'), padding: '4px 10px 0' } }, `运行时自检：${checkLine}`),
          check ? renderDiagnostics(check) : createElement('div', { style: { fontSize: 11, color: token('anic-text-faint'), padding: '4px 10px' } }, '诊断数据不可用（见上方数据行）'),
        )
      : createElement('div', { 'data-anic-diagnostics-disabled': 'true', style: { fontSize: 11, color: token('anic-warn-text'), padding: '6px 10px', borderTop: `1px solid ${token('anic-border')}` } }, '诊断分区已按开关关闭'),
    orgStatus ? createElement('div', { 'data-anic-org-wrap': 'true', style: { borderTop: `1px solid ${token('anic-border')}` } }, renderOrgStatus(orgStatus)) : null,
    renderNodeDetail(selectedNode),
  );
}
