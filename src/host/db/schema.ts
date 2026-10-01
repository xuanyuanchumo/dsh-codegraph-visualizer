import { sqliteTable, text, integer, blob, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const graphSnapshots = sqliteTable('graph_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: text('repo_id').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  nodeCount: integer('node_count').notNull().default(0),
  edgeCount: integer('edge_count').notNull().default(0),
  data: blob('data', { mode: 'buffer' }),
  createdAt: integer('created_at').notNull().default(0),
}, (t) => ({
  repoIdx: index('idx_snapshots_repo').on(t.repoId),
  repoHashUniq: uniqueIndex('idx_snapshots_repo_hash').on(t.repoId, t.snapshotHash),
}));

export const analysisResults = sqliteTable('analysis_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: text('repo_id').notNull(),
  analysisType: text('analysis_type').notNull(),
  targetNode: text('target_node'),
  result: text('result').notNull(),
  createdAt: integer('created_at').notNull().default(0),
}, (t) => ({
  repoTypeIdx: index('idx_analysis_repo_type').on(t.repoId, t.analysisType),
  repoTypeNodeUniq: uniqueIndex('idx_analysis_repo_type_node').on(t.repoId, t.analysisType, t.targetNode),
}));

export const userPreferences = sqliteTable('user_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(0),
});

export const layoutPresets = sqliteTable('layout_presets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: text('repo_id').notNull(),
  name: text('name').notNull(),
  layoutType: text('layout_type').notNull(),
  positions: text('positions').notNull(),
  createdAt: integer('created_at').notNull().default(0),
}, (t) => ({
  repoIdx: index('idx_layout_presets_repo').on(t.repoId),
  repoNameUniq: uniqueIndex('idx_layout_presets_repo_name').on(t.repoId, t.name),
}));

export type GraphSnapshot = typeof graphSnapshots.$inferSelect;
export type NewGraphSnapshot = typeof graphSnapshots.$inferInsert;
export type AnalysisResult = typeof analysisResults.$inferSelect;
export type NewAnalysisResult = typeof analysisResults.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
export type LayoutPreset = typeof layoutPresets.$inferSelect;
export type NewLayoutPreset = typeof layoutPresets.$inferInsert;