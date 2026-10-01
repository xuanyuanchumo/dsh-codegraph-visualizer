import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { scoped } from '../../shared/Logger.ts';
import { graphSnapshots, analysisResults, userPreferences, layoutPresets } from './schema.ts';

const log = scoped('db:repository');

const SCHEMA_TABLES = [graphSnapshots, analysisResults, userPreferences, layoutPresets] as const;

const require = createRequire(import.meta.url);

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

export interface SnapshotRecord {
  id: number;
  repoId: string;
  snapshotHash: string;
  nodeCount: number;
  edgeCount: number;
  data: Buffer | null;
  createdAt: number;
}

export interface AnalysisRecord {
  id: number;
  repoId: string;
  analysisType: string;
  targetNode: string | null;
  result: string;
  createdAt: number;
}

export interface LayoutPresetRecord {
  id: number;
  name: string;
  layoutType: string;
  positions: string;
}

const MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS graph_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, node_count INTEGER NOT NULL DEFAULT 0, edge_count INTEGER NOT NULL DEFAULT 0, data BLOB, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS analysis_results (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, analysis_type TEXT NOT NULL, target_node TEXT, result TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS user_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS layout_presets (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id TEXT NOT NULL, name TEXT NOT NULL, layout_type TEXT NOT NULL, positions TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_repo ON graph_snapshots(repo_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_repo_hash ON graph_snapshots(repo_id, snapshot_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_repo_created ON graph_snapshots(repo_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_repo_type ON analysis_results(repo_id, analysis_type)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_repo_type_node ON analysis_results(repo_id, analysis_type, IFNULL(target_node, ''))`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_repo_type_created ON analysis_results(repo_id, analysis_type, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_layout_presets_repo ON layout_presets(repo_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_layout_presets_repo_name ON layout_presets(repo_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_layout_presets_repo_created ON layout_presets(repo_id, created_at)`,
];

export class GraphRepository {
  private db: SqliteDb | null = null;
  private dbPath: string;

  constructor(workspacePath: string) {
    this.dbPath = join(workspacePath, '.codegraph-visualizer', 'viz.db');
  }

  init(): boolean {
    try {
      mkdirSync(join(this.dbPath, '..'), { recursive: true });
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      this.db = new DatabaseSync(this.dbPath) as unknown as SqliteDb;
      for (const sql of MIGRATION_SQL) {
        this.db!.exec(sql);
      }
      log.info('graph repository initialized', { path: this.dbPath, tables: SCHEMA_TABLES.length });
      return true;
    } catch (e) {
      log.warn('graph repository init failed', e);
      return false;
    }
  }

  saveSnapshot(repoId: string, hash: string, nodeCount: number, edgeCount: number, data: Buffer): void {
    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO graph_snapshots (repo_id, snapshot_hash, node_count, edge_count, data, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(repo_id, snapshot_hash) DO UPDATE SET node_count = excluded.node_count, edge_count = excluded.edge_count, data = excluded.data, created_at = excluded.created_at`,
      ).run(repoId, hash, nodeCount, edgeCount, data, Date.now());
    } catch (e) { log.warn('saveSnapshot failed', e); }
  }

  getLatestSnapshot(repoId: string): SnapshotRecord | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(
        `SELECT id, repo_id, snapshot_hash, node_count, edge_count, data, created_at FROM graph_snapshots WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1`,
      ).get(repoId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: row['id'] as number,
        repoId: row['repo_id'] as string,
        snapshotHash: row['snapshot_hash'] as string,
        nodeCount: row['node_count'] as number,
        edgeCount: row['edge_count'] as number,
        data: row['data'] as Buffer | null,
        createdAt: row['created_at'] as number,
      };
    } catch (e) { log.warn('getLatestSnapshot failed', e); return null; }
  }

  saveAnalysis(repoId: string, type: string, result: string, targetNode?: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(
        `DELETE FROM analysis_results WHERE repo_id = ? AND analysis_type = ? AND IFNULL(target_node, '') = IFNULL(?, '')`,
      ).run(repoId, type, targetNode ?? null);
      this.db.prepare(
        `INSERT INTO analysis_results (repo_id, analysis_type, target_node, result, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(repoId, type, targetNode ?? null, result, Date.now());
    } catch (e) { log.warn('saveAnalysis failed', e); }
  }

  getAnalysis(repoId: string, type: string, targetNode?: string): AnalysisRecord | null {
    if (!this.db) return null;
    try {
      const sql = targetNode
        ? `SELECT id, repo_id, analysis_type, target_node, result, created_at FROM analysis_results WHERE repo_id = ? AND analysis_type = ? AND target_node = ? ORDER BY created_at DESC LIMIT 1`
        : `SELECT id, repo_id, analysis_type, target_node, result, created_at FROM analysis_results WHERE repo_id = ? AND analysis_type = ? ORDER BY created_at DESC LIMIT 1`;
      const params = targetNode ? [repoId, type, targetNode] : [repoId, type];
      const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: row['id'] as number,
        repoId: row['repo_id'] as string,
        analysisType: row['analysis_type'] as string,
        targetNode: row['target_node'] as string | null,
        result: row['result'] as string,
        createdAt: row['created_at'] as number,
      };
    } catch (e) { log.warn('getAnalysis failed', e); return null; }
  }

  setPreference(key: string, value: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, value, Date.now());
    } catch (e) { log.warn('setPreference failed', e); }
  }

  getPreference(key: string): string | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(
        `SELECT value FROM user_preferences WHERE key = ?`,
      ).get(key) as Record<string, unknown> | undefined;
      return (row?.['value'] as string) ?? null;
    } catch (e) { log.warn('getPreference failed', e); return null; }
  }

  saveLayoutPreset(repoId: string, name: string, layoutType: string, positions: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(
        `INSERT INTO layout_presets (repo_id, name, layout_type, positions, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(repo_id, name) DO UPDATE SET layout_type = excluded.layout_type, positions = excluded.positions, created_at = excluded.created_at`,
      ).run(repoId, name, layoutType, positions, Date.now());
    } catch (e) { log.warn('saveLayoutPreset failed', e); }
  }

  getLayoutPresets(repoId: string): LayoutPresetRecord[] {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        `SELECT id, name, layout_type, positions FROM layout_presets WHERE repo_id = ? ORDER BY created_at DESC`,
      ).all(repoId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row['id'] as number,
        name: row['name'] as string,
        layoutType: row['layout_type'] as string,
        positions: row['positions'] as string,
      }));
    } catch (e) { log.warn('getLayoutPresets failed', e); return []; }
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  isReady(): boolean {
    return this.db !== null;
  }
}