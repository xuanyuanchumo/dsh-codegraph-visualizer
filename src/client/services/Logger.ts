// Lightweight structured logger with an in-memory ring buffer for UI surfacing.
// Ponytail: no deps, ~60 lines. Levels respect host console when available.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RING_SIZE = 200;

class LoggerImpl {
  private buffer: LogEntry[] = [];
  private listeners = new Set<(entries: LogEntry[]) => void>();
  minLevel: LogLevel = (typeof globalThis !== 'undefined' &&
    (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG) ? 'debug' : 'info';

  log(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry: LogEntry = { ts: Date.now(), level, scope, message, data };
    this.buffer.push(entry);
    if (this.buffer.length > RING_SIZE) this.buffer.splice(0, this.buffer.length - RING_SIZE);
    this.emit();
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    try { fn(`[codegraph:${scope}] ${message}`, data ?? ''); } catch { /* console unavailable */ }
  }

  debug(scope: string, message: string, data?: unknown): void { this.log('debug', scope, message, data); }
  info(scope: string, message: string, data?: unknown): void { this.log('info', scope, message, data); }
  warn(scope: string, message: string, data?: unknown): void { this.log('warn', scope, message, data); }
  error(scope: string, message: string, data?: unknown): void { this.log('error', scope, message, data); }

  entries(): LogEntry[] { return this.buffer.slice(); }
  clear(): void { this.buffer = []; this.emit(); }

  subscribe(fn: (entries: LogEntry[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.entries());
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    const snapshot = this.entries();
    for (const fn of this.listeners) { try { fn(snapshot); } catch { /* listener fault */ } }
  }
}

export const logger = new LoggerImpl();

// Convenience scoped logger factory.
export function scoped(scope: string) {
  return {
    debug: (m: string, d?: unknown) => logger.debug(scope, m, d),
    info: (m: string, d?: unknown) => logger.info(scope, m, d),
    warn: (m: string, d?: unknown) => logger.warn(scope, m, d),
    error: (m: string, d?: unknown) => logger.error(scope, m, d),
  };
}