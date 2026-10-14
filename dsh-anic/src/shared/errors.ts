/**
 * ANIC 错误分类学（docs/anic/11 §L-1）—— client / host 共用（shared 单实现）。
 *
 * 四域闭合错误码：`ANIC_ROUTE_* / ANIC_FETCH_* / ANIC_RENDER_* / ANIC_CONFIG_*`。
 * 未知域编译期拒绝（ERROR_DOMAINS as const）。诊断面板按 code 分域着色（11 §L-3）。
 */

export const ERROR_DOMAINS = ['ROUTE', 'FETCH', 'RENDER', 'CONFIG'] as const;
export type ErrorDomain = (typeof ERROR_DOMAINS)[number];

export interface AnicError extends Error {
  code: string;
  requestId?: string;
}

/** 错误码工厂：`anicError('ROUTE', 'SNAPSHOT_NOT_FOUND', 'msg')` → code `ANIC_ROUTE_SNAPSHOT_NOT_FOUND` */
export function anicError(domain: ErrorDomain, detail: string, message: string, requestId?: string): AnicError {
  const code = `ANIC_${domain}_${detail}`;
  const err = new Error(`[${code}] ${message}`) as AnicError;
  err.code = code;
  if (requestId !== undefined) err.requestId = requestId;
  return err;
}

export function isAnicError(value: unknown): value is AnicError {
  return value instanceof Error && typeof (value as AnicError).code === 'string' && (value as AnicError).code.startsWith('ANIC_');
}
