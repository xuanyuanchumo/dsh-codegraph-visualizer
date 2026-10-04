import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphRepository } from '../../src/host/db/GraphRepository.ts';
import type { SnapshotRecord, AnalysisRecord, LayoutPresetRecord } from '../../src/host/db/GraphRepository.ts';
import { FINGERPRINT } from '../../src/shared/constants.ts';

// Internal sqlite handle shape, accessed only for fault-injection in tests.
type SqliteDbLike = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

function getDb(repo: GraphRepository): SqliteDbLike {
  return (repo as unknown as { db: SqliteDbLike }).db;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('GraphRepository', () => {
  let workspace: string;
  let repo: GraphRepository;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'cgrepo-'));
    repo = new GraphRepository(workspace);
  });

  afterEach(() => {
    repo.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('init / isReady', () => {
    it('init returns true and marks ready', () => {
      expect(repo.init()).toBe(true);
      expect(repo.isReady()).toBe(true);
    });

    it('init creates the .codegraph-visualizer directory and viz.db file', () => {
      expect(repo.init()).toBe(true);
      const dbFile = join(workspace, '.codegraph-visualizer', 'viz.db');
      expect(existsSync(join(workspace, '.codegraph-visualizer'))).toBe(true);
      expect(existsSync(dbFile)).toBe(true);
    });

    it('isReady is false before init', () => {
      expect(repo.isReady()).toBe(false);
    });

    it('can re-init after close without leaking handles', () => {
      expect(repo.init()).toBe(true);
      repo.close();
      expect(repo.isReady()).toBe(false);
      expect(repo.init()).toBe(true);
      expect(repo.isReady()).toBe(true);
    });

    it('init returns false when the workspace path is a file (mkdirSync fails)', () => {
      const blockerDir = mkdtempSync(join(tmpdir(), 'cgblock-'));
      const blockerFile = join(blockerDir, 'blocker');
      writeFileSync(blockerFile, 'x');
      const badRepo = new GraphRepository(blockerFile);
      try {
        expect(badRepo.init()).toBe(false);
        expect(badRepo.isReady()).toBe(false);
      } finally {
        rmSync(blockerDir, { recursive: true, force: true });
      }
    });
  });

  describe('saveSnapshot / getLatestSnapshot', () => {
    it('round-trips a snapshot and maps all columns to the record', () => {
      repo.init();
      const data = Buffer.from('hello-snapshot');
      repo.saveSnapshot('repo-A', 'hash-1', 10, 20, data);

      const result = repo.getLatestSnapshot('repo-A');
      expect(result).not.toBeNull();
      const rec = result as SnapshotRecord;
      expect(rec.repoId).toBe('repo-A');
      expect(rec.snapshotHash).toBe('hash-1');
      expect(rec.nodeCount).toBe(10);
      expect(rec.edgeCount).toBe(20);
      // node:sqlite returns BLOBs as Uint8Array; compare byte contents, not the wrapper type.
      expect(rec.data).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(rec.data as Uint8Array).equals(data)).toBe(true);
      expect(rec.createdAt).toBeGreaterThan(0);
      expect(rec.id).toBeGreaterThan(0);
    });

    it('returns null when no snapshot exists for the repo', () => {
      repo.init();
      expect(repo.getLatestSnapshot('missing-repo')).toBeNull();
    });

    it('returns the most recently created snapshot (ordered by created_at DESC)', async () => {
      repo.init();
      repo.saveSnapshot('repo-B', 'old', 1, 1, Buffer.from('a'));
      await sleep(5);
      repo.saveSnapshot('repo-B', 'new', 2, 2, Buffer.from('b'));

      const result = repo.getLatestSnapshot('repo-B');
      expect(result).not.toBeNull();
      expect((result as SnapshotRecord).snapshotHash).toBe('new');
      expect((result as SnapshotRecord).nodeCount).toBe(2);
    });

    it('saveSnapshot before init is a safe no-op', () => {
      expect(() => repo.saveSnapshot('r', 'h', 1, 1, Buffer.from('x'))).not.toThrow();
      expect(repo.getLatestSnapshot('r')).toBeNull();
    });
  });

  describe('countSnapshots', () => {
    it('counts snapshots per repo in isolation', () => {
      repo.init();
      expect(repo.countSnapshots('repo-A')).toBe(0);
      repo.saveSnapshot('repo-A', 'h1', 1, 1, Buffer.from('a'));
      repo.saveSnapshot('repo-B', 'h1', 1, 1, Buffer.from('b'));
      repo.saveSnapshot('repo-A', 'h2', 2, 2, Buffer.from('c'));

      expect(repo.countSnapshots('repo-A')).toBe(2);
      expect(repo.countSnapshots('repo-B')).toBe(1);
      expect(repo.countSnapshots('missing')).toBe(0);
    });

    // P0-6: re-saving the same structural fingerprint must update the existing row in place instead
    // of appending. This is the UNIQUE(repo_id, snapshot_hash) index doing its job.
    it('does not grow when the same hash is saved twice', () => {
      repo.init();
      repo.saveSnapshot('repo-A', 'v1:stable', 5, 6, Buffer.from('first'));
      repo.saveSnapshot('repo-A', 'v1:stable', 5, 6, Buffer.from('second'));

      expect(repo.countSnapshots('repo-A')).toBe(1);
      const rec = repo.getLatestSnapshot('repo-A') as SnapshotRecord;
      expect(rec.snapshotHash).toBe('v1:stable');
      expect(Buffer.from(rec.data as Uint8Array).toString('utf-8')).toBe('second');
    });

    it('keeps at most the configured number of distinct snapshots', () => {
      repo.init();
      for (let i = 0; i < FINGERPRINT.SNAPSHOT_KEEP + 2; i++) {
        repo.saveSnapshot('repo-A', `v1:h${i}`, i, i, Buffer.from(`d${i}`));
      }
      expect(repo.countSnapshots('repo-A')).toBe(FINGERPRINT.SNAPSHOT_KEEP);
    });

    it('honours an explicit keep override on pruneSnapshots', () => {
      repo.init();
      repo.saveSnapshot('repo-A', 'h1', 1, 1, Buffer.from('a'));
      repo.saveSnapshot('repo-A', 'h2', 1, 1, Buffer.from('b'));
      repo.pruneSnapshots('repo-A', 1);
      expect(repo.countSnapshots('repo-A')).toBe(1);
    });

    it('countSnapshots before init is a safe no-op returning 0', () => {
      expect(repo.countSnapshots('repo-A')).toBe(0);
    });
  });

  describe('saveAnalysis / getAnalysis', () => {
    it('round-trips analysis without a target node', () => {
      repo.init();
      repo.saveAnalysis('repo-A', 'complexity', '{"score":42}');

      const result = repo.getAnalysis('repo-A', 'complexity');
      expect(result).not.toBeNull();
      const rec = result as AnalysisRecord;
      expect(rec.repoId).toBe('repo-A');
      expect(rec.analysisType).toBe('complexity');
      expect(rec.targetNode).toBeNull();
      expect(rec.result).toBe('{"score":42}');
      expect(rec.createdAt).toBeGreaterThan(0);
    });

    it('round-trips analysis with a target node and filters by it', () => {
      repo.init();
      repo.saveAnalysis('repo-A', 'outline', '{"n":1}', 'src/a.ts');
      repo.saveAnalysis('repo-A', 'outline', '{"n":2}', 'src/b.ts');

      const result = repo.getAnalysis('repo-A', 'outline', 'src/b.ts');
      expect(result).not.toBeNull();
      const rec = result as AnalysisRecord;
      expect(rec.targetNode).toBe('src/b.ts');
      expect(rec.result).toBe('{"n":2}');
    });

    it('returns null when no analysis matches', () => {
      repo.init();
      expect(repo.getAnalysis('repo-A', 'complexity')).toBeNull();
      repo.saveAnalysis('repo-A', 'complexity', '{}', 'src/a.ts');
      // querying with a different targetNode should not match the targeted row
      expect(repo.getAnalysis('repo-A', 'complexity', 'src/other.ts')).toBeNull();
    });

    it('saveAnalysis before init is a safe no-op', () => {
      expect(() => repo.saveAnalysis('r', 't', '{}')).not.toThrow();
      expect(repo.getAnalysis('r', 't')).toBeNull();
    });
  });

  describe('setPreference / getPreference', () => {
    it('round-trips a preference value', () => {
      repo.init();
      repo.setPreference('theme', 'dark');
      expect(repo.getPreference('theme')).toBe('dark');
    });

    it('upserts on conflict (same key updates value)', () => {
      repo.init();
      repo.setPreference('theme', 'dark');
      repo.setPreference('theme', 'light');
      expect(repo.getPreference('theme')).toBe('light');
    });

    it('returns null when the key does not exist', () => {
      repo.init();
      expect(repo.getPreference('missing')).toBeNull();
    });

    it('setPreference before init is a safe no-op', () => {
      expect(() => repo.setPreference('k', 'v')).not.toThrow();
      expect(repo.getPreference('k')).toBeNull();
    });
  });

  describe('saveLayoutPreset / getLayoutPresets', () => {
    it('round-trips layout presets and maps all columns', () => {
      repo.init();
      repo.saveLayoutPreset('repo-A', 'default', 'dagre', '{"nodes":[]}');

      const presets = repo.getLayoutPresets('repo-A');
      expect(presets).toHaveLength(1);
      const rec: LayoutPresetRecord = presets[0]!;
      expect(rec.name).toBe('default');
      expect(rec.layoutType).toBe('dagre');
      expect(rec.positions).toBe('{"nodes":[]}');
      expect(rec.id).toBeGreaterThan(0);
    });

    it('returns multiple presets ordered by created_at DESC', async () => {
      repo.init();
      repo.saveLayoutPreset('repo-B', 'first', 'dagre', '{}');
      await sleep(5);
      repo.saveLayoutPreset('repo-B', 'second', 'fcose', '{}');

      const presets = repo.getLayoutPresets('repo-B');
      expect(presets).toHaveLength(2);
      expect(presets[0]!.name).toBe('second');
      expect(presets[1]!.name).toBe('first');
    });

    it('returns an empty array when no presets exist', () => {
      repo.init();
      expect(repo.getLayoutPresets('missing')).toEqual([]);
    });

    it('saveLayoutPreset before init is a safe no-op', () => {
      expect(() => repo.saveLayoutPreset('r', 'n', 't', '{}')).not.toThrow();
      expect(repo.getLayoutPresets('r')).toEqual([]);
    });
  });

  describe('close', () => {
    it('close sets isReady to false', () => {
      repo.init();
      expect(repo.isReady()).toBe(true);
      repo.close();
      expect(repo.isReady()).toBe(false);
    });

    it('close is idempotent', () => {
      repo.init();
      repo.close();
      expect(() => repo.close()).not.toThrow();
      expect(repo.isReady()).toBe(false);
    });

    it('all operations are safe after close', () => {
      repo.init();
      repo.close();
      expect(() => repo.saveSnapshot('r', 'h', 1, 1, Buffer.from('x'))).not.toThrow();
      expect(repo.getLatestSnapshot('r')).toBeNull();
      expect(() => repo.saveAnalysis('r', 't', '{}')).not.toThrow();
      expect(repo.getAnalysis('r', 't')).toBeNull();
      expect(() => repo.setPreference('k', 'v')).not.toThrow();
      expect(repo.getPreference('k')).toBeNull();
      expect(() => repo.saveLayoutPreset('r', 'n', 't', '{}')).not.toThrow();
      expect(repo.getLayoutPresets('r')).toEqual([]);
    });

    it('close swallows db.close() errors', () => {
      repo.init();
      const db = getDb(repo);
      const realClose = db.close;
      let closedCalled = false;
      db.close = () => {
        closedCalled = true;
        throw new Error('close boom');
      };
      expect(() => repo.close()).not.toThrow();
      expect(closedCalled).toBe(true);
      expect(repo.isReady()).toBe(false);
      // restore the real close and release the underlying file handle so cleanup can rmSync
      db.close = realClose;
      try { db.close(); } catch { /* ignore */ }
    });
  });

  describe('error branches (prepare throws)', () => {
    beforeEach(() => {
      repo.init();
    });

    it('saveSnapshot swallows a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(() => repo.saveSnapshot('r', 'h', 1, 1, Buffer.from('x'))).not.toThrow();
    });

    it('getLatestSnapshot returns null on a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(repo.getLatestSnapshot('r')).toBeNull();
    });

    it('saveAnalysis swallows a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(() => repo.saveAnalysis('r', 't', '{}')).not.toThrow();
    });

    it('getAnalysis returns null on a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(repo.getAnalysis('r', 't')).toBeNull();
    });

    it('setPreference swallows a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(() => repo.setPreference('k', 'v')).not.toThrow();
    });

    it('getPreference returns null on a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(repo.getPreference('k')).toBeNull();
    });

    it('saveLayoutPreset swallows a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(() => repo.saveLayoutPreset('r', 'n', 't', '{}')).not.toThrow();
    });

    it('getLayoutPresets returns [] on a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(repo.getLayoutPresets('r')).toEqual([]);
    });

    it('countSnapshots returns 0 on a prepare error', () => {
      const db = getDb(repo);
      db.prepare = () => {
        throw new Error('prepare boom');
      };
      expect(repo.countSnapshots('r')).toBe(0);
    });
  });
});