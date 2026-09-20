// Unit tests for LensAdapter
import { describe, it, expect, beforeEach } from 'vitest';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';
import type { UpstreamInvoker } from '../../src/adapters/CodeGraphAdapter.ts';

describe('LensAdapter', () => {
  let adapter: LensAdapter;

  beforeEach(() => {
    adapter = new LensAdapter();
  });

  it('should have a source property', () => {
    expect((adapter as unknown as { source: string }).source).toBe('lens');
  });

  it('should return empty result on upstream failure', async () => {
    const failingInvoke: UpstreamInvoker = async () => {
      throw new Error('upstream failure');
    };
    const result = await adapter.fetchData('test-repo', failingInvoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should parse lens_analyze result with symbols and references', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 's1', name: 'funcA', scope: 'global', file: 'a.ts', line: 10, category: 'function' },
            { id: 's2', name: 'ClassB', scope: 'module', file: 'b.ts', line: 5, category: 'class' },
          ],
          references: [
            { from: 's1', to: 's2', relation: 'call' },
          ],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.label).toBe('funcA');
    expect(result.nodes[0]?.type).toBe('function');
    expect(result.nodes[1]?.label).toBe('ClassB');
    expect(result.nodes[1]?.type).toBe('class');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.type).toBe('call');
  });

  it('should map unknown category to module', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [{ id: 's1', name: 'x', scope: 'g', file: 'a.ts', line: 1, category: 'unknown_cat' }],
          references: [],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes[0]?.type).toBe('module');
  });

  it('should map unknown relation to dependency', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 's1', name: 'a', scope: 'g', file: 'a.ts', line: 1, category: 'function' },
            { id: 's2', name: 'b', scope: 'g', file: 'b.ts', line: 1, category: 'function' },
          ],
          references: [{ from: 's1', to: 's2', relation: 'weird_relation' }],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.edges[0]?.type).toBe('dependency');
  });

  it('should handle lens_analyze returning null', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should map all known categories correctly', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: '1', name: 'fn', scope: 'g', file: 'a', line: 1, category: 'function' },
            { id: '2', name: 'cls', scope: 'g', file: 'a', line: 1, category: 'class' },
            { id: '3', name: 'v', scope: 'g', file: 'a', line: 1, category: 'variable' },
            { id: '4', name: 'm', scope: 'g', file: 'a', line: 1, category: 'module' },
            { id: '5', name: 'i', scope: 'g', file: 'a', line: 1, category: 'interface' },
            { id: '6', name: 't', scope: 'g', file: 'a', line: 1, category: 'type' },
          ],
          references: [],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(6);
    expect(result.nodes[0]?.type).toBe('function');
    expect(result.nodes[1]?.type).toBe('class');
    expect(result.nodes[2]?.type).toBe('variable');
    expect(result.nodes[3]?.type).toBe('module');
    expect(result.nodes[4]?.type).toBe('interface');
    expect(result.nodes[5]?.type).toBe('type');
  });

  it('should map all known relations correctly', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 'a', name: 'a', scope: 'g', file: 'a', line: 1, category: 'function' },
            { id: 'b', name: 'b', scope: 'g', file: 'b', line: 1, category: 'function' },
          ],
          references: [
            { from: 'a', to: 'b', relation: 'call' },
            { from: 'a', to: 'b', relation: 'reference' },
            { from: 'a', to: 'b', relation: 'import' },
            { from: 'a', to: 'b', relation: 'extend' },
            { from: 'a', to: 'b', relation: 'implement' },
          ],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.edges).toHaveLength(5);
    expect(result.edges[0]?.type).toBe('call');
    expect(result.edges[1]?.type).toBe('dependency');
    expect(result.edges[2]?.type).toBe('import');
    expect(result.edges[3]?.type).toBe('extend');
    expect(result.edges[4]?.type).toBe('implement');
  });

  it('should handle lens_analyze returning empty symbols and references', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return { symbols: [], references: [] };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should handle lens_analyze returning object without symbols key', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return { foo: 'bar' };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should include scope in node properties', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [{ id: 's1', name: 'fn', scope: 'module', file: 'a.ts', line: 1, category: 'function' }],
          references: [],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes[0]?.properties.scope).toBe('module');
  });

  it('should construct edge id from from->to', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 'alpha', name: 'a', scope: 'g', file: 'a', line: 1, category: 'function' },
            { id: 'beta', name: 'b', scope: 'g', file: 'b', line: 1, category: 'function' },
          ],
          references: [{ from: 'alpha', to: 'beta', relation: 'call' }],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.edges[0]?.id).toBe('alpha->beta:call');
  });

  it('should set parentId for non-module symbols when file node exists', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 'f1', name: 'main.ts', scope: 'global', file: 'main.ts', line: 0, category: 'module' },
            { id: 'fn1', name: 'init', scope: 'module', file: 'main.ts', line: 5, category: 'function' },
          ],
          references: [],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.id).toBe('f1');
    expect(result.nodes[0]?.properties).toEqual({ scope: 'global' });
    expect(result.nodes[1]?.parentId).toBe('f1');
  });

  it('should not set parentId for module/file category symbols', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 'mod1', name: 'mod', scope: 'g', file: 'mod.ts', line: 0, category: 'module' },
            { id: 'file1', name: 'file', scope: 'g', file: 'file.ts', line: 0, category: 'file' },
          ],
          references: [],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.parentId).toBeUndefined();
    expect(result.nodes[1]?.parentId).toBeUndefined();
  });

  it('should handle non-array symbols gracefully', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return { symbols: 'not-an-array', references: [] };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should handle non-array references gracefully', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [{ id: 's1', name: 'fn', scope: 'g', file: 'a.ts', line: 1, category: 'function' }],
          references: 'not-an-array',
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toEqual([]);
  });
});

describe('LensAdapter - error handling', () => {
  it('should handle non-Error thrown values and include error message', async () => {
    const adapter = new LensAdapter();
    const invoke: UpstreamInvoker = async () => {
      throw 'string error message';
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.error).toBe('string error message');
  });

  it('should handle Error thrown and include error.message', async () => {
    const adapter = new LensAdapter();
    const invoke: UpstreamInvoker = async () => {
      throw new Error('specific error');
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.error).toBe('specific error');
  });
});

describe('LensAdapter - file category symbols', () => {
  it('should handle file category symbols and set parentId for non-file symbols', async () => {
    const adapter = new LensAdapter();
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 'f1', name: 'app.ts', scope: 'global', file: 'app.ts', line: 0, category: 'file' },
            { id: 'fn1', name: 'main', scope: 'module', file: 'app.ts', line: 5, category: 'function' },
          ],
          references: [],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.type).toBe('module');
    expect(result.nodes[0]?.parentId).toBeUndefined();
    expect(result.nodes[1]?.parentId).toBe('f1');
  });
});

describe('LensAdapter - all relation types', () => {
  it('should map reference relation to dependency type', async () => {
    const adapter = new LensAdapter();
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'lens_analyze') {
        return {
          symbols: [
            { id: 'a', name: 'a', scope: 'g', file: 'a.ts', line: 1, category: 'function' },
            { id: 'b', name: 'b', scope: 'g', file: 'b.ts', line: 1, category: 'function' },
          ],
          references: [{ from: 'a', to: 'b', relation: 'reference' }],
        };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.edges[0]?.type).toBe('dependency');
  });
});