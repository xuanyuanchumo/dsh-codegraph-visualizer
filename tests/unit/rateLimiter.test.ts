import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRateLimiter } from '../../src/host/RateLimiter.ts';

describe('createRateLimiter', () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    limiter = createRateLimiter();
  });

  describe('check', () => {
    it('should allow first request', () => {
      expect(limiter.check('127.0.0.1', '/api/v1/codegraph/status')).toBe(true);
    });

    it('should allow multiple requests within default limit', () => {
      const ip = '127.0.0.1';
      const route = '/api/v1/codegraph/status';
      for (let i = 0; i < 60; i++) {
        expect(limiter.check(ip, route)).toBe(true);
      }
    });

    it('should block requests exceeding default limit (60)', () => {
      const ip = '127.0.0.1';
      const route = '/api/v1/codegraph/status';
      for (let i = 0; i < 60; i++) {
        limiter.check(ip, route);
      }
      expect(limiter.check(ip, route)).toBe(false);
    });

    it('should block requests exceeding heavy endpoint limit (10)', () => {
      const ip = '127.0.0.1';
      const route = '/api/v1/codegraph/scan';
      for (let i = 0; i < 10; i++) {
        limiter.check(ip, route);
      }
      expect(limiter.check(ip, route)).toBe(false);
    });

    it('should track different IPs independently', () => {
      expect(limiter.check('127.0.0.1', '/api/v1/codegraph/status')).toBe(true);
      expect(limiter.check('192.168.1.1', '/api/v1/codegraph/status')).toBe(true);
    });

    it('should track different routes independently for same IP', () => {
      const ip = '127.0.0.1';
      expect(limiter.check(ip, '/api/v1/codegraph/status')).toBe(true);
      expect(limiter.check(ip, '/api/v1/codegraph/scan')).toBe(true);
    });

    it('should reset bucket after window expires', () => {
      const ip = '127.0.0.1';
      const route = '/api/v1/codegraph/scan';
      for (let i = 0; i < 10; i++) {
        limiter.check(ip, route);
      }
      expect(limiter.check(ip, route)).toBe(false);
      vi.useFakeTimers();
      vi.advanceTimersByTime(61000);
      expect(limiter.check(ip, route)).toBe(true);
      vi.useRealTimers();
    });

    it('should treat heavy endpoints with lower limit than default', () => {
      const ip = '127.0.0.1';
      const heavyRoute = '/api/v1/codegraph/scan';
      const normalRoute = '/api/v1/codegraph/status';
      for (let i = 0; i < 10; i++) {
        limiter.check(ip, heavyRoute);
      }
      expect(limiter.check(ip, heavyRoute)).toBe(false);
      expect(limiter.check(ip, normalRoute)).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all rate limit buckets', () => {
      const ip = '127.0.0.1';
      const route = '/api/v1/codegraph/scan';
      for (let i = 0; i < 10; i++) {
        limiter.check(ip, route);
      }
      expect(limiter.check(ip, route)).toBe(false);
      limiter.reset();
      expect(limiter.check(ip, route)).toBe(true);
    });
  });

  describe('MAP_MAX eviction', () => {
    it('should evict oldest entry when map exceeds max size', () => {
      const MAP_MAX = 10000;
      for (let i = 0; i < MAP_MAX + 5; i++) {
        limiter.check(`10.0.0.${i}`, '/api/v1/codegraph/status');
      }
      expect(limiter.check('10.0.0.0', '/api/v1/codegraph/status')).toBe(true);
    });
  });
});
