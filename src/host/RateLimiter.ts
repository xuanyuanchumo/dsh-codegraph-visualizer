import { API } from '../shared/constants.ts';

const RATE_LIMIT_WINDOW_MS = API.RATE_LIMIT_WINDOW_MS;
const RATE_LIMIT_DEFAULT = API.RATE_LIMIT_DEFAULT;
const RATE_LIMIT_HEAVY = API.RATE_LIMIT_HEAVY;
const RATE_LIMIT_MAP_MAX = API.RATE_LIMIT_MAP_MAX;
const HEAVY_ENDPOINTS = new Set([
  '/api/v1/codegraph/scan',
  '/api/v1/codegraph/init',
  '/api/v1/codegraph/diff',
  // `/churn` 每次冷调用都会 fork 一个 git 子进程（最大 2000 提交的输出）——按重端点限流，
  // 否则热点面板的重复打开会把子进程数量交给客户端决定。
  '/api/v1/codegraph/churn',
  '/api/v1/codegraph/ast',
  '/api/v1/codegraph/tree-sitter',
]);

interface RateBucket { count: number; resetTime: number; }

export function createRateLimiter() {
  const rateLimitMap = new Map<string, RateBucket>();
  let lastCleanup = Date.now();

  function check(ip: string, routePath: string): boolean {
    const key = `${ip}:${routePath}`;
    const limit = HEAVY_ENDPOINTS.has(routePath) ? RATE_LIMIT_HEAVY : RATE_LIMIT_DEFAULT;
    const now = Date.now();
    if (now - lastCleanup > RATE_LIMIT_WINDOW_MS) {
      for (const [k, b] of rateLimitMap) {
        if (now > b.resetTime) rateLimitMap.delete(k);
      }
      lastCleanup = now;
    }
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      const oldestKey = rateLimitMap.keys().next().value;
      if (oldestKey !== undefined) rateLimitMap.delete(oldestKey);
    }
    const bucket = rateLimitMap.get(key);
    if (!bucket || now > bucket.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }

  function reset(): void {
    rateLimitMap.clear();
    lastCleanup = Date.now();
  }

  return { check, reset };
}