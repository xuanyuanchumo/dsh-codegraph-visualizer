/**
 * ANIC 工作流图 SVG 面板（M0-① 图区 + M1 全功能面分区）。
 *
 * 为什么是 SVG 而不是 cytoscape：本切片验证的是 **slot 契约与量级**（标签可见/可交互/
 * 138 节点渲染/dispose 干净），不是布局算法。零依赖 SVG 让插件保持零 bundle 依赖
 * （react 之外），安装面与回滚面最小；M3 读路径再评估是否换布局引擎。
 *
 * 数据热更新（三层，全部安全降级）：
 *   1. 嵌入快照（构建期生成，永远可用 —— 多代宿主安全底线）；
 *   2. live 路由 GET /anic/api/workflow-snapshot（宿主注册；挂载时与点「刷新」时拉取；
 *      与嵌入快照共用同一构建器实现 src/shared/snapshotCore.ts）；
 *   3. 路由缺失/404/5xx/无 fetch（极老宿主与离线 smoke 沙盒）→ 回退嵌入快照，
 *      底行如实显示来源（fail-open 家族教训：回退不得伪装成 live）。
 *
 * M1 分区（每区独立 feature 模块，12 §3.1 特性模块制；开关门控走三层合并的
 * user 层）：图区 renderGraph / 步骤流程 renderStepTrace / 诊断 renderDiagnostics /
 * ⚙ 开关抽屉 renderPrefsDrawer。分区缺失（路由 404）显示"不可用"而不伪造空数据。
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { WORKFLOW_SNAPSHOT, type WorkflowEdge, type WorkflowNode } from './workflowGraphData.ts';
import { renderStepTrace, type StepTraceJson } from './features/stepTrace/renderStepTrace.ts';
import { renderDiagnostics, type SelfCheckJson } from './features/diagnostics/renderDiagnostics.ts';
import { renderPrefsDrawer, readPrefsRaw } from './features/prefs/prefsDrawer.ts';
import { resolveFlows, parseRawPrefs } from '../shared/flows.ts';

const TYPE_COLORS: Record<string, string> = {
  phase: '#4a90d9',
  'micro-step': '#7fb3e8',
  gate: '#e6a23c',
  'human-gate': '#d9534f',
  cycle: '#67c23a',
  'gate-event': '#9b59b6',
  incident: '#c0392b',
  autonomy: '#16a085',
};

function colorOf(type: string): string {
  return TYPE_COLORS[type] ?? '#888888';
}

function shortLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function nodeRadius(type: string): number {
  return type === 'phase' || type === 'gate' || type === 'human-gate' ? 7 : 5;
}

interface GraphData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** 纯渲染（smoke 直接断言）：数据 → SVG 元素树。 */
export function renderGraph(data: GraphData): ReactElement {
  const { nodes, edges } = data;
  const byId = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const pad = 30;
  minX -= pad;
  minY -= pad;
  maxX += pad + 120;
  maxY += pad;
  const width = maxX - minX;
  const height = maxY - minY;

  const children: ReactElement[] = [
    createElement(
      'defs',
      { key: 'defs' },
      createElement(
        'marker',
        { key: 'arrow', id: 'anic-spike-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' },
        createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' }),
      ),
    ),
  ];

  edges.forEach((e, i) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    children.push(
      createElement('line', {
        key: `e${String(i)}`,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: '#cbd5e1',
        strokeWidth: 0.7,
        markerEnd: 'url(#anic-spike-arrow)',
      }),
    );
  });

  nodes.forEach((n, i) => {
    const failed = n.result === 'FAIL';
    children.push(
      createElement(
        'g',
        { key: `n${String(i)}`, transform: `translate(${String(n.x)},${String(n.y)})` },
        createElement('title', null, `${n.label} [${n.type}]`),
        createElement('circle', {
          r: nodeRadius(n.type),
          fill: colorOf(n.type),
          stroke: failed ? '#dc2626' : '#334155',
          strokeWidth: failed ? 2 : 0.6,
        }),
        createElement('text', { x: 9, y: 3, fontSize: 7, fill: '#334155' }, shortLabel(n.label)),
      ),
    );
  });

  return createElement('svg', {
    width,
    height,
    viewBox: `${String(minX)} ${String(minY)} ${String(width)} ${String(height)}`,
    style: { background: '#f8fafc', fontFamily: 'monospace', display: 'block' },
  }, children);
}

const SNAPSHOT_URL = '/anic/api/workflow-snapshot';
const STEP_TRACE_URL = '/anic/api/step-trace';
const SELF_CHECK_URL = '/anic/api/self-check';
const SELF_INIT_URL = '/anic/self/init';

interface FetchState {
  source: 'embedded' | 'live';
  line: string;
}

const TOOLBAR_BUTTON: Record<string, unknown> = {
  fontSize: 12, padding: '2px 10px', cursor: 'pointer', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff',
};

/**
 * 面板组件：挂载即并行拉 live（snapshot/step-trace/self-check；各自独立降级）。
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
  const inFlight = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchLive = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    if (typeof fetch !== 'function') return; // 无 fetch 环境：保持嵌入快照
    inFlight.current = true;
    const snapshotTask = (async (): Promise<void> => {
      try {
        const res = await fetch(SNAPSHOT_URL, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          setState({ source: 'embedded', line: `build-time snapshot (live route ${String(res.status)})` });
          return;
        }
        const json = (await res.json()) as GraphData & { generatedAt?: string; counts?: { nodes: number; edges: number } };
        if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) {
          setState((s) => ({ source: s.source, line: 'live response malformed — kept previous data' }));
          return;
        }
        setData({ nodes: json.nodes, edges: json.edges });
        const c = json.counts;
        setState({
          source: 'live',
          line: `live ${json.generatedAt ?? ''} · ${String(c?.nodes ?? json.nodes.length)} nodes / ${String(c?.edges ?? json.edges.length)} edges`,
        });
      } catch (e) {
        setState({ source: 'embedded', line: `build-time snapshot (live fetch failed: ${e instanceof Error ? e.message : String(e)})` });
      }
    })();
    const traceTask = (async (): Promise<void> => {
      try {
        const res = await fetch(STEP_TRACE_URL, { headers: { Accept: 'application/json' } });
        if (!res.ok) { setTrace(null); setTraceLine(`路由不可用 (${String(res.status)})`); return; }
        const json = (await res.json()) as StepTraceJson;
        if (!Array.isArray(json.steps)) { setTrace(null); setTraceLine('响应畸形 — 未采用'); return; }
        setTrace(json);
        setTraceLine(`${String(json.steps.length)} 步 · 投影 ${json.generatedAt}`);
      } catch (e) {
        setTrace(null);
        setTraceLine(`拉取失败 (${e instanceof Error ? e.message : String(e)})`);
      }
    })();
    const checkTask = (async (): Promise<void> => {
      try {
        const res = await fetch(SELF_CHECK_URL, { headers: { Accept: 'application/json' } });
        if (!res.ok) { setCheck(null); setCheckLine(`路由不可用 (${String(res.status)})`); return; }
        const json = (await res.json()) as SelfCheckJson;
        if (!Array.isArray(json.checks)) { setCheck(null); setCheckLine('响应畸形 — 未采用'); return; }
        setCheck(json);
        setCheckLine(json.allOk ? '全部通过' : '存在失败');
      } catch (e) {
        setCheck(null);
        setCheckLine(`拉取失败 (${e instanceof Error ? e.message : String(e)})`);
      }
    })();
    try { await Promise.all([snapshotTask, traceTask, checkTask]); } finally { inFlight.current = false; }
  }, []);

  useEffect(() => {
    void fetchLive();
  }, [fetchLive, reloadKey]);

  // user 层开关门控（每次 flowTick 重读 —— INV-30：关闭形态在 UI 如实呈现）
  const resolved = resolveFlows({ user: parseRawPrefs(readPrefsRaw()).prefs.flows });
  const stepTraceOn = resolved.flows['flow.stepTrace']?.enabled ?? true;
  const diagnosticsOn = resolved.flows['flow.diagnostics']?.enabled ?? true;

  return createElement(
    'div',
    {
      'data-anic-workflow': 'canvas',
      style: { width: '100%', height: '100%', overflow: 'auto', minHeight: 420, background: '#f8fafc' },
    },
    createElement(
      'div',
      {
        'data-anic-toolbar': 'true',
        style: {
          position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center',
          padding: '6px 10px', background: 'rgba(248,250,252,0.92)', borderBottom: '1px solid #e2e8f0',
          fontSize: 12, color: '#475569',
        },
      },
      createElement('span', null, `ANIC · ${state.line}`),
      createElement('button', { type: 'button', 'data-anic-refresh': 'true', onClick: () => { setReloadKey((k) => k + 1); }, style: TOOLBAR_BUTTON }, '刷新'),
      createElement('button', { type: 'button', 'data-anic-prefs-toggle': 'true', onClick: () => { setPrefsOpen((v) => !v); }, style: TOOLBAR_BUTTON }, '⚙ 开关'),
      createElement('button', { type: 'button', 'data-anic-self-init': 'true', onClick: () => { void fetch(SELF_INIT_URL, { method: 'POST' }); }, style: TOOLBAR_BUTTON, title: '对当前工作区执行技能 init-workflow（幂等：已有 config.yml 则 409）' }, '自举'),
    ),
    prefsOpen
      ? renderPrefsDrawer({}, () => { setFlowTick((k) => k + 1); })
      : null,
    renderGraph(data),
    stepTraceOn
      ? createElement(
          'div',
          { key: `trace-${String(flowTick)}`, 'data-anic-steptrace-wrap': 'true', style: { borderTop: '1px solid #e2e8f0' } },
          createElement('div', { style: { fontSize: 10, color: '#94a3b8', padding: '4px 10px 0' } }, `步骤流程数据：${traceLine}`),
          trace ? renderStepTrace(trace) : createElement('div', { style: { fontSize: 11, color: '#94a3b8', padding: '4px 10px' } }, '步骤流程投影不可用（见上方数据行 —— 不伪造空数据）'),
        )
      : createElement('div', { 'data-anic-steptrace-disabled': 'true', style: { fontSize: 11, color: '#b45309', padding: '6px 10px', borderTop: '1px solid #e2e8f0' } }, '步骤流程分区已按开关关闭（关闭形态契约见 ⚙ 抽屉）'),
    diagnosticsOn
      ? createElement(
          'div',
          { key: `check-${String(flowTick)}`, 'data-anic-diagnostics-wrap': 'true', style: { borderTop: '1px solid #e2e8f0' } },
          createElement('div', { style: { fontSize: 10, color: '#94a3b8', padding: '4px 10px 0' } }, `运行时自检：${checkLine}`),
          check ? renderDiagnostics(check) : createElement('div', { style: { fontSize: 11, color: '#94a3b8', padding: '4px 10px' } }, '诊断数据不可用（见上方数据行）'),
        )
      : createElement('div', { 'data-anic-diagnostics-disabled': 'true', style: { fontSize: 11, color: '#b45309', padding: '6px 10px', borderTop: '1px solid #e2e8f0' } }, '诊断分区已按开关关闭'),
  );
}
