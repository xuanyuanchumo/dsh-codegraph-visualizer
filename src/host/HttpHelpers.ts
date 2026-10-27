import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from '../types/index.ts';
import type { SecurityManager } from './security.ts';
import { scoped } from '../shared/Logger.ts';
import { ERROR_MESSAGES, ERROR_CODES } from '../shared/constants.ts';

const log = scoped('host');

export function getClientIp(req: IncomingMessage): string {
  const socketAddr = req.socket?.remoteAddress;
  return socketAddr ?? 'unknown';
}

export function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    req.on('data', (chunk?: Buffer) => {
      if (!chunk) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        req.destroy();
        reject(new Error(ERROR_CODES.BODY_TOO_LARGE));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function parseJsonBody(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body || '{}');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(ERROR_CODES.INVALID_JSON_BODY);
  }
  return parsed as Record<string, unknown>;
}

export function extractStringField(obj: Record<string, unknown>, field: string, maxLength?: number): string | undefined {
  const v = obj[field];
  if (typeof v !== 'string') return undefined;
  if (v.includes('\0')) return undefined;
  if (maxLength !== undefined && v.length > maxLength) return undefined;
  return v;
}

export function extractBooleanField(obj: Record<string, unknown>, field: string): boolean | undefined {
  const v = obj[field];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * 合法的 **git revision 表达式**字符集（P0-C，cycle-105 真机发现）。
 *
 * 历史：这里原本是 `/^(?!.*\.\.)[a-zA-Z0-9._/-]+$/`，即「合法分支名」的字符集。但调用方
 * （`POST /diff` 的 `from`/`to`）要的是 **revision 表达式**，不是分支名——两者是不同的语法：
 *
 * - 分支名只允许 `[A-Za-z0-9._/-]`；
 * - revision 还必须允许 `~`（`HEAD~3`）、`^`（`HEAD^`、`HEAD^2`）、`@{...}`（`HEAD@{1}`、
 *   `main@{upstream}`）以及 `@`（`@` 是 `HEAD` 的别名）。
 *
 * 真机实测：面板默认值 `HEAD~1` → `HEAD` 被 **100% 拒绝**（`400 INVALID_GIT_REF`），
 * 也就是说 cycle-104 交付的「版本对比」在真机上的可用性为零——用户必须先手输完整 SHA。
 * 这不是参数校验过严的「小问题」，而是把默认路径整条打死：默认值永远失败，功能等于没有。
 *
 * 安全性仍必须守住，因此保留三条硬性拒绝：
 *
 * 1. **禁止以 `-` 开头**。否则 `--upload-pack=...` 这类参数会被 git 当成选项解析
 *    （参数注入）。这条是新增的：旧正则本身就排除了 `-` 开头的字符串，重写时不能丢掉。
 * 2. **禁止 `..`**（`a..b` 是范围语法，不是单个 revision，混进来会让 diff 语义变成
 *    「三个点/两个点」的范围而不是「两个端点」）。
 * 3. **禁止空白、`\`、`:`、`?`、`*`、`[`、控制字符**——它们是 git 的 pathspec/通配符语法，
 *    也可能被 shell 或 Windows 路径解析改写。
 *
 * 注意 `@{` 必须成对出现由 git 自己校验；这里只保证字符集安全，不试图重写 git 的语法。
 */
const GIT_REF_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/~^@{}+-]+$/;

/**
 * 判断一个字符串是否可以安全地作为 **git revision 表达式**传给子进程。
 *
 * 只做「字符集 + 结构」的白名单校验，**不做**「这个 revision 是否存在」的判断——
 * 后者只有 git 自己知道，且必须由调用方在真实仓库里问（见 `src/host/gitDiff.ts` 的
 * `collectGitFileDiff`，它把 git 的失败原样变成 `available: false` + `error`）。
 * 把存在性也塞进校验函数，会让一个纯函数变成需要仓库上下文的函数。
 */
export function isSafeGitRef(ref: string): boolean {
  if (typeof ref !== 'string') return false;
  // 长度上限由调用方（`extractStringField`）保证；这里再兜一次，避免有人直接调用。
  if (ref.length === 0 || ref.length > 256) return false;
  // `@{` 未闭合会让 git 报出难以理解的错误，提前拒绝给出明确的 400。
  const openBraces = (ref.match(/\{/g) ?? []).length;
  const closeBraces = (ref.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) return false;
  // `@` 后紧跟 `{` 才合法（`@{...}`）；裸 `{` 不是 git 语法。
  if (ref.includes('{') && !ref.includes('@{')) return false;
  return GIT_REF_PATTERN.test(ref);
}

export async function validatePathRealpath(scanPath: string, securityManager: SecurityManager): Promise<boolean> {
  try {
    const realPath = await fs.realpath(scanPath);
    return securityManager.isPathAllowed(realPath);
  } catch (e) {
    log.warn('validatePathRealpath failed', e);
    return false;
  }
}

export interface CorsConfig {
  origins: string[];
}

export function buildCorsHeaders(req: IncomingMessage | undefined, config: CorsConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, if-none-match',
    // 跨源（桌面端 / dsh-remote-web-ui）时，`etag` 与 `x-truncated` 默认不暴露给 JS：`fetch()` 的
    // `res.headers.get('etag')` 会返回 null，客户端于是永远拿不到校验值，"增量取数"静默退化成
    // 每次都全量重取。这两个头必须显式列入 expose 名单。
    'access-control-expose-headers': 'etag, x-truncated',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
  if (config.origins.length > 0) {
    const reqOrigin = req?.headers?.['origin'];
    if (typeof reqOrigin === 'string' && config.origins.includes(reqOrigin)) {
      headers['access-control-allow-origin'] = reqOrigin;
    }
  }
  return headers;
}

export function handleCorsPreflight(req: IncomingMessage, res: ServerResponse, config: CorsConfig): boolean {
  if (req.method !== 'OPTIONS') return false;
  const headers = buildCorsHeaders(req, config);
  res.writeHead(204, headers);
  res.end();
  return true;
}

/**
 * 回 200 时可选附加响应头。`etag` 必须走这里而不是由调用方自行 `writeHead`：
 * `sendJson` 是唯一同时写 `content-type` 与 CORS 头的地方，绕过它就会漏掉 CORS，
 * 跨源客户端（桌面端 / dsh-remote-web-ui）读不到响应头。
 */
export type ExtraResponseHeaders = Record<string, string>;

export function sendJson(
  res: ServerResponse,
  code: number,
  data: unknown,
  req: IncomingMessage | undefined,
  config: CorsConfig,
  extraHeaders?: ExtraResponseHeaders,
): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...buildCorsHeaders(req, config),
    ...extraHeaders,
  };
  res.writeHead(code, headers);
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, httpCode: number, errorCode: string, req: IncomingMessage | undefined, config: CorsConfig, detail?: string): void {
  const baseMessage = ERROR_MESSAGES[errorCode]?.en ?? errorCode;
  const message = detail ? `${baseMessage}: ${detail}` : baseMessage;
  sendJson(res, httpCode, { success: false, error: errorCode, message }, req, config);
}

export function requireMethod(req: IncomingMessage, res: ServerResponse, method: string, config: CorsConfig): boolean {
  if (req.method === method) return true;
  sendError(res, 405, 'METHOD_NOT_ALLOWED', req, config, `${req.method} not allowed; expected ${method}`);
  return false;
}

export function checkRate(req: IncomingMessage, res: ServerResponse, routePath: string, rateLimiter: ReturnType<typeof import('./RateLimiter.ts')['createRateLimiter']>, config: CorsConfig): boolean {
  if (!rateLimiter.check(getClientIp(req), routePath)) {
    sendError(res, 429, 'RATE_LIMIT_EXCEEDED', req, config);
    return false;
  }
  return true;
}

export function logRequest(req: IncomingMessage, routePath: string): void {
  log.info('request', { method: req.method, path: routePath, ip: getClientIp(req) });
}