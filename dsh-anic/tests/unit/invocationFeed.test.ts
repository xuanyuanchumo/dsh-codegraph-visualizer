/**
 * invocationFeed 单元测试（cycle-97 动态白盒调用流）。
 *
 * 契约锚点（转录自 dsh-plugin-dev-kb 镜像官方文档，见 invocationFeed.ts 文件头）：
 *   - session/event 携带持久化事件 tool/call = { turn, step, callId, name, arguments(原始串) }
 *   - tools/result 携带 (exec: {callId,...}, result: {isError, error?})
 *   - 两相位按 callId 配对（官方 ToolCallId 同源）
 *
 * 关键负例（防倒退）：
 *   - 非 anic_ 工具与无关 skill 调用不得进入流（过滤面是白盒边界）；
 *   - 结束先于开始 → 不伪造开始（跨订阅窗口的孤立结果直接丢弃）；
 *   - feed 缺失时路由显式 500（空流 200 会让"未接线"冒充"没有调用"）。
 */
import { describe, it, expect } from 'vitest';
import {
  createInvocationFeed, attachInvocationFeed, isAnicInvocation, previewOf,
  type InvocationFeed,
} from '../../src/host/runtime/invocationFeed.ts';
import { registerInvocationRoute } from '../../src/host/routes/invocationRoute.ts';

/** 转录真实信封（dsh-session Session.append:1453-1459）：{type, seq, time, data}。 */
function toolCallEvent(data: Record<string, unknown>): { type: string; seq: number; time: number; data: Record<string, unknown> } {
  return { type: 'tool/call', seq: 0, time: Date.now(), data };
}

describe('isAnicInvocation（过滤面）', () => {
  it('anic_* 工具全部命中', () => {
    expect(isAnicInvocation('anic_evaluate', '{}')).toBe(true);
    expect(isAnicInvocation('anic_skill', '{"script":"eval-runner"}')).toBe(true);
    expect(isAnicInvocation('anic_self_check', '')).toBe(true);
  });
  it('官方 skill 工具调用本技能命中（参数是模型产出的原始串，不解析）', () => {
    expect(isAnicInvocation('skill', '{"name":"ai-native-iteration-cycle"}')).toBe(true);
    expect(isAnicInvocation('skill', '{"name":"ai-native-iteration-cycle","verbose":true}')).toBe(true);
  });
  it('官方 skill 工具调用其他技能不命中；无关工具不命中', () => {
    expect(isAnicInvocation('skill', '{"name":"skill-creator"}')).toBe(false);
    expect(isAnicInvocation('read', '{"path":"x"}')).toBe(false);
    expect(isAnicInvocation('anic', '{}')).toBe(false); // 前缀必须是 anic_ 带下划线
  });
});

describe('createInvocationFeed（环回缓冲）', () => {
  it('recordCall 建立 in-flight 记录；recordResult 按 callId 配对为 done 并算时长', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c1', name: 'anic_evaluate', arguments: '{"workspace":"."}', turn: 3, step: 1 });
    let snap = feed.snapshot();
    expect(snap.total).toBe(1);
    expect(snap.invocations[0]?.status).toBe('in-flight');
    expect(snap.invocations[0]?.argumentsPreview).toBe('{"workspace":"."}');
    feed.recordResult('c1', { isError: false });
    snap = feed.snapshot();
    expect(snap.invocations[0]?.status).toBe('done');
    expect(typeof snap.invocations[0]?.durationMs).toBe('number');
    expect(snap.invocations[0]?.endedAt).toBeDefined();
  });
  it('错误结果 → status=error 且保留 error 三元组', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c2', name: 'anic_gate_check', arguments: '' });
    feed.recordResult('c2', { isError: true, error: { name: 'GateError', code: 'G1_FAIL', reason: '任务清单缺失' } });
    const snap = feed.snapshot();
    expect(snap.invocations[0]?.status).toBe('error');
    expect(snap.invocations[0]?.error?.code).toBe('G1_FAIL');
  });
  it('环回上限 drop-oldest（默认 50），被逐出的 callId 不再可配对', () => {
    const feed = createInvocationFeed(3);
    for (let i = 0; i < 4; i++) feed.recordCall({ callId: `c${String(i)}`, name: 'anic_status', arguments: '' });
    const snap = feed.snapshot();
    expect(snap.total).toBe(3);
    expect(snap.invocations.map((r) => r.callId)).toEqual(['c3', 'c2', 'c1']); // 最新在前
    feed.recordResult('c0', { isError: false }); // 已被逐出 → 忽略
    expect(feed.snapshot().total).toBe(3);
  });
  it('同 callId 重复 call 不覆盖首见记录（重放/补偿防抖）', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c1', name: 'anic_evaluate', arguments: 'A' });
    feed.recordResult('c1', { isError: false });
    feed.recordCall({ callId: 'c1', name: 'anic_evaluate', arguments: 'B' }); // 迟到的重放
    const snap = feed.snapshot();
    expect(snap.total).toBe(1);
    expect(snap.invocations[0]?.status).toBe('done'); // 不回退到 in-flight
  });
  it('结束先于开始 → 不伪造开始（孤立结果丢弃）', () => {
    const feed = createInvocationFeed();
    feed.recordResult('ghost', { isError: false });
    expect(feed.snapshot().total).toBe(0);
  });
  it('终态后再收结果 → 忽略（不重复计时）；recordResult 返回是否真实结算', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c1', name: 'anic_status', arguments: '' });
    expect(feed.recordResult('c1', { isError: false })).toBe(true); // 命中 in-flight
    const first = feed.snapshot().invocations[0]?.durationMs;
    expect(feed.recordResult('c1', { isError: true, error: { name: 'X', code: 'Y' } })).toBe(false); // 迟到错误不改写终态
    const after = feed.snapshot().invocations[0];
    expect(after?.status).toBe('done');
    expect(after?.durationMs).toBe(first);
    expect(feed.recordResult('ghost', { isError: false })).toBe(false); // 无开始相位
  });
  it('in-flight 超 15 分钟标记 possiblyOrphaned（不把失联伪装成还在跑）', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c1', name: 'anic_evaluate', arguments: '' });
    const now = Date.now() + 16 * 60 * 1000; // 16 分钟后快照
    const snap = feed.snapshot(now);
    expect(snap.invocations[0]?.possiblyOrphaned).toBe(true);
    const early = feed.snapshot(Date.now() + 60 * 1000); // 1 分钟内不误报
    expect(early.invocations[0]?.possiblyOrphaned).toBeFalsy();
  });
  it('snapshot 返回副本：改副本不影响内部状态', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c1', name: 'anic_status', arguments: '' });
    const snap = feed.snapshot();
    snap.invocations[0]!.status = 'done'; // 篡改副本
    expect(feed.snapshot().invocations[0]?.status).toBe('in-flight');
  });
});

describe('previewOf（参数预览截断）', () => {
  it('≤200 字符原样保留；>200 截断加省略号', () => {
    const short = 'a'.repeat(200);
    expect(previewOf(short)).toBe(short);
    const long = 'b'.repeat(250);
    expect(previewOf(long)).toBe(`b`.repeat(200) + '…');
    expect(previewOf(long).length).toBe(201);
  });
});

describe('attachInvocationFeed（宿主事件接线）', () => {
  function makeEventCtx(): { ctx: unknown; emit: (name: string, ...args: unknown[]) => void; handlers: Map<string, Array<(...a: unknown[]) => void>> } {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    const ctx = { on: (name: string, handler: (...a: unknown[]) => void): void => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
    return { ctx, handlers, emit: (name: string, ...args: unknown[]) => { for (const h of handlers.get(name) ?? []) h(...args); } };
  }

  it('tool/call + tools/result 全链路：anic 工具进入流并配对终态', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    emit('session/event', { id: 's1' }, toolCallEvent({ callId: 'call-1', name: 'anic_evaluate', arguments: '{"dimensions":"E1"}', turn: 1, step: 2 }));
    expect(feed.snapshot().total).toBe(1);
    emit('tools/result', { callId: 'call-1', name: 'anic_evaluate' }, { isError: false, content: [] });
    const snap = feed.snapshot();
    expect(snap.invocations[0]?.status).toBe('done');
    expect(snap.invocations[0]?.turn).toBe(1);
    expect(snap.invocations[0]?.step).toBe(2);
  });
  it('官方 skill 工具调用本技能也进入流（伴生通道）', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    emit('session/event', {}, toolCallEvent({ callId: 'call-2', name: 'skill', arguments: '{"name":"ai-native-iteration-cycle"}' }));
    expect(feed.snapshot().total).toBe(1);
  });
  it('无关工具/其他技能调用/非 tool-call 事件被过滤；无关 tools/result 不入流', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    emit('session/event', {}, toolCallEvent({ callId: 'x1', name: 'read', arguments: '{}' }));
    emit('session/event', {}, toolCallEvent({ callId: 'x2', name: 'skill', arguments: '{"name":"ponytail"}' }));
    emit('session/event', {}, { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } });
    emit('session/event', {}, toolCallEvent({ callId: '', name: 'anic_evaluate', arguments: '' })); // callId 非法
    emit('tools/result', { callId: 'unmatched', name: 'read' }, { isError: false });
    expect(feed.snapshot().total).toBe(0);
  });
  it('宿主无 on（stub/旧代）→ 不崩溃，feed 仍可查询；无诊断注入', () => {
    const feed = attachInvocationFeed({}, createInvocationFeed());
    expect(feed.snapshot().total).toBe(0);
    expect(feed.diagnostics).toBeUndefined();
  });
});

describe('诊断计数（事件到达情况本身也要透明）', () => {
  function makeEventCtx(): { ctx: unknown; emit: (name: string, ...args: unknown[]) => void } {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    const ctx = { on: (name: string, handler: (...a: unknown[]) => void): void => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
    return { ctx, emit: (name: string, ...args: unknown[]) => { for (const h of handlers.get(name) ?? []) h(...args); } };
  }

  it('混合事件序列：五计数器各自只数自己的面', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    emit('session/event', {}, { type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } });                                    // sessionEvents+1
    emit('session/event', {}, toolCallEvent({ callId: 'a1', name: 'read', arguments: '{}' }));                                         // +toolCalls（非 anic）
    emit('session/event', {}, toolCallEvent({ callId: 'a2', name: 'anic_status', arguments: '' }));                                    // +toolCalls +anicCalls
    emit('tools/result', { callId: 'a1', name: 'read' }, { isError: false });                        // toolsResults+1（未结算）
    emit('tools/result', { callId: 'a2', name: 'anic_status' }, { isError: false });                 // +results +anicResults
    const d = feed.diagnostics!();
    expect(d).toEqual({ sessionEvents: 3, sessionToolCalls: 2, toolsResults: 2, anicCalls: 1, anicResults: 1 });
  });
  it('diagnostics() 返回副本：篡改返回值不影响后续读数', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    emit('session/event', {}, { type: 'turn/start', seq: 0, time: Date.now(), data: {} });
    const d1 = feed.diagnostics!();
    d1.sessionEvents = 999;
    expect(feed.diagnostics!().sessionEvents).toBe(1);
  });
  it('空流但计数 > 0 = 「事件到了被过滤」的证据（区分事件没到）；载荷缺失 data 不误吞', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    emit('session/event', {}, toolCallEvent({ callId: 'x1', name: 'read', arguments: '{}' }));
    expect(feed.snapshot().total).toBe(0);
    const d = feed.diagnostics!();
    expect(d.sessionEvents).toBe(1);
    expect(d.anicCalls).toBe(0); // 到了但全被过滤——这正是 P0-B 排障需要的区分
  });
  it('信封回归锚（P0-FEED-ENVELOPE）：载荷在 event.data 顶层字段恒 undefined', () => {
    const { ctx, emit } = makeEventCtx();
    const feed = createInvocationFeed();
    attachInvocationFeed(ctx, feed);
    // 真实信封：data 内才是 callId/name——曾按扁平形状读导致 anicCalls 恒 0
    emit('session/event', {}, toolCallEvent({ callId: 'e1', name: 'anic_status', arguments: '' }));
    expect(feed.snapshot().total).toBe(1);
    expect(feed.diagnostics!().anicCalls).toBe(1);
  });
});

describe('registerInvocationRoute（路由）', () => {
  function makeRes(): { res: unknown; captured: { status: number | null; body: string | null } } {
    const captured = { status: null as number | null, body: null as string | null };
    return { res: { writeHead: (s: number): void => { captured.status = s; }, end: (b?: string): void => { captured.body = b ?? null; } }, captured };
  }
  function makeCtx(feed: InvocationFeed | null): { ctx: unknown; handler: (req: unknown, res: unknown) => void } {
    let handler: (req: unknown, res: unknown) => void = (): void => {};
    const ctx = { webServer: { register: (def: { path: string; handler: (req: unknown, res: unknown) => void }): (() => void) => { handler = def.handler; return (): void => {}; } } };
    const d = registerInvocationRoute(ctx, { send: (res, status, body) => { const r = res as { writeHead: (s: number) => void; end: (b?: string) => void }; r.writeHead(status); r.end(JSON.stringify(body)); }, feed });
    expect(d).toBeTypeOf('function');
    return { ctx, handler };
  }

  it('feed 存在 → 200 返回快照（含 diagnostics；未注入时为 null）', () => {
    const feed = createInvocationFeed();
    feed.recordCall({ callId: 'c1', name: 'anic_status', arguments: '' });
    feed.recordResult('c1', { isError: false });
    const { handler } = makeCtx(feed);
    const { res, captured } = makeRes();
    handler({}, res);
    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body ?? '{}') as { total: number; invocations: Array<{ status: string }>; diagnostics: unknown };
    expect(body.total).toBe(1);
    expect(body.invocations[0]?.status).toBe('done');
    expect(body.diagnostics).toBeNull(); // 未走 attach 的裸 feed 无诊断——路由必须诚实呈现 null
  });
  it('feed 缺失 → 显式 500（未接线 ≠ 没有调用）', () => {
    const { handler } = makeCtx(null);
    const { res, captured } = makeRes();
    handler({}, res);
    expect(captured.status).toBe(500);
    expect(String((JSON.parse(captured.body ?? '{}') as { error: string }).error)).toContain('not attached');
  });
  it('接线后的 feed → 路由响应携带实时诊断计数', () => {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    const evtCtx = { on: (name: string, handler: (...a: unknown[]) => void): void => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
    const feed = attachInvocationFeed(evtCtx, createInvocationFeed());
    for (const h of handlers.get('session/event') ?? []) h({}, { type: 'tool/call', seq: 0, time: Date.now(), data: { callId: 'a1', name: 'anic_status', arguments: '' } });
    const { handler } = makeCtx(feed);
    const { res, captured } = makeRes();
    handler({}, res);
    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body ?? '{}') as { diagnostics: { sessionEvents: number; sessionToolCalls: number; anicCalls: number } };
    expect(body.diagnostics.sessionEvents).toBe(1);
    expect(body.diagnostics.sessionToolCalls).toBe(1);
    expect(body.diagnostics.anicCalls).toBe(1);
  });
  it('无 webServer → null（多代降级）', () => {
    expect(registerInvocationRoute({}, { send: (): void => {}, feed: null })).toBeNull();
  });
});
