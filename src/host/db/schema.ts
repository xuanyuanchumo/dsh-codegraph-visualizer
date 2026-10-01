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
  repoCreatedIdx: index('idx_snapshots_repo_created').on(t.repoId, t.createdAt),
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
  // NOTE: The actual UNIQUE constraint uses IFNULL(target_node, '') to normalize NULL→''
  // (see MIGRATION_SQL in GraphRepository.ts). Drizzle ORM does not support expression
  // indexes via .on() — this declaration is an approximation for type inference only.
  // The runtime DDL is authored in MIGRATION_SQL and executed by db.exec().
  repoTypeNodeUniq: uniqueIndex('idx_analysis_repo_type_node').on(t.repoId, t.analysisType, t.targetNode),
  repoTypeCreatedIdx: index('idx_analysis_repo_type_created').on(t.repoId, t.analysisType, t.createdAt),
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
  repoCreatedIdx: index('idx_layout_presets_repo_created').on(t.repoId, t.createdAt),
}));

export type GraphSnapshot = typeof graphSnapshots.$inferSelect;
export type NewGraphSnapshot = typeof graphSnapshots.$inferInsert;
export type AnalysisResult = typeof analysisResults.$inferSelect;
export type NewAnalysisResult = typeof analysisResults.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
export type LayoutPreset = typeof layoutPresets.$inferSelect;
export type NewLayoutPreset = typeof layoutPresets.$inferInsert;