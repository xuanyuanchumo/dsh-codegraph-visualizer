/**
 * 取数基础设施：超时/中止守卫（cycle-110 Q7 行为等价提取，从 `api/index.ts` 抽出）。
 *
 * 抽取契约：
 *   · `withAbortGuard` 是**唯一的失败归一器**：AbortError 静默返回 `fallback`（用户主动取消不是错误），
 *     其它异常记一条 `log.warn` 后同样返回 `fallback`。调用方因此永远拿到 `T`，而不是异常。
 *     这个「失败 ⇒ fallback」的语义是调用方无需 try/catch 的前提，不允许在调用点另写一份。
 *   · `fetchWithTimeout` 把「外部 signal」与「内部超时」合成**一个** AbortController：外部已中止时
 *     立即中止；否则监听一次 `abort`。`finally` 里必须同时 `clearTimeout` 与移除监听，
 *     否则长会话会累积监听器（内存泄漏）。
 *   · 默认超时取 `API.DEFAULT_TIMEOUT_MS`（按需路由的快速失败预算）；长任务用调用点的显式覆盖。
 *
 * 为什么单独成文件：这两个函数是 api 层里唯一与「具体端点」无关的部分，拆开后 `api/index.ts`
 * 只剩端点编排与条件请求机制（band-detector 按文件预算，见同目录 README 的 cycle-110 说明）。
 */
import { scoped } from '../../shared/Logger.ts';
import { API } from '../../shared/constants.ts';

const log = scoped('client');

const DEFAULT_TIMEOUT = API.DEFAULT_TIMEOUT_MS;

export async function withAbortGuard<T>(
  name: string,
  run: () => Promise<T>,
  fallback: T,
  logContext?: Record<string, unknown>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return fallback;
    log.warn(`${name} failed`, { ...logContext, error: e instanceof Error ? e.message : String(e) });
    return fallback;
  }
}

export function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options?.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  });
}
