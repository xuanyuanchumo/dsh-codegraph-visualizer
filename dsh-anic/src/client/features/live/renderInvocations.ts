/**
 * 实时调用分区（cycle-97 动态白盒）——把模型对本插件的**调用过程**实时呈现。
 *
 * 与静态分区的本质区别：步骤流程/诊断/org 读的是**已落盘的产物**（评估报告、
 * 门禁账本、自检结果），本分区轮询 /anic/api/invocations/live 看的是**正在进行
 * 的调用**（请求瞬间 → 执行中 → 完成/失败），进程内存态、随会话流动。
 *
 * 轮询而非 SSE：宿主 webServer 槽位的 exact 路由没有流式契约，多代兼容下
 * 轮询是唯一全版本可用的通道；2s 间隔对"人眼看模型调用工具"足够实时。
 */
import { createElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { token } from '../../../shared/tokens.ts';

/** 与宿主 InvocationRecord 对齐的最小客户端形状。 */
export interface InvocationJson {
  callId: string;
  name: string;
  argumentsPreview: string;
  turn?: number;
  step?: number;
  startedAt: number;
  endedAt?: number;
  status: 'in-flight' | 'done' | 'error';
  error?: { name: string; code: string; reason?: string };
  durationMs?: number;
  possiblyOrphaned?: boolean;
}

export interface InvocationsJson {
  invocations: InvocationJson[];
  total: number;
  generatedAt: string;
}

const LIVE_URL = '/anic/api/invocations/live';

/** in-flight 状态点的脉冲动画（prefers-reduced-motion 逃逸，与 FAIL_PULSE_STYLE 同纪律）。 */
const LIVE_PULSE_STYLE = `@keyframes anic-live-pulse{0%,100%{opacity:1}50%{opacity:.35}}.anic-live-dot{animation:anic-live-pulse 1.2s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.anic-live-dot{animation:none}}`;

/**
 * 轮询钩子：2s 拉一次实时调用流。
 *
 * 失败语义（如实呈现，不静默）：路由 5xx/网络失败 → pollError 置位并**保留
 * 上次数据**（面板同时显示"轮询失败"与陈旧数据的 generatedAt——用户能分辨
 * "没有调用"和"拉不到"）。无 fetch（smoke 沙盒）→ 一次都不拉。
 */
export function useInvocations(pollMs = 2000): { data: InvocationsJson | null; pollError: string | null } {
  const [data, setData] = useState<InvocationsJson | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (typeof fetch !== 'function') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(LIVE_URL, { headers: { Accept: 'application/json' } });
        if (!res.ok) { setPollError(`路由 ${String(res.status)}`); }
        else {
          const json = (await res.json()) as InvocationsJson;
          // 形状校验：invocations 非数组视为畸形，不采用（与面板其他分区同纪律）。
          if (!Array.isArray(json.invocations)) { setPollError('响应畸形'); }
          else { if (aliveRef.current) { setData(json); setPollError(null); } }
        }
      } catch (e) { if (aliveRef.current) setPollError(e instanceof Error ? e.message : String(e)); }
      finally { if (aliveRef.current) timer = setTimeout(() => { void tick(); }, pollMs); }
    };
    void tick();
    return () => { aliveRef.current = false; if (timer) clearTimeout(timer); };
  }, [pollMs]);

  return { data, pollError };
}

function statusColor(status: InvocationJson['status']): string {
  // 状态点用图形令牌（≥3:1 双表面），文本用文本令牌（≥4.5:1）。
  if (status === 'done') return token('anic-status-done');
  if (status === 'error') return token('anic-status-failed');
  return token('anic-status-active');
}

function statusText(inv: InvocationJson): string {
  if (inv.status === 'in-flight') return inv.possiblyOrphaned ? '疑似失联' : '执行中';
  if (inv.status === 'error') return '失败';
  return '完成';
}

/** 渲染实时调用分区。data 为 null 且无错误 = 尚未轮询到（不伪造空态）。 */
export function renderInvocations(data: InvocationsJson | null, pollError: string | null): ReactElement {
  return createElement(
    'div',
    { 'data-anic-invocations': 'section', style: { borderTop: `1px solid ${token('anic-border')}` } },
    createElement('style', null, LIVE_PULSE_STYLE),
    createElement(
      'div',
      { style: { fontSize: 10, color: token('anic-text-faint'), padding: '4px 10px 0' } },
      `实时调用（动态白盒）：${data ? `${String(data.total)} 条 · 快照 ${data.generatedAt}` : '未取得'}${pollError ? ` · 轮询失败（${pollError}）—— 以下为最后已知数据` : ''}`,
    ),
    // 三态分支：null（尚未轮询到）≠ 空流（确实没有调用）≠ 有数据。
    // null 显示"等首轮轮询"而不是空态引导——把"还没拿到"伪装成"没有调用"
    // 与静态分区的"未加载 ≠ 不可用"是同一纪律。
    data === null
      ? createElement('div', { 'data-anic-invocations-pending': 'true', style: { fontSize: 11, color: token('anic-text-faint'), padding: '4px 10px' } },
          '等待首轮轮询（路由不可用或 fetch 未就绪时此行常驻——不伪造空态）。')
      : data.invocations.length === 0
        ? createElement('div', { 'data-anic-invocations-empty': 'true', style: { fontSize: 11, color: token('anic-text-faint'), padding: '4px 10px' } },
            '暂无插件调用。在对话中让模型调用 anic_* 工具或 skill(ai-native-iteration-cycle)，此处将实时显示调用过程。')
        : createElement(
            'div',
            { 'data-anic-invocation-list': 'true', style: { padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: 4 } },
            ...data.invocations.map((inv) => createElement(
              'div',
              {
                'data-anic-invocation': inv.callId,
                'data-anic-invocation-status': inv.status,
                key: inv.callId,
                style: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, fontFamily: 'ui-monospace, monospace', color: token('anic-text') },
              },
              // 状态点：in-flight 走脉冲动画类（普通类名走 anic-live-dot）。
              createElement('span', {
                'data-anic-invocation-dot': inv.status,
                className: inv.status === 'in-flight' ? 'anic-live-dot' : undefined,
                style: { width: 7, height: 7, borderRadius: '50%', background: statusColor(inv.status), flexShrink: 0, alignSelf: 'center' },
              }),
              createElement('span', { style: { color: token('anic-text-strong') } }, inv.name),
              createElement('span', null, statusText(inv)),
              typeof inv.durationMs === 'number' ? createElement('span', { style: { color: token('anic-text-dim') } }, `${String(inv.durationMs)}ms`) : null,
              typeof inv.turn === 'number' && typeof inv.step === 'number' ? createElement('span', { style: { color: token('anic-text-faint') } }, `t${String(inv.turn)}/s${String(inv.step)}`) : null,
              createElement('span', { style: { color: token('anic-text-faint'), overflowWrap: 'anywhere' } },
                inv.error ? `${inv.error.name}(${inv.error.code})${inv.error.reason ? `: ${inv.error.reason.slice(0, 120)}` : ''}` : inv.argumentsPreview),
            )),
          ),
  );
}
