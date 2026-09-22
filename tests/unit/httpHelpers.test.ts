import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getClientIp,
  parseJsonBody,
  extractStringField,
  extractBooleanField,
  isSafeGitRef,
  buildCorsHeaders,
  handleCorsPreflight,
  requireMethod,
} from '../../src/host/HttpHelpers.ts';
import type { IncomingMessage, ServerResponse } from '../../src/types/index.ts';

function mockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let ended = false;
  let writtenData = '';
  return {
    writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
    }),
    end: vi.fn((data?: string) => {
      ended = true;
      if (data) writtenData = data;
    }),
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get ended() { return ended; },
    get writtenData() { return writtenData; },
  } as unknown as ServerResponse;
}

describe('getClientIp', () => {
  it('should return socket remote address', () => {
    const req = mockReq({ socket: { remoteAddress: '192.168.1.1' } as any });
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('should return "unknown" when socket is undefined', () => {
    const req = mockReq({ socket: undefined as any });
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('parseJsonBody', () => {
  it('should parse valid JSON object', () => {
    expect(parseJsonBody('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('should parse empty body as empty object', () => {
    expect(parseJsonBody('')).toEqual({});
  });

  it('should throw for JSON array', () => {
    expect(() => parseJsonBody('[1,2,3]')).toThrow('expected object');
  });

  it('should throw for JSON null', () => {
    expect(() => parseJsonBody('null')).toThrow('expected object');
  });

  it('should throw for JSON primitive', () => {
    expect(() => parseJsonBody('"hello"')).toThrow('expected object');
  });

  it('should throw for invalid JSON', () => {
    expect(() => parseJsonBody('{invalid')).toThrow();
  });
});

describe('extractStringField', () => {
  it('should return string value', () => {
    expect(extractStringField({ name: 'hello' }, 'name')).toBe('hello');
  });

  it('should return undefined for non-string value', () => {
    expect(extractStringField({ name: 123 }, 'name')).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractStringField({}, 'name')).toBeUndefined();
  });

  it('should return undefined for null byte in string', () => {
    expect(extractStringField({ name: 'hello\0world' }, 'name')).toBeUndefined();
  });

  it('should return undefined when exceeding maxLength', () => {
    expect(extractStringField({ name: 'hello' }, 'name', 3)).toBeUndefined();
  });

  it('should return string when within maxLength', () => {
    expect(extractStringField({ name: 'hello' }, 'name', 10)).toBe('hello');
  });
});

describe('extractBooleanField', () => {
  it('should return boolean value', () => {
    expect(extractBooleanField({ flag: true }, 'flag')).toBe(true);
    expect(extractBooleanField({ flag: false }, 'flag')).toBe(false);
  });

  it('should return undefined for non-boolean value', () => {
    expect(extractBooleanField({ flag: 'true' }, 'flag')).toBeUndefined();
    expect(extractBooleanField({ flag: 1 }, 'flag')).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractBooleanField({}, 'flag')).toBeUndefined();
  });
});

describe('isSafeGitRef', () => {
  it('should accept alphanumeric with dots and slashes', () => {
    expect(isSafeGitRef('main')).toBe(true);
    expect(isSafeGitRef('feature/branch')).toBe(true);
    expect(isSafeGitRef('v1.0.0')).toBe(true);
    expect(isSafeGitRef('release-1.0')).toBe(true);
  });

  it('should reject consecutive dots', () => {
    expect(isSafeGitRef('foo..bar')).toBe(false);
  });

  it('should reject special characters', () => {
    expect(isSafeGitRef('foo;bar')).toBe(false);
    expect(isSafeGitRef('foo$bar')).toBe(false);
    expect(isSafeGitRef('foo bar')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(isSafeGitRef('')).toBe(false);
  });
});

describe('buildCorsHeaders', () => {
  it('should include CORS methods and headers', () => {
    const headers = buildCorsHeaders(undefined, { origins: [] });
    expect(headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    expect(headers['access-control-allow-headers']).toBe('content-type, if-none-match');
    expect(headers['access-control-max-age']).toBe('86400');
    expect(headers['vary']).toBe('Origin');
  });

  it('should set ACAO when origin matches allowed list', () => {
    const req = mockReq({ headers: { origin: 'http://localhost:3080' } });
    const headers = buildCorsHeaders(req, { origins: ['http://localhost:3080'] });
    expect(headers['access-control-allow-origin']).toBe('http://localhost:3080');
  });

  it('should not set ACAO when origin does not match', () => {
    const req = mockReq({ headers: { origin: 'http://evil.com' } });
    const headers = buildCorsHeaders(req, { origins: ['http://localhost:3080'] });
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  it('should not set ACAO when no origins configured', () => {
    const req = mockReq({ headers: { origin: 'http://localhost:3080' } });
    const headers = buildCorsHeaders(req, { origins: [] });
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('handleCorsPreflight', () => {
  it('should handle OPTIONS request and return true', () => {
    const req = mockReq({ method: 'OPTIONS' });
    const res = mockRes();
    const result = handleCorsPreflight(req, res, { origins: [] });
    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(204, expect.any(Object));
    expect(res.end).toHaveBeenCalled();
  });

  it('should return false for non-OPTIONS request', () => {
    const req = mockReq({ method: 'GET' });
    const res = mockRes();
    const result = handleCorsPreflight(req, res, { origins: [] });
    expect(result).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});

describe('requireMethod', () => {
  it('should return true when method matches', () => {
    const req = mockReq({ method: 'POST' });
    const res = mockRes();
    expect(requireMethod(req, res, 'POST', { origins: [] })).toBe(true);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it('should send 405 and return false when method does not match', () => {
    const req = mockReq({ method: 'GET' });
    const res = mockRes();
    expect(requireMethod(req, res, 'POST', { origins: [] })).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
    expect(res.end).toHaveBeenCalled();
  });
});