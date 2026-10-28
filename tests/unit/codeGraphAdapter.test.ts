// Unit tests for CodeGraphAdapter
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CodeGraphAdapter,
  mapNodeKind,
  mapEdgeKind,
  resolveDbPath,
  readGraphFromDb,
  readEdgesFromDb,
  readFilesFromDb,
  normalizeRepoPath,
  closeAllDbConnections,
} from '../../src/adapters/CodeGraphAdapter.ts';
import type { UpstreamInvoker } from '../../src/adapters/CodeGraphAdapter.ts';
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

  it('should throw for path containing ..', () => {
    expect(() => resolveDbPath('../escape')).toThrow('Invalid workspace path');
    expect(() => resolveDbPath('foo/../../bar')).toThrow('Invalid workspace path');
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
    closeAllDbConnections();
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

describe('readEdgesFromDb pagination', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-edges-'));
  });

  afterEach(() => {
    closeAllDbConnections();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createEdgesDb(dir: string): string {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const codegraphDir = join(dir, '.codegraph');
    mkdirSync(codegraphDir, { recursive: true });
    const dbPath = join(codegraphDir, 'codegraph.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
      CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
    `);
    const insertNode = db.prepare('INSERT INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run('n1', 'function', 'a', 'src/big.ts', 1, null, null, 1);
    insertNode.run('n2', 'function', 'b', 'src/big.ts', 2, null, null, 1);
    insertNode.run('n3', 'function', 'c', 'src/big.ts', 3, null, null, 1);
    const insertEdge = db.prepare('INSERT INTO edges (id, source, target, kind, line) VALUES (?, ?, ?, ?, ?)');
    // Interleave kept edges with both filtered kinds and self-loops, so an
    // implementation that filters AFTER slicing both short-pages and re-reads
    // rows on the next cursor.
    insertEdge.run(1, 'n1', 'n2', 'call', 1);              // kept
    insertEdge.run(2, 'n1', 'n3', 'uses_var', 2);          // filtered kind
    insertEdge.run(3, 'n2', 'n3', 'call', 3);              // kept
    insertEdge.run(4, 'n1', 'n1', 'call', 4);              // self-loop
    insertEdge.run(5, 'n2', 'n1', 'func_imports_local', 5); // filtered kind
    insertEdge.run(6, 'n3', 'n1', 'call', 6);              // kept
    insertEdge.run(7, 'n3', 'n2', 'call', 7);              // kept
    insertEdge.run(8, 'n1', 'n2', 'import', 8);            // kept
    insertEdge.run(9, 'n3', 'n3', 'call', 9);              // self-loop
    insertEdge.run(10, 'n2', 'n3', 'import', 10);          // kept
    db.close();
    return dbPath;
  }

  it('reports the filtered total and pages without duplicates or gaps', () => {
    const dbPath = createEdgesDb(tempDir);
    const limit = 2;
    const seen: number[] = [];
    let cursor = 0;
    let total = -1;
    for (let page = 0; page < 10; page++) {
      const result = readEdgesFromDb(dbPath, 'n1', 'file', cursor, limit);
      expect(result).not.toBeNull();
      total = result!.total;
      for (const e of result!.edges) seen.push(e.id);
      cursor += result!.edges.length;
      if (cursor >= total) break;
    }
    expect(total).toBe(6);
    // Sorted comparison: the underlying SELECT has no ORDER BY, so row order is
    // a query-planner detail. Duplicates and gaps are the real contract.
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 3, 6, 7, 8, 10]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('applies the shared edge policy on the symbol scope too', () => {
    const dbPath = createEdgesDb(tempDir);
    const result = readEdgesFromDb(dbPath, 'n1', 'symbol', 0, 100);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(3);
    expect([...result!.edges.map((e) => e.id)].sort((a, b) => a - b)).toEqual([1, 6, 8]);
  });
});

describe('readFilesFromDb', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-files-'));
  });

  afterEach(() => {
    closeAllDbConnections();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createFilesDb(dir: string): string {
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const codegraphDir = join(dir, '.codegraph');
    mkdirSync(codegraphDir, { recursive: true });
    const dbPath = join(codegraphDir, 'codegraph.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
      CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
    `);
    const insertNode = db.prepare('INSERT INTO nodes (id, kind, name, file_path, start_line, signature, docstring, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insertNode.run('a1', 'function', 'alpha', 'src/a.ts', 1, null, null, 1);
    insertNode.run('a2', 'class', 'Alpha', 'src/a.ts', 20, null, null, 1);
    insertNode.run('b1', 'function', 'beta', 'src/nested/b.ts', 5, null, null, 1);
    insertNode.run('c1', 'function', 'gamma', 'src/c.ts', 7, null, null, 0);
    insertNode.run('d1', 'function', 'delta', 'lib/d.ts', 9, null, null, 1);
    const insertEdge = db.prepare('INSERT INTO edges (id, source, target, kind, line) VALUES (?, ?, ?, ?, ?)');
    insertEdge.run(1, 'a1', 'a2', 'call', 2);      // both ends changed
    insertEdge.run(2, 'a1', 'd1', 'call', 3);      // one end changed
    insertEdge.run(3, 'c1', 'd1', 'call', 4);      // neither end changed
    db.close();
    return dbPath;
  }

  it('returns null when the index cannot be opened', () => {
    expect(readFilesFromDb(join(tempDir, 'missing', 'codegraph.db'), ['src/a.ts'])).toBeNull();
  });

  it('returns an empty result for an empty file list without touching the index', () => {
    expect(readFilesFromDb(join(tempDir, 'missing', 'codegraph.db'), [])).toEqual({ nodes: [], edges: [] });
  });

  it('reads back only the rows that belong to the requested files', () => {
    const dbPath = createFilesDb(tempDir);
    const result = readFilesFromDb(dbPath, ['src/a.ts']);
    expect(result).not.toBeNull();
    expect(result!.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2']);
  });

  it('accepts backslash-separated paths from the watcher', () => {
    const dbPath = createFilesDb(tempDir);
    const result = readFilesFromDb(dbPath, ['src\\a.ts']);
    expect(result!.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2']);
  });

  it('pulls in files below a changed directory', () => {
    const dbPath = createFilesDb(tempDir);
    const result = readFilesFromDb(dbPath, ['src']);
    expect(result!.nodes.map((n) => n.id).sort()).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  // An edge from a changed file into an unchanged one is exactly the kind of edge a re-scan can
  // add or drop, so keeping both-ends-only would hide it from the caller.
  it('keeps edges with only one endpoint inside the changed set', () => {
    const dbPath = createFilesDb(tempDir);
    const result = readFilesFromDb(dbPath, ['src/a.ts']);
    expect(result!.edges.map((e) => e.id).sort((x, y) => x - y)).toEqual([1, 2]);
  });

  it('drops edges whose endpoints are all outside the changed set', () => {
    const dbPath = createFilesDb(tempDir);
    const result = readFilesFromDb(dbPath, ['lib/d.ts']);
    expect(result!.edges.map((e) => e.id).sort((x, y) => x - y)).toEqual([2, 3]);
  });

  it('returns empty buckets when nothing in the index matches', () => {
    const dbPath = createFilesDb(tempDir);
    const result = readFilesFromDb(dbPath, ['src/nowhere.ts']);
    expect(result).toEqual({ nodes: [], edges: [] });
  });
});

describe('normalizeRepoPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizeRepoPath('src\\nested\\a.ts')).toBe('src/nested/a.ts');
  });

  it('strips a leading ./ prefix', () => {
    expect(normalizeRepoPath('./src/a.ts')).toBe('src/a.ts');
  });

  it('leaves an already-normal path untouched', () => {
    expect(normalizeRepoPath('src/a.ts')).toBe('src/a.ts');
  });
});

describe('CodeGraphAdapter with real DB', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cg-test-'));
  });

  afterEach(() => {
    closeAllDbConnections();
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

describe('CodeGraphAdapter - isNoisePath filtering', () => {
  it('should filter out node_modules paths in fallback file list', async () => {
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [
          { path: 'src/index.ts' },
          { path: 'node_modules/react/index.ts' },
          { path: '.git/HEAD' },
          { path: 'dist/bundle.js' },
        ];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.filePath).toBe('src/index.ts');
  });

  it('should filter out noise paths in DB node conversion (toAdapterResult)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-noise-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'function', 'cleanFn', 'src/a.ts', 10, null, null, 0);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n2', 'function', 'noiseFn', 'node_modules/lib/b.ts', 5, null, null, 0);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.label).toBe('cleanFn');
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('CodeGraphAdapter - toAdapterResult edge filtering', () => {
  it('should filter self-loop edges (source === target)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-selfloop-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'function', 'funcA', 'src/a.ts', 10, null, null, 0);
      db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(1, 'n1', 'n1', 'call', 12);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      expect(result.edges).toHaveLength(0);
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should filter edges with FILTERED_EDGE_KINDS (uses_var, func_imports_local)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-filtered-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'function', 'funcA', 'src/a.ts', 10, null, null, 0);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n2', 'function', 'funcB', 'src/b.ts', 5, null, null, 0);
      db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(1, 'n1', 'n2', 'uses_var', 12);
      db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(2, 'n1', 'n2', 'func_imports_local', 3);
      db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(3, 'n1', 'n2', 'call', 8);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.type).toBe('call');
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should limit imports per source to MAX_IMPORTS_PER_SOURCE (20)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-imports-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('src', 'function', 'main', 'src/main.ts', 1, null, null, 0);
      for (let i = 1; i <= 25; i++) {
        const targetId = `t${i}`;
        db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(targetId, 'function', `dep${i}`, `src/dep${i}.ts`, 1, null, null, 0);
        db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(i, 'src', targetId, 'import', null);
      }
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      const importEdges = result.edges.filter((e) => e.type === 'import');
      expect(importEdges).toHaveLength(20);
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should assign parentId to non-file nodes when file node exists', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-parentid-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('file1', 'file', 'main.ts', 'src/main.ts', 1, null, null, 0);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('fn1', 'function', 'init', 'src/main.ts', 5, 'fn()', null, 1);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      const fnNode = result.nodes.find((n) => n.label === 'init');
      expect(fnNode?.parentId).toBe('file1');
      const fileNode = result.nodes.find((n) => n.label === 'main.ts');
      expect(fileNode?.parentId).toBeUndefined();
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should not assign parentId to import kind nodes', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-import-parentid-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('file1', 'file', 'main.ts', 'src/main.ts', 1, null, null, 0);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('imp1', 'import', 'react', 'src/main.ts', 1, null, null, 0);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      const impNode = result.nodes.find((n) => n.label === 'react');
      expect(impNode?.parentId).toBeUndefined();
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should include edge properties with line number when present', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-edge-line-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n1', 'function', 'funcA', 'src/a.ts', 10, null, null, 0);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('n2', 'class', 'ClassB', 'src/b.ts', 5, null, null, 0);
      db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(1, 'n1', 'n2', 'call', 15);
      db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?)').run(2, 'n2', 'n1', 'contains', null);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      const callEdge = result.edges.find((e) => e.type === 'call');
      expect(callEdge?.properties.line).toBe(15);
      // P0-1 归因键：有 line 的边是可定位的，并保留压平前的上游 kind（'call' 本身就是上游写法）
      expect(callEdge?.properties).toMatchObject({
        edgeOrigin: 'db', edgeLocatable: true, rawKind: 'call',
      });
      const containsEdge = result.edges.find((e) => e.type === 'contains');
      // `line: null` 的行没有位置证据，所以只有归因键 —— 不得凭空补一个 line 或置信度
      expect(containsEdge?.properties).toEqual({
        edgeOrigin: 'db', edgeLocatable: false, rawKind: 'contains',
      });
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should map module kind node correctly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cg-module-kind-'));
    try {
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const codegraphDir = join(tempDir, '.codegraph');
      mkdirSync(codegraphDir, { recursive: true });
      const dbPath = join(codegraphDir, 'codegraph.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER, signature TEXT, docstring TEXT, is_exported INTEGER);
        CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, line INTEGER);
      `);
      db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', 'module', 'myMod', 'src/mod.ts', 1, null, null, 0);
      db.close();
      const adapter = new CodeGraphAdapter();
      const invoke: UpstreamInvoker = async () => null;
      const result = await adapter.fetchData(tempDir, invoke);
      expect(result.nodes[0]?.type).toBe('module');
      expect(result.nodes[0]?.parentId).toBeUndefined();
    } finally {
      closeAllDbConnections();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('CodeGraphAdapter - fallback with noise path filtering', () => {
  it('should filter various noise path segments', async () => {
    const adapter = new CodeGraphAdapter();
    const invoke: UpstreamInvoker = async (tool: string) => {
      if (tool === 'codegraph_files') {
        return [
          { path: 'src/app.ts' },
          { path: 'vendor/lib.ts' },
          { path: '__pycache__/mod.py' },
          { path: '.venv/pkg.py' },
          { path: 'build/out.js' },
          { path: '.next/page.js' },
          { path: '.cache/data.json' },
          { path: '.turbo/cache.ts' },
          { path: 'coverage/report.ts' },
          { path: '.pytest_cache/test.py' },
          { path: '.nuxt/gen.js' },
          { path: 'src/clean.ts' },
        ];
      }
      return null;
    };
    const result = await adapter.fetchData('test-repo', invoke);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]?.filePath).toBe('src/app.ts');
    expect(result.nodes[1]?.filePath).toBe('src/clean.ts');
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
    expect(mapEdgeKind('contains')).toBe('contains');
    expect(mapEdgeKind('dependency')).toBe('dependency');
  });

  it('should default unknown edge kinds to dependency', () => {
    expect(mapEdgeKind('unknown')).toBe('dependency');
  });
});