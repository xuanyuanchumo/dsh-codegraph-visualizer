import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG, type VisualizerConfig } from '../../src/host/config.ts';

describe('resolveConfig', () => {
  it('should return default config when no user config provided', () => {
    const config = resolveConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should override default values with user config', () => {
    const config = resolveConfig({ requestTimeout: 30000, maxNodes: 100000 });
    expect(config.requestTimeout).toBe(30000);
    expect(config.maxNodes).toBe(100000);
    expect(config.dataSource).toBe(DEFAULT_CONFIG.dataSource);
  });

  it('should throw for invalid dataSource', () => {
    expect(() => resolveConfig({ dataSource: 'invalid' as any })).toThrow('dataSource must be');
  });

  it('should accept all valid data sources', () => {
    for (const ds of ['auto', 'codegraph', 'lens', 'tree-sitter', 'dependency'] as const) {
      const config = resolveConfig({ dataSource: ds });
      expect(config.dataSource).toBe(ds);
    }
  });

  it('should throw for invalid origin format', () => {
    expect(() => resolveConfig({ allowedOrigins: ['not-a-url'] })).toThrow('invalid origin');
  });

  it('should throw for origin without protocol', () => {
    expect(() => resolveConfig({ allowedOrigins: ['localhost:3080'] })).toThrow('invalid origin');
  });

  it('should accept valid origins with port', () => {
    const config = resolveConfig({ allowedOrigins: ['http://localhost:3080'] });
    expect(config.allowedOrigins).toEqual(['http://localhost:3080']);
  });

  it('should accept valid origins with https', () => {
    const config = resolveConfig({ allowedOrigins: ['https://example.com'] });
    expect(config.allowedOrigins).toEqual(['https://example.com']);
  });

  it('should throw for non-positive requestTimeout', () => {
    expect(() => resolveConfig({ requestTimeout: 0 })).toThrow('positive finite number');
    expect(() => resolveConfig({ requestTimeout: -1 })).toThrow('positive finite number');
  });

  it('should throw for non-positive maxNodes', () => {
    expect(() => resolveConfig({ maxNodes: 0 })).toThrow('positive finite number');
  });

  it('should throw for non-positive panelMinHeight', () => {
    expect(() => resolveConfig({ panelMinHeight: 0 })).toThrow('positive finite number');
  });

  it('should throw for NaN values', () => {
    expect(() => resolveConfig({ requestTimeout: NaN })).toThrow('positive finite number');
  });

  it('should throw for Infinity values', () => {
    expect(() => resolveConfig({ maxNodes: Infinity })).toThrow('positive finite number');
  });

  it('should throw when panelDefaultHeight < panelMinHeight', () => {
    expect(() => resolveConfig({ panelMinHeight: 500, panelDefaultHeight: 300 })).toThrow(
      'panelDefaultHeight (300) must be >= panelMinHeight (500)',
    );
  });

  it('should accept panelDefaultHeight equal to panelMinHeight', () => {
    const config = resolveConfig({ panelMinHeight: 400, panelDefaultHeight: 400 });
    expect(config.panelMinHeight).toBe(400);
    expect(config.panelDefaultHeight).toBe(400);
  });

  it('should throw with multiple errors joined by semicolons', () => {
    expect(() => resolveConfig({ dataSource: 'invalid' as any, requestTimeout: -1 })).toThrow(
      'dataSource must be',
    );
    const error = (() => {
      try { resolveConfig({ dataSource: 'invalid' as any, requestTimeout: -1 }); }
      catch (e) { return (e as Error).message; }
    })();
    expect(error).toContain('dataSource must be');
    expect(error).toContain('requestTimeout must be');
  });
});