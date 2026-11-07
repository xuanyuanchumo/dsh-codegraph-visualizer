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

/** 单桶白盒快照（cycle-146 T146-3）：管理面板「限流观测」区的数据面。 */
export interface RateBucketSnapshot {
  /** 桶键（`ip:routePath`）。 */
  key: string;
  /** 窗口内已放行的请求数。 */
  count: number;
  /** 本窗口配额（heavy 端点与常规端点不同）。 */
  limit: number;
  /** 窗口剩余毫秒数（0 = 已过期，等待惰性清理）。 */
  resetInMs: number;
}

/** 限流器白盒快照：additive 字段，只读投影，不影响任何限流行为。 */
export interface RateLimiterSnapshot {
  /** 活跃桶数（窗口未过期的键）。 */
  activeBuckets: number;
  /** 每桶明细（按键排序，输出确定性）。 */
  buckets: RateBucketSnapshot[];
  /** 配置上界（heavy/regular 两档配额与窗口长度），面板渲染「配额」行的数据面。 */
  limits: { heavy: number; regular: number; windowMs: number };
}

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

  /**
   * 白盒快照（cycle-146 T146-3）：活跃桶的只读投影。
   * 只反映**未过期**桶（过期桶在下一次 check/cleanup 时惰性删除，快照不虚报）；
   * resetInMs 按快照时刻计算，输出按键排序保证确定性（面板 diff 友好）。
   */
  function snapshot(): RateLimiterSnapshot {
    const now = Date.now();
    const buckets: RateBucketSnapshot[] = [];
    for (const [key, bucket] of rateLimitMap) {
      if (now > bucket.resetTime) continue; // 过期桶尚未被惰性清理——不虚报
      buckets.push({
        key,
        count: bucket.count,
        limit: HEAVY_ENDPOINTS.has(key.slice(key.indexOf(':') + 1)) ? RATE_LIMIT_HEAVY : RATE_LIMIT_DEFAULT,
        resetInMs: Math.max(0, bucket.resetTime - now),
      });
    }
    buckets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return {
      activeBuckets: buckets.length,
      buckets,
      limits: { heavy: RATE_LIMIT_HEAVY, regular: RATE_LIMIT_DEFAULT, windowMs: RATE_LIMIT_WINDOW_MS },
    };
  }

  return { check, reset, snapshot };
}