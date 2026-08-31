// Unit tests for the structured Logger (error/log management, J13 no-leak)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../../src/shared/Logger.ts';

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
    expect(() => logger.warn('host', 'warn-message')).not.toThrow();
    expect(() => logger.error('host', 'err-message')).not.toThrow();
  });
});