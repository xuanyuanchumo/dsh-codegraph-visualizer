import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

export const graphSnapshots = sqliteTable('graph_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: text('repo_id').notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  nodeCount: integer('node_count').notNull().default(0),
  edgeCount: integer('edge_count').notNull().default(0),
  data: blob('data', { mode: 'buffer' }),
  createdAt: integer('created_at').notNull().default(0),
});

export const analysisResults = sqliteTable('analysis_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: text('repo_id').notNull(),
  analysisType: text('analysis_type').notNull(),
  targetNode: text('target_node'),
  result: text('result').notNull(),
  createdAt: integer('created_at').notNull().default(0),
});

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
});