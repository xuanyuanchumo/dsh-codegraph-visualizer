import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { graphSnapshots, analysisResults, userPreferences, layoutPresets } from './schema.ts';
import type { GraphSnapshot, NewGraphSnapshot, AnalysisResult, NewAnalysisResult, UserPreference, NewUserPreference, LayoutPreset, NewLayoutPreset } from './schema.ts';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('db:drizzle');

type SqliteDb = {
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
};

export type DrizzleDb = ReturnType<typeof createDrizzleDb>;

export function createDrizzleDb(db: SqliteDb) {
  const remoteCallback = (sql: string, params: unknown[], method: 'run' | 'all' | 'values' | 'get'): Promise<{ rows: unknown[] }> => {
    try {
      const stmt = db.prepare(sql);
      if (method === 'run') {
        stmt.run(...params);
        return Promise.resolve({ rows: [] });
      }
      if (method === 'get') {
        const row = stmt.get(...params);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      const rows = stmt.all(...params);
      return Promise.resolve({ rows });
    } catch (e) {
      log.warn('drizzle remote callback failed', { sql, method, e });
      return Promise.resolve({ rows: [] });
    }
  };

  const drizzleDb = drizzle(remoteCallback, {
    schema: { graphSnapshots, analysisResults, userPreferences, layoutPresets },
  });

  return {
    db: drizzleDb,

    async saveSnapshotAsync(repoId: string, hash: string, nodeCount: number, edgeCount: number, data: Buffer): Promise<void> {
      await drizzleDb.insert(graphSnapshots)
        .values({
          repoId,
          snapshotHash: hash,
          nodeCount,
          edgeCount,
          data,
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [graphSnapshots.repoId, graphSnapshots.snapshotHash],
          set: {
            nodeCount,
            edgeCount,
            data,
            createdAt: Date.now(),
          },
        });
    },

    async getLatestSnapshotAsync(repoId: string): Promise<GraphSnapshot | null> {
      const result = await drizzleDb.select()
        .from(graphSnapshots)
        .where(eq(graphSnapshots.repoId, repoId))
        .orderBy(desc(graphSnapshots.createdAt))
        .limit(1);
      return result[0] ?? null;
    },

    async saveAnalysisAsync(repoId: string, type: string, result: string, targetNode?: string): Promise<void> {
      await drizzleDb.insert(analysisResults)
        .values({
          repoId,
          analysisType: type,
          targetNode: targetNode ?? null,
          result,
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [analysisResults.repoId, analysisResults.analysisType, analysisResults.targetNode],
          set: {
            result,
            createdAt: Date.now(),
          },
        });
    },

    async getAnalysisAsync(repoId: string, type: string, targetNode?: string): Promise<AnalysisResult | null> {
      const conditions = targetNode
        ? and(eq(analysisResults.repoId, repoId), eq(analysisResults.analysisType, type), eq(analysisResults.targetNode, targetNode))
        : and(eq(analysisResults.repoId, repoId), eq(analysisResults.analysisType, type), isNull(analysisResults.targetNode));
      const result = await drizzleDb.select()
        .from(analysisResults)
        .where(conditions)
        .orderBy(desc(analysisResults.createdAt))
        .limit(1);
      return result[0] ?? null;
    },

    async setPreferenceAsync(key: string, value: string): Promise<void> {
      await drizzleDb.insert(userPreferences)
        .values({ key, value, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: userPreferences.key,
          set: { value, updatedAt: Date.now() },
        });
    },

    async getPreferenceAsync(key: string): Promise<string | null> {
      const result = await drizzleDb.select({ value: userPreferences.value })
        .from(userPreferences)
        .where(eq(userPreferences.key, key))
        .limit(1);
      return result[0]?.value ?? null;
    },

    async saveLayoutPresetAsync(repoId: string, name: string, layoutType: string, positions: string): Promise<void> {
      await drizzleDb.insert(layoutPresets)
        .values({
          repoId,
          name,
          layoutType,
          positions,
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [layoutPresets.repoId, layoutPresets.name],
          set: {
            layoutType,
            positions,
            createdAt: Date.now(),
          },
        });
    },

    async getLayoutPresetsAsync(repoId: string): Promise<LayoutPreset[]> {
      return drizzleDb.select()
        .from(layoutPresets)
        .where(eq(layoutPresets.repoId, repoId))
        .orderBy(desc(layoutPresets.createdAt));
    },
  };
}

export type { GraphSnapshot, NewGraphSnapshot, AnalysisResult, NewAnalysisResult, UserPreference, NewUserPreference, LayoutPreset, NewLayoutPreset };