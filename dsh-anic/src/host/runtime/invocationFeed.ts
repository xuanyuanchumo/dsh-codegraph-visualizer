/**
 * 实时调用环回缓冲 —— 动态白盒调用流（m02733 核心需求：不能只可视化静态产物）。
 *
 * 数据来源是 DSH 官方事件双通道（契约见 dsh-plugin-dev-kb 镜像
 * kb/site/develop/framework/events.md 与 kb/site/reference/subsystems/session.md，
 * 已对安装版 asar 二进制验证 dsh-skill/SkillRegistry/registerProvider 在场）：
 *
 *   开始：Cordis 事件 `session/event`（emit）携带持久化会话事件
 *         `tool/call` = { turn, step, callId, name, arguments(原始串,未解析) }
 *         —— 这是**模型请求调用工具的瞬间**，in-flight 从这里开始。
 *   结束：Cordis 事件 `tools/result`（emit）携带
 *         (exec: ToolExecution, result: ToolExecutionResult)
 *         —— exec.callId 与 tool/call 的 callId 同源配对；result 按 isError 判别，
 *            失败态带 error: { name, code, reason? }。
 *
 * 为什么结束不用 session/event 的 tool/result：它的载荷是 message: ToolResultMessage，
 * callId 提取不在我们核验过的文档契约里；tools/result 的 exec.callId 是文档明写的。
 * 每个相位走一条已核验通道。
 *
 * 过滤范围（isAnicInvocation）：本插件的两类调用面——
 *   1. anic_* 工具（12 个：evaluate/iterate/gate_check/bootstrap/...）；
 *   2. 官方 skill 工具对本技能的调用（name === 'skill' 且原始参数含
 *      'ai-native-iteration-cycle'）——「dsh 的轨迹要有本技能插件的调用」的伴生通道。
 *
 * 环回缓冲上限 50 条，drop-oldest；进程内存态（重启即清空，如实呈现）。
 * in-flight 超过 15 分钟标记 possiblyOrphaned（tools/result 因进程内异常未到达时，
 * 面板不把"永远转圈"伪装成"还在跑"）。
 */
import { createScoped } from '../logger.ts';

const log = createScoped('anic:invocation-feed');

/** 单次工具调用的白盒记录（序列化形状 = 路由响应形状）。 */
export interface InvocationRecord {
  callId: string;
  name: string;
  /** 模型产出的原始参数串（未解析），截断到 200 字符。 */
  argumentsPreview: string;
  turn?: number;
  step?: number;
  startedAt: number;
  endedAt?: number;
  status: 'in-flight' | 'done' | 'error';
  error?: { name: string; code: string; reason?: string };
  durationMs?: number;
  /** in-flight 超过 15 分钟：结束事件大概率永远不会来，如实标记。 */
  possiblyOrphaned?: boolean;
}

/** 路由响应形状。 */
export interface InvocationFeedSnapshot {
  invocations: InvocationRecord[];
  total: number;
  generatedAt: string;
}

/**
 * 事件通道诊断计数（动态白盒的一部分：事件到达情况本身也要透明，不能只看结果）。
 * 排障价值：feed 空时区分「事件根本没到」（sessionEvents/toolsResults 为 0）
 * 与「事件到了但被过滤/配对逻辑丢弃」（计数 > 0 但 invocations 空）。
 */
export interface FeedDiagnostics {
  /** 订阅后看到的 session/event 事件总数（任意类型，含非 tool/call）。 */
  sessionEvents: number;
  /** 其中 type === 'tool/call' 的事件数（任意工具名）。 */
  sessionToolCalls: number;
  /** 看到的 tools/result 事件总数（任意工具，含非本插件调用）。 */
  toolsResults: number;
  /** 通过 isAnicInvocation 过滤、进入 feed 的开始相位数。 */
  anicCalls: number;
  /** 结束相位到达且 feed 内有对应 in-flight 记录的次数。 */
  anicResults: number;
}

/** 判定一次调用是否属于本插件的能力面（工具 or 官方 skill 通道）。 */
export function isAnicInvocation(name: string, rawArguments: string): boolean {
  if (name.startsWith('anic_')) return true;
  // 官方 skill 工具的参数是 {"name":"ai-native-iteration-cycle",...}；
  // 原始串是模型产出的未解析 JSON，直接子串匹配（解析失败不丢事件）。
  if (name === 'skill' && rawArguments.includes('ai-native-iteration-cycle')) return true;
  return false;
}

/** 截断原始参数串：保留头部 200 字符 + 省略标记。 */
export function previewOf(raw: string): string {
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

const ORPHAN_AFTER_MS = 15 * 60 * 1000;

/** 环回缓冲（纯数据结构，便于单测；宿主接线见 attachInvocationFeed）。 */
export interface InvocationFeed {
  recordCall(input: { callId: string; name: string; arguments: string; turn?: number; step?: number }): void;
  /** 结束一次调用；返回是否真实结算（命中 in-flight 记录）——诊断计数用。 */
  recordResult(callId: string, result: { isError: boolean; error?: { name: string; code: string; reason?: string } }): boolean;
  snapshot(now?: number): InvocationFeedSnapshot;
  /** 事件通道诊断（由 attachInvocationFeed 注入；未接线时不存在）。 */
  diagnostics?(): FeedDiagnostics;
}

/** 创建环回缓冲。limit 默认 50。 */
export function createInvocationFeed(limit = 50): InvocationFeed {
  const records: InvocationRecord[] = [];
  const byCallId = new Map<string, InvocationRecord>();

  function evict(): void {
    while (records.length > limit) {
      const oldest = records.shift();
      if (oldest) byCallId.delete(oldest.callId);
    }
  }

  return {
    recordCall(input) {
      // 同 callId 重复到达（重放/补偿）时保持首见 startedAt，不覆盖已结束态。
      if (byCallId.has(input.callId)) return;
      const rec: InvocationRecord = {
        callId: input.callId,
        name: input.name,
        argumentsPreview: previewOf(input.arguments),
        turn: input.turn,
        step: input.step,
        startedAt: Date.now(),
        status: 'in-flight',
      };
      records.push(rec);
      byCallId.set(input.callId, rec);
      evict();
    },
    recordResult(callId, result) {
      const rec = byCallId.get(callId);
      // 结束先于开始到达（订阅晚挂/跨进程重启）：不伪造开始，直接跳过。
      if (!rec) return false;
      if (rec.status !== 'in-flight') return false;
      rec.endedAt = Date.now();
      rec.durationMs = rec.endedAt - rec.startedAt;
      rec.status = result.isError ? 'error' : 'done';
      if (result.isError && result.error) rec.error = result.error;
      return true;
    },
    snapshot(now = Date.now()) {
      // 快照必须无副作用：possiblyOrphaned 只写在**副本**上。写在内部记录上
      // 会让第一次超时快照永久污染后续早于阈值的快照（单测抓出的真实缺陷）。
      const invocations = [...records].reverse().map((r) => {
        const copy: InvocationRecord = { ...r };
        if (copy.status === 'in-flight' && now - copy.startedAt > ORPHAN_AFTER_MS) copy.possiblyOrphaned = true;
        return copy;
      });
      return { invocations, total: invocations.length, generatedAt: new Date(now).toISOString() };
    },
  };
}

/** 最小宿主事件类型（宿主 ctx 为 unknown 的房屋风格：本地窄化，不引宿主包）。 */
interface EventCapableCtx {
  on?: (name: string, handler: (...args: never[]) => void) => unknown;
}

/**
 * 订阅宿主双事件通道，把本插件的调用写进 feed。
 *
 * ctx.on 注册的监听器随插件卸载自动移除（官方 events.md「事件监听器也是效果」），
 * 因此无需手动退订。宿主没有 on（stub/旧代）时静默跳过——feed 仍可由测试直接喂。
 */
export function attachInvocationFeed(ctx: unknown, feed: InvocationFeed): InvocationFeed {
  const c = ctx as EventCapableCtx;
  if (typeof c.on !== 'function') { log.info('宿主无事件通道，实时调用流未挂载（feed 保留可查询）'); return feed; }

  // 诊断计数：两个通道各自"看到任何事件"的证据。feed 空时由路由一并返回，
  // 用于区分「事件没到」（计数 0）与「到了但被过滤」（计数 > 0）。
  const diag: FeedDiagnostics = { sessionEvents: 0, sessionToolCalls: 0, toolsResults: 0, anicCalls: 0, anicResults: 0 };
  feed.diagnostics = () => ({ ...diag });

  // 开始相位：持久化会话事件 tool/call（模型请求瞬间）。
  // 事件信封（dsh-session Session.append，lib/index.js:1453-1459）：
  //   { type, seq, time, data: { turn, step, callId, name, arguments } }
  // —— 载荷在 event.data 里，不在顶层（P0-FEED-ENVELOPE：曾直接读 event.callId
  //   恒 undefined，事件到达但全被过滤，诊断计数 sessionToolCalls>0 / anicCalls=0）。
  // callId 用 falsy 检查：空串 callId 永远配不上真实 tools/result，进了流只会
  // 制造"永远执行中"的假条目。
  c.on('session/event', ((session: unknown, event: { type?: string; data?: { callId?: string; name?: string; arguments?: string; turn?: number; step?: number } }) => {
    diag.sessionEvents++;
    if (!event || event.type !== 'tool/call') return;
    diag.sessionToolCalls++;
    const payload = event.data ?? {};
    if (!payload.callId || typeof payload.name !== 'string') return;
    const raw = typeof payload.arguments === 'string' ? payload.arguments : '';
    if (!isAnicInvocation(payload.name, raw)) return;
    diag.anicCalls++;
    feed.recordCall({ callId: payload.callId, name: payload.name, arguments: raw, turn: payload.turn, step: payload.step });
  }) as (...args: never[]) => void);

  // 结束相位：工具运行时冻结结果（exec.callId 配对）。
  c.on('tools/result', ((exec: { callId?: string; name?: string }, result: { isError?: boolean; error?: { name: string; code: string; reason?: string } }) => {
    diag.toolsResults++;
    if (!exec || !exec.callId) return;
    // tools/result 覆盖全部工具执行（含嵌套分发）；recordResult 按 callId 命中，
    // 未命中（非本插件调用）自然跳过——不需要在结束相位重复过滤 name。
    const settled = feed.recordResult(exec.callId, {
      isError: result?.isError === true,
      error: result?.isError === true && result.error ? result.error : undefined,
    });
    if (settled) diag.anicResults++;
  }) as (...args: never[]) => void);

  return feed;
}
