#!/usr/bin/env node
/**
 * ANIC workflow snapshot generator — 薄封装。构建逻辑唯一实现于
 * src/shared/snapshotCore.ts（宿主热更新路由与生成器共用同一份代码）。
 *
 *   1. ../src/client/workflowGraphData.ts   (typed data module the client bundles)
 *   2. ../artifacts/workflow-snapshot.json  (provenance copy for audit)
 *
 * Requires Node >= 22.18 (native TS type stripping; profile runtime is Node 24).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflowSnapshot } from '../src/shared/snapshotCore.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..'); // repo root (dsh-anic/scripts/../..)
const CYCLES = join(ROOT, '.cycles');
const PLUGIN_DIR = 'dsh-anic'; // 插件目录名 = 包名（DSH 规范）；改名需同步此行

const snap = buildWorkflowSnapshot(CYCLES);
const { generatedAt, counts, autonomy, nodes, edges } = snap;

const ts = `/**
 * GENERATED FILE — do not edit by hand. Regenerate: pnpm --dir dsh-anic run snapshot
 * Source: real .cycles/ of the workspace (structured fields only; INV-21 compliant).
 * Generated at ${generatedAt}; counts = ${JSON.stringify(counts)}; autonomy = ${autonomy}.
 *
 * 热更新路径：客户端优先 GET /anic/api/workflow-snapshot 取 live 数据（同一构建器实现），
 * 路由不存在或失败时回退到本嵌入快照（多代宿主安全降级）。
 */
export interface WorkflowNode {
  id: string;
  type: 'phase' | 'micro-step' | 'gate' | 'human-gate' | 'cycle' | 'gate-event' | 'incident' | 'autonomy';
  label: string;
  x: number;
  y: number;
  result?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  type: string;
}

export interface WorkflowSnapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  autonomy: string;
  counts: {
    nodes: number;
    edges: number;
    cycles: number;
    ledgerEntries: number;
    incidents: number;
  };
}

export const WORKFLOW_SNAPSHOT: WorkflowSnapshot = ${JSON.stringify({ nodes, edges, autonomy, counts })};
`;

mkdirSync(join(ROOT, PLUGIN_DIR, 'src', 'client'), { recursive: true });
writeFileSync(join(ROOT, PLUGIN_DIR, 'src', 'client', 'workflowGraphData.ts'), ts);
mkdirSync(join(ROOT, PLUGIN_DIR, 'artifacts'), { recursive: true });
writeFileSync(join(ROOT, PLUGIN_DIR, 'artifacts', 'workflow-snapshot.json'), JSON.stringify({ generatedAt, autonomy, counts, nodes, edges }, null, 1));

console.log(`snapshot: ${JSON.stringify(counts)}, autonomy=${autonomy}`);
