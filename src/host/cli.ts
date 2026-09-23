#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scoped } from '../shared/Logger.ts';
import type { GraphData, GraphNode, GraphEdge } from '../types/index.ts';

const log = scoped('cli');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface CliOptions {
  workspace: string;
  output: string;
  format: 'json' | 'html';
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    workspace: process.cwd(),
    output: 'codegraph-report',
    format: 'json',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' || args[i] === '-w') {
      opts.workspace = args[++i] || opts.workspace;
    } else if (args[i] === '--output' || args[i] === '-o') {
      opts.output = args[++i] || opts.output;
    } else if (args[i] === '--format' || args[i] === '-f') {
      const f = args[++i];
      if (f === 'json' || f === 'html') opts.format = f;
    } else if (args[i] === '--help' || args[i] === '-h') {
      log.info('Usage: dsh-codegraph-visualizer --report [options]');
      log.info('Options:');
      log.info('  -w, --workspace <path>  Workspace path (default: current directory)');
      log.info('  -o, --output <name>     Output file name (default: codegraph-report)');
      log.info('  -f, --format <format>   Output format: json or html (default: json)');
      process.exit(0);
    }
  }
  return opts;
}

function generateJsonReport(data: GraphData): string {
  const report = {
    metadata: {
      repoId: data.metadata.repoId,
      timestamp: new Date().toISOString(),
      nodeCount: data.metadata.nodeCount,
      edgeCount: data.metadata.edgeCount,
    },
    summary: {
      totalNodes: data.nodes.length,
      totalEdges: data.edges.length,
      nodeTypes: countNodeTypes(data.nodes),
      edgeTypes: countEdgeTypes(data.edges),
      topConnectedNodes: getTopConnectedNodes(data.nodes, data.edges, 10),
    },
    nodes: data.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      filePath: n.filePath,
      lineNumber: n.lineNumber,
    })),
    edges: data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    })),
  };
  return JSON.stringify(report, null, 2);
}

function generateHtmlReport(data: GraphData): string {
  const nodeTypes = countNodeTypes(data.nodes);
  const edgeTypes = countEdgeTypes(data.edges);
  const topNodes = getTopConnectedNodes(data.nodes, data.edges, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CodeGraph Report — ${escapeHtml(data.metadata.repoId)}</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
h1 { color: #1a73e8; }
h2 { margin-top: 30px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background: #f5f5f5; }
.stat { display: inline-block; margin: 10px 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; }
.stat-value { font-size: 24px; font-weight: bold; color: #1a73e8; }
.stat-label { font-size: 12px; color: #666; }
</style>
</head>
<body>
<h1>CodeGraph Architecture Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<p>Repository: ${escapeHtml(data.metadata.repoId)}</p>

<h2>Summary</h2>
<div class="stat"><div class="stat-value">${data.nodes.length}</div><div class="stat-label">Total Nodes</div></div>
<div class="stat"><div class="stat-value">${data.edges.length}</div><div class="stat-label">Total Edges</div></div>

<h2>Node Types</h2>
<table><tr><th>Type</th><th>Count</th></tr>
${Object.entries(nodeTypes).map(([type, count]) => `<tr><td>${escapeHtml(type)}</td><td>${count}</td></tr>`).join('')}
</table>

<h2>Edge Types</h2>
<table><tr><th>Type</th><th>Count</th></tr>
${Object.entries(edgeTypes).map(([type, count]) => `<tr><td>${escapeHtml(type)}</td><td>${count}</td></tr>`).join('')}
</table>

<h2>Top Connected Nodes</h2>
<table><tr><th>Node</th><th>Type</th><th>Connections</th></tr>
${topNodes.map((n) => `<tr><td>${escapeHtml(n.label)}</td><td>${escapeHtml(n.type)}</td><td>${n.connections}</td></tr>`).join('')}
</table>
</body>
</html>`;
}

function countNodeTypes(nodes: GraphNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  return counts;
}

function countEdgeTypes(edges: GraphEdge[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of edges) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}

function getTopConnectedNodes(nodes: GraphNode[], edges: GraphEdge[], limit: number): { label: string; type: string; connections: number }[] {
  const connectionCounts = new Map<string, number>();
  for (const e of edges) {
    connectionCounts.set(e.source, (connectionCounts.get(e.source) || 0) + 1);
    connectionCounts.set(e.target, (connectionCounts.get(e.target) || 0) + 1);
  }
  return nodes
    .map((n) => ({ label: n.label, type: n.type, connections: connectionCounts.get(n.id) || 0 }))
    .sort((a, b) => b.connections - a.connections)
    .slice(0, limit);
}

export async function runCli(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  log.info('CLI started', opts);

  const { fetchMergedGraph } = await import('../tools.ts');
  const data = await fetchMergedGraph(async (_tool: string, _toolArgs: Record<string, unknown>) => {
    return null;
  }, opts.workspace, 'both');

  if (data.nodes.length === 0 && data.edges.length === 0) {
    log.error('No graph data available. The CLI reads from .codegraph/codegraph.db in the workspace.');
    log.error('Ensure dsh-codegraph is installed and has been initialized:');
    log.error('  1. Install: dsh plugin add dsh-codegraph');
    log.error('  2. Initialize: run "codegraph init" in your workspace');
    log.error('  3. Or run this command from within a DSH workspace session');
    process.exit(1);
  }

  const reportContent = opts.format === 'html'
    ? generateHtmlReport(data)
    : generateJsonReport(data);

  const outputPath = resolve(`${opts.output}.${opts.format}`);
  writeFileSync(outputPath, reportContent, 'utf-8');
  log.info('Report generated', { path: outputPath, format: opts.format });

}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli(process.argv.slice(2)).catch((e) => {
    log.error('CLI failed:', e);
    process.exit(1);
  });
}