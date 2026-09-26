// Unit tests for the structured Logger (error/log management, J13 no-leak)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, scoped, resetLoggerListeners } from '../../src/shared/Logger.ts';

describe('Logger (log management)', () => {
  beforeEach(() => {
    logger.clear();
    logger.minLevel = 'info';
  });

  it('should record entries at the given level/scope', () => {
    logger.info('host', 'hello', { a: 1 });
    const entries = logger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'info', scope: 'host', message: 'hello' });
  });

  it('should respect minLevel: debug hidden at info level', () => {
    logger.minLevel = 'info';
    logger.debug('host', 'should-not-appear');
    expect(logger.entries()).toHaveLength(0);
    logger.minLevel = 'debug';
    logger.debug('host', 'appears');
    expect(logger.entries()).toHaveLength(1);
  });

  it('should cap the ring buffer at 200 entries', () => {
    for (let i = 0; i < 250; i++) logger.info('host', `m${i}`);
    expect(logger.entries().length).toBeLessThanOrEqual(200);
    // Most recent entry survives.
    expect(logger.entries().at(-1)?.message).toBe('m249');
  });

  it('should notify subscribers with a snapshot', () => {
    const sub = vi.fn();
    const dispose = logger.subscribe(sub);
    logger.info('host', 'ping');
    expect(sub).toHaveBeenCalledTimes(2); // initial + one event
    dispose();
    logger.info('host', 'after-dispose');
    expect(sub).toHaveBeenCalledTimes(2);
  });

  it('clear() should empty the buffer and notify', () => {
    const sub = vi.fn();
    logger.subscribe(sub);
    logger.info('host', 'x');
    logger.clear();
    expect(logger.entries()).toHaveLength(0);
    expect(sub.mock.calls.at(-1)![0]).toHaveLength(0);
  });

  it('should not throw when console is missing', () => {
    logger.minLevel = 'info';
    expect(logger.warn('host', 'warn-message')).toBeUndefined();
    expect(logger.error('host', 'err-message')).toBeUndefined();
  });
});

describe('scoped logger factory', () => {
  beforeEach(() => {
    logger.clear();
    logger.minLevel = 'debug';
  });

  it('should create a scoped logger with all levels', () => {
    const log = scoped('test');
    log.debug('dbg-msg');
    log.info('info-msg');
    log.warn('warn-msg');
    log.error('err-msg');
    const entries = logger.entries();
    expect(entries).toHaveLength(4);
    expect(entries[0]?.scope).toBe('test');
    expect(entries[0]?.message).toBe('dbg-msg');
    expect(entries[1]?.message).toBe('info-msg');
    expect(entries[2]?.message).toBe('warn-msg');
    expect(entries[3]?.message).toBe('err-msg');
  });

  it('should pass data through scoped logger', () => {
    const log = scoped('data-test');
    log.info('with-data', { key: 'value' });
    const entries = logger.entries();
    expect(entries[0]?.data).toEqual({ key: 'value' });
  });
});
describe('resetLoggerListeners', () => {
  beforeEach(() => {
    logger.clear();
    logger.minLevel = 'info';
  });

  it('should remove all listeners', () => {
    const sub1 = vi.fn();
    const sub2 = vi.fn();
    logger.subscribe(sub1);
    logger.subscribe(sub2);
    expect(sub1).toHaveBeenCalledTimes(1); // initial call
    expect(sub2).toHaveBeenCalledTimes(1);

    resetLoggerListeners();

    logger.info('host', 'after-reset');
    // No listeners should be called after reset
    expect(sub1).toHaveBeenCalledTimes(1);
    expect(sub2).toHaveBeenCalledTimes(1);
  });

  it('should allow subscribing again after reset', () => {
    const sub1 = vi.fn();
    logger.subscribe(sub1);
    resetLoggerListeners();

    const sub2 = vi.fn();
    const dispose = logger.subscribe(sub2);
    expect(sub2).toHaveBeenCalledTimes(1); // initial call

    logger.info('host', 'new-message');
    expect(sub2).toHaveBeenCalledTimes(2);

    dispose();
  });
});

describe('Logger clearListeners', () => {
  beforeEach(() => {
    logger.clear();
    logger.minLevel = 'info';
  });

  it('should stop all subscriber notifications after clearListeners', () => {
    const sub = vi.fn();
    logger.subscribe(sub);
    logger.info('host', 'before-clear');
    expect(sub).toHaveBeenCalled();

    logger.clearListeners();
    logger.info('host', 'after-clear');
    // sub should not receive the after-clear event
    const callsBeforeClear = sub.mock.calls.length;
    logger.info('host', 'another-after');
    expect(sub.mock.calls.length).toBe(callsBeforeClear);
  });
});
describe('Logger __CG_DEBUG initialization', () => {
  it('should initialize minLevel to debug when __CG_DEBUG is true', async () => {
    // Save original state
    const origDebug = (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG;
    (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG = true;

    // Dynamic import to get a fresh module evaluation
    vi.resetModules();
    const mod = await import('../../src/shared/Logger.ts');
    const freshLogger = mod.logger;

    expect(freshLogger.minLevel).toBe('debug');

    // Restore
    (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG = origDebug;
    vi.resetModules();
  });

  it('should initialize minLevel to info when __CG_DEBUG is not set', async () => {
    const origDebug = (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG;
    delete (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG;

    vi.resetModules();
    const mod = await import('../../src/shared/Logger.ts');
    const freshLogger = mod.logger;

    expect(freshLogger.minLevel).toBe('info');

    // Restore
    (globalThis as unknown as { __CG_DEBUG?: boolean }).__CG_DEBUG = origDebug;
    vi.resetModules();
  });
});

describe('Logger error handling', () => {
  beforeEach(() => {
    logger.clear();
    logger.clearListeners();
    logger.minLevel = 'info';
  });

  it('should not throw when console.log throws', () => {
    const originalLog = console.log;
    console.log = vi.fn(() => { throw new Error('console broken'); });
    expect(() => logger.info('host', 'msg')).not.toThrow();
    console.log = originalLog;
  });

  it('should not throw when console.error throws', () => {
    const originalError = console.error;
    console.error = vi.fn(() => { throw new Error('console broken'); });
    expect(() => logger.error('host', 'err')).not.toThrow();
    console.error = originalError;
  });

  it('should not throw when console.warn throws', () => {
    const originalWarn = console.warn;
    console.warn = vi.fn(() => { throw new Error('console broken'); });
    expect(() => logger.warn('host', 'warn')).not.toThrow();
    console.warn = originalWarn;
  });

  it('should not throw when a listener throws during emit', () => {
    let callCount = 0;
    const badListener = vi.fn(() => {
      callCount++;
      if (callCount > 1) throw new Error('listener fault');
    });
    const goodListener = vi.fn();
    logger.subscribe(badListener);
    logger.subscribe(goodListener);
    // badListener's initial call (callCount=1) does not throw;
    // subsequent emit calls (callCount>1) throw but should be caught
    expect(() => logger.info('host', 'msg')).not.toThrow();
    expect(goodListener).toHaveBeenCalled();
  });
});