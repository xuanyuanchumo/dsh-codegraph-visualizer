// Unit tests for adapters, merger, and tool render helpers
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CodeGraphAdapter,
  mapNodeKind,
  mapEdgeKind,
  resolveDbPath,
  readGraphFromDb,
} from '../../src/adapters/CodeGraphAdapter.ts';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { summarizeGraph } from '../../src/tools.ts';
import type { AdapterResult } from '../../src/types/index.ts';
import { RepoId } from '../../src/types/index.ts';
import type { UpstreamInvoker } from '../../src/adapters/CodeGraphAdapter.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

function createTestDb(dir: string): string {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const codegraphDir = join(dir, '.codegraph');
  if (!existsSync(codegraphDir)) mkdirSync(codegraphDir, { recursive: true });
  const dbPath = join(codegraphDir, 'codegraph.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
    CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
  `);
  db.prepare('INSERT INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'function', 'funcA', 'src/a.ts', 10, 'fn()', 'docs', 1);
  db.prepare('INSERT INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n2', 'class', 'ClassB', 'src/b.ts', 5, null, null, 0);
  db.prepare('INSERT INTO edges (id, source, target, kind, line) VALUES (?, ?, ?, ?, ?)').run(1, 'n1', 'n2', 'call', 12);
  db.prepare('INSERT INTO edges (id, source, target, kind, line) VALUES (?, ?, ?, ?, ?)').run(2, 'n1', 'n3', 'import', 3);
  db.close();
  return dbPath;
}

describe('CodeGraphAdapter', () => {
  let adapter: CodeGraphAdapter;

  beforeEach(() => {
    adapter = new CodeGraphAdapter();
  });

  it('should have a source property', () => {
    expect((adapter as unknown as { source: string }).source).toBe('codegraph');
  });

  it('should return empty result when invoke returns null', async () => {
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData('nonexistent-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.source).toBe('codegraph');
  });

  it('should return empty result when invoke returns non-object', async () => {
    const invoke: UpstreamInvoker = async () => 'not-an-object' as unknown;
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('should build file-structure skeleton from codegraph_files fallback', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [
          { path: 'src/index.ts', language: 'typescript' },
          { path: 'src/utils.ts', language: 'typescript' },
        ];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.type).toBe('module');
    expect(result.nodes[0]?.filePath).toBe('src/index.ts');
    expect(result.edges).toEqual([]);
  });

  it('should handle codegraph_files returning object with files[] key', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return { files: [{ path: 'a.ts' }, { path: 'b.ts' }] };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
  });

  it('should handle codegraph_files returning array of strings', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return ['file1.ts', 'file2.ts'];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.label).toBe('file1.ts');
  });

  it('should handle codegraph_files returning empty items', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return { items: [] };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
  });

  it('should handle codegraph_files returning object with items[] containing strings', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return { items: ['x.ts', 'y.ts'] };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.label).toBe('x.ts');
  });

  it('should handle codegraph_files returning object with files[] containing strings', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return { files: ['a.ts', 'b.ts'] };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
  });

  it('should handle codegraph_files returning mixed array of strings and objects', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return ['str.ts', { path: 'obj.ts', language: 'typescript' }];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.filePath).toBe('str.ts');
    expect(result.nodes[1]?.filePath).toBe('obj.ts');
  });

  it('should handle codegraph_files returning object entries without path', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [{ name: 'no-path.ts' }];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
  });

  it('should handle codegraph_files returning non-array inner items', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return { files: 'not-an-array' };
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
  });

  it('should handle codegraph_files returning null', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return null;
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toEqual([]);
  });

  it('should set language property from file record', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [{ path: 'a.py', language: 'python' }];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes[0]?.properties.language).toBe('python');
  });

  it('should set index property on file nodes', async () => {
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [{ path: 'a.ts' }, { path: 'b.ts' }];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes[0]?.properties.index).toBe(0);
    expect(result.nodes[1]?.properties.index).toBe(1);
  });
});

describe('resolveDbPath', () => {
  it('should resolve .codegraph/codegraph.db for a workspace path', () => {
    const path = resolveDbPath('/home/user/project');
    expect(path).toContain('.codegraph');
    expect(path).toContain('codegraph.db');
  });

  it('should use process.cwd() when path is "."', () => {
    const path = resolveDbPath('.');
    expect(path).toContain('.codegraph');
  });

  it('should use process.cwd() when path is empty', () => {
    const path = resolveDbPath('');
    expect(path).toContain('.codegraph');
  });
});

describe('readGraphFromDb', () => {
  it('should return null when db file does not exist', () => {
    const result = readGraphFromDb('/nonexistent/path/codegraph.db');
    expect(result).toBeNull();
  });

  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should read nodes and edges from a valid db', () => {
    const dbPath = createTestDb(tempDir);
    const result = readGraphFromDb(dbPath);
    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(2);
    expect(result!.edges).toHaveLength(2);
    expect(result!.nodes[0]?.id).toBe('n1');
    expect(result!.nodes[0]?.kind).toBe('function');
    expect(result!.nodes[0]?.name).toBe('funcA');
    expect(result!.edges[0]?.source).toBe('n1');
    expect(result!.edges[0]?.target).toBe('n2');
    expect(result!.edges[0]?.kind).toBe('call');
  });

  it('should return null for corrupted db', () => {
    const dbPath = join(tempDir, 'corrupt.db');
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE foo (x INTEGER)');
    db.close();
    const result = readGraphFromDb(dbPath);
    expect(result).toBeNull();
  });
});

describe('CodeGraphAdapter with real DB', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should read graph from DB when available', async () => {
    createTestDb(tempDir);
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData(tempDir, invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes[0]?.label).toBe('funcA');
    expect(result.nodes[0]?.type).toBe('function');
    expect(result.nodes[1]?.label).toBe('ClassB');
    expect(result.nodes[1]?.type).toBe('class');
    expect(result.edges[0]?.type).toBe('call');
    expect(result.source).toBe('codegraph');
  });

  it('should filter dangling edges in toAdapterResult', async () => {
    createTestDb(tempDir);
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData(tempDir, invoke);
    // edge 2 references n3 which doesn't exist in nodes table
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.source).toBe('n1');
  });

  it('should include signature and docstring in properties', async () => {
    createTestDb(tempDir);
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData(tempDir, invoke);
    expect(result.nodes[0]?.properties.signature).toBe('fn()');
    expect(result.nodes[0]?.properties.docstring).toBe('docs');
    expect(result.nodes[0]?.properties.exported).toBe(true);
  });

  it('should set exported false for non-exported nodes', async () => {
    createTestDb(tempDir);
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData(tempDir, invoke);
    expect(result.nodes[1]?.properties.exported).toBe(false);
  });

  it('should include line number in edge properties', async () => {
    createTestDb(tempDir);
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async () => null;
    const result = await adapter.fetchData(tempDir, invoke);
    expect(result.edges[0]?.properties.line).toBe(12);
  });

  it('should fall back to codegraph_files when DB has no nodes', async () => {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const codegraphDir = join(tempDir, '.codegraph');
    if (!existsSync(codegraphDir)) mkdirSync(codegraphDir, { recursive: true });
    const dbPath = join(codegraphDir, 'codegraph.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
      CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
    `);
    db.close();
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [{ path: 'fallback.ts' }];
      }
      return null;
    };
    const result = await adapter.fetchData(tempDir, invoke);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.filePath).toBe('fallback.ts');
  });
});

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
    expect(result.edges[0]?.id).toBe('alpha->beta');
  });
});

describe('mapNodeKind', () => {
  it('should map known kinds', () => {
    expect(mapNodeKind('function')).toBe('function');
    expect(mapNodeKind('method')).toBe('function');
    expect(mapNodeKind('class')).toBe('class');
    expect(mapNodeKind('interface')).toBe('interface');
    expect(mapNodeKind('type_alias')).toBe('type');
    expect(mapNodeKind('constant')).toBe('variable');
    expect(mapNodeKind('variable')).toBe('variable');
    expect(mapNodeKind('file')).toBe('module');
    expect(mapNodeKind('import')).toBe('module');
  });

  it('should default unknown kinds to module', () => {
    expect(mapNodeKind('unknown')).toBe('module');
  });
});

describe('mapEdgeKind', () => {
  it('should map known edge kinds', () => {
    expect(mapEdgeKind('call')).toBe('call');
    expect(mapEdgeKind('calls')).toBe('call');
    expect(mapEdgeKind('import')).toBe('import');
    expect(mapEdgeKind('imports')).toBe('import');
    expect(mapEdgeKind('extend')).toBe('extend');
    expect(mapEdgeKind('extends')).toBe('extend');
    expect(mapEdgeKind('implement')).toBe('implement');
    expect(mapEdgeKind('implements')).toBe('implement');
    expect(mapEdgeKind('contains')).toBe('dependency');
    expect(mapEdgeKind('dependency')).toBe('dependency');
  });

  it('should default unknown edge kinds to dependency', () => {
    expect(mapEdgeKind('unknown')).toBe('dependency');
  });
});

describe('GraphDataMerger', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  it('should merge multiple results', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 1,
      },
      {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 1)],
        edges: [makeEdge('e2', 'n2', 'n1', 'extend')],
        source: 'lens',
        timestamp: 2,
      },
    ];

    const merged = merger.merge(results, RepoId('test-repo'));
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(2);
    expect(merged.metadata.nodeCount).toBe(2);
    expect(merged.metadata.edgeCount).toBe(2);
    expect(merged.metadata.repoId).toBe('test-repo');
  });

  it('should deduplicate nodes by id', () => {
    const results: AdapterResult[] = [
      {
        nodes: [
          makeNode('n1', 'A', 'function', 'a.ts', 1),
          makeNode('n1', 'A', 'class', 'a.ts', 1),
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 1,
      },
    ];

    const merged = merger.merge(results, RepoId('test-repo'));
    expect(merged.nodes).toHaveLength(1);
  });

  describe('applyDelta', () => {
    it('should add new nodes and edges to existing graph', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [makeEdge('e1', 'n1', 'n2', 'call')],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 2)],
        edges: [makeEdge('e2', 'n2', 'n1', 'extend')],
        source: 'lens',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(2);
      expect(result.metadata.nodeCount).toBe(2);
      expect(result.metadata.edgeCount).toBe(2);
    });

    it('should update existing node when delta has same id', () => {
      const current = makeGraphData(
        [makeNode('n1', 'OldLabel', 'function', 'a@deprecated', 1)],
        [],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [makeNode('n1', 'NewLabel', 'function', 'a.ts', 42)],
        edges: [],
        source: 'codegraph',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.label).toBe('NewLabel');
      expect(result.nodes[0]?.lineNumber).toBe(42);
    });

    it('should handle empty delta', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'r1',
        100,
      );
      const delta: AdapterResult = { nodes: [], edges: [], source: 'codegraph', timestamp: 200 };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(1);
      expect(result.metadata.nodeCount).toBe(1);
    });

    it('should update existing edge when delta has same id', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'class', 'b.ts', 2)],
        [makeEdge('e1', 'n1', 'n2', 'call')],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [],
        edges: [makeEdge('e1', 'n1', 'n2', 'import')],
        source: 'lens',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.type).toBe('import');
    });

    it('should preserve repoId from current metadata', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'my-repo',
        100,
      );
      const delta: AdapterResult = {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 2)],
        edges: [],
        source: 'codegraph',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.metadata.repoId).toBe('my-repo');
    });

    it('should update timestamp from delta', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 999,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.metadata.timestamp).toBeGreaterThanOrEqual(999);
    });
  });

  it('should merge empty results array', () => {
    const merged = merger.merge([], RepoId('empty-repo'));
    expect(merged.nodes).toEqual([]);
    expect(merged.edges).toEqual([]);
    expect(merged.metadata.nodeCount).toBe(0);
    expect(merged.metadata.edgeCount).toBe(0);
    expect(merged.metadata.repoId).toBe('empty-repo');
  });

  it('should deduplicate edges by id', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 1,
      },
      {
        nodes: [],
        edges: [makeEdge('e1', 'n1', 'n2', 'import')],
        source: 'lens',
        timestamp: 2,
      },
    ];

    const merged = merger.merge(results, RepoId('test-repo'));
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]?.type).toBe('import');
  });

  it('should merge single result', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 1,
      },
    ];

    const merged = merger.merge(results, RepoId('single-repo'));
    expect(merged.nodes).toHaveLength(1);
    expect(merged.edges).toHaveLength(1);
    expect(merged.metadata.repoId).toBe('single-repo');
  });
});

describe('summarizeGraph', () => {
  it('should produce readable summary with node/edge stats', () => {
    const data = makeGraphData(
      [
        makeNode('n1', 'funcA', 'function', 'a.ts', 10),
        makeNode('n2', 'ClassB', 'class', 'b.ts', 5),
      ],
      [makeEdge('e1', 'n1', 'n2', 'call')],
      'r1',
      1,
    );

    const summary = summarizeGraph(data);
    expect(summary).toContain('2 nodes');
    expect(summary).toContain('1 edges');
    expect(summary).toContain('function:1');
    expect(summary).toContain('class:1');
    expect(summary).toContain('call:1');
    expect(summary).toContain('funcA');
  });

  it('should handle empty graph', () => {
    const data = makeGraphData([], [], 'r1', 1);

    const summary = summarizeGraph(data);
    expect(summary).toContain('0 nodes');
    expect(summary).toContain('0 edges');
  });
});

describe('applyDelta properties deep merge', () => {
  it('should deep merge node properties: existing {a:1,b:2} + delta {b:3,c:4} = {a:1,b:3,c:4}', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2 })],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { b: 3, c: 4 })],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deep merge edge properties', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [makeEdge('e1', 'n1', 'n1', 'call', { x: 'old' })],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [],
      edges: [makeEdge('e1', 'n1', 'n1', 'call', { x: 'new', y: 'added' })],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.edges[0]?.properties).toEqual({ x: 'new', y: 'added' });
  });

  it('should preserve existing properties not in delta', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2, c: 3 })],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { b: 99 })],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('should keep all existing properties when delta properties is empty', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2 })],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, {})],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ a: 1, b: 2 });
  });

  it('should use delta properties when existing properties is empty', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, {})],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: 'new' })],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ x: 'new' });
  });
});
