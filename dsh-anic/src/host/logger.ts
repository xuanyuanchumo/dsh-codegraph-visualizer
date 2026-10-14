/**
 * ANIC 日志域（docs/anic/11 §L 的 M1 落地切片）—— host 侧。
 *
 * - scoped logger：`createScoped('anic:route')` → 每行前缀 `[dsh-anic][anic:route]`；
 *   M1 走 console（宿主面允许；M2 按调用点探测换接宿主日志服务 —— 07 B11，
 *   绝不硬 inject）。console 引用集中在本文件，调用方只拿 Logger 接口。
 * - requestId 贯穿：HTTP 层生成/接收 `X-ANIC-Request-Id`，日志方法可选携带，
 *   诊断面板按 requestId 关联（11 §L-2）。
 * - 错误码工厂在 `shared/errors.ts`（client 也要用，shared 单实现）。
 * - INV-26（诊断域隔离）：本模块只写日志流，**绝不写 `.cycles/`** ——
 *   该不变量由 tests/contract 常驻守卫（G-IND 家族）与 self-check 探针共同约束。
 */

export const ANIC_LOG_PREFIX = '[dsh-anic]';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, requestId?: string): void;
  info(message: string, requestId?: string): void;
  warn(message: string, requestId?: string): void;
  error(message: string | Error, requestId?: string): void;
}

export interface LoggerSink {
  (level: LogLevel, line: string): void;
}

/** 默认 sink：console（M1）。替换点即 M2 换接宿主日志服务的唯一缝。 */
export const consoleSink: LoggerSink = (level, line) => {
  if (level === 'debug') return; // M1 默认不放行 debug（宿主控制台噪音治理）
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

let activeSink: LoggerSink = consoleSink;

/** 测试与未来宿主日志服务注入的唯一替换点（不暴露给业务代码随意换） */
export function setLoggerSink(sink: LoggerSink): void {
  activeSink = sink;
}

export function createScoped(scope: string): Logger {
  const prefix = `${ANIC_LOG_PREFIX}[${scope}]`;
  const emit = (level: LogLevel, message: string | Error, requestId?: string): void => {
    const rid = requestId !== undefined ? ` [${requestId}]` : '';
    if (typeof message === 'object' && 'code' in message && typeof (message as { code: unknown }).code === 'string') {
      activeSink(level, `${prefix}[${(message as { code: string }).code}]${rid} ${message.message}`);
      return;
    }
    if (message instanceof Error) {
      activeSink(level, `${prefix}[UNCLASSIFIED]${rid} ${message.message}`);
      return;
    }
    activeSink(level, `${prefix}${rid} ${message}`);
  };
  return {
    debug: (m, rid) => emit('debug', m, rid),
    info: (m, rid) => emit('info', m, rid),
    warn: (m, rid) => emit('warn', m, rid),
    error: (m, rid) => emit('error', m, rid),
  };
}

/** 请求 id 生成（路由层用；既尊重宿主传入的 X-ANIC-Request-Id，也自产短 id） */
export function newRequestId(): string {
  const raw = globalThis.crypto;
  if (raw && typeof raw.randomUUID === 'function') return raw.randomUUID().slice(0, 8);
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
