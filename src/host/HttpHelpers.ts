import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from '../types/index.ts';
import type { SecurityManager } from './security.ts';
import { scoped } from '../shared/Logger.ts';

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
        reject(new Error('Request body too large'));
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
    throw new Error('Invalid JSON body: expected object');
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

const GIT_REF_PATTERN = /^[a-zA-Z0-9._/-]+$/;

export function isSafeGitRef(ref: string): boolean {
  if (!GIT_REF_PATTERN.test(ref)) return false;
  if (ref.includes('..')) return false;
  return true;
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

export function sendJson(res: ServerResponse, code: number, data: unknown, req: IncomingMessage | undefined, config: CorsConfig): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...buildCorsHeaders(req, config),
  };
  res.writeHead(code, headers);
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, code: number, message: string, req: IncomingMessage | undefined, config: CorsConfig): void {
  sendJson(res, code, { success: false, error: message }, req, config);
}

export function requireMethod(req: IncomingMessage, res: ServerResponse, method: string, config: CorsConfig): boolean {
  if (req.method === method) return true;
  sendError(res, 405, `Method ${req.method} not allowed; expected ${method}`, req, config);
  return false;
}

export function checkRate(req: IncomingMessage, res: ServerResponse, routePath: string, rateLimiter: ReturnType<typeof import('./RateLimiter.ts')['createRateLimiter']>, config: CorsConfig): boolean {
  if (!rateLimiter.check(getClientIp(req), routePath)) {
    sendError(res, 429, 'Rate limit exceeded', req, config);
    return false;
  }
  return true;
}

export function logRequest(req: IncomingMessage, routePath: string): void {
  log.info('request', { method: req.method, path: routePath, ip: getClientIp(req) });
}