// Pure utility functions for graph tools — extracted from tools.ts to avoid
// indirect adapter module loading in tests (v8 coverage module-isolation bug).
import type { GraphData } from './types/index.ts';

export function summarizeGraph(data: GraphData): string {
  const nodeByType = new Map<string, number>();
  const edgeByType = new Map<string, number>();
  for (const n of data.nodes) nodeByType.set(n.type, (nodeByType.get(n.type) ?? 0) + 1);
  for (const e of data.edges) edgeByType.set(e.type, (edgeByType.get(e.type) ?? 0) + 1);

  const nodeStats = [...nodeByType.entries()].map(([t, c]) => `${t}:${c}`).join(', ');
  const edgeStats = [...edgeByType.entries()].map(([t, c]) => `${t}:${c}`).join(', ');

  const topNodes = data.nodes.slice(0, 10)
    .map(n => `  • ${n.label} (${n.type}) @ ${n.filePath}:${n.lineNumber}`)
    .join('\n');

  const topEdges = data.edges.slice(0, 10)
    .map(e => `  ${e.source} →${e.type}→ ${e.target}`)
    .join('\n');

  return [
    `Graph: ${data.metadata.nodeCount} nodes [${nodeStats}], ${data.metadata.edgeCount} edges [${edgeStats}]`,
    topNodes ? `\nTop nodes:\n${topNodes}` : '',
    topEdges ? `\nTop edges:\n${topEdges}` : '',
  ].join('');
}

export function normalizeImpact(raw: unknown): { affected: string[]; depth: number } | null {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) as unknown; } catch (_e) { /* JSON parse failed */ return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const list = obj.affected ?? obj.affectedNodes ?? obj.nodes;
  if (!Array.isArray(list)) return null;
  return {
    affected: list.map((it) => {
      if (typeof it === 'string') return it;
      const rec = it as Record<string, unknown>;
      return String(rec.name ?? rec.id ?? '?');
    }),
    depth: typeof obj.depth === 'number' ? obj.depth : 2,
  };
}

export function pickBestMatch(raw: unknown, symbolId: string): Record<string, unknown> | null {
  let payload = raw;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) as unknown; } catch (_e) { /* JSON parse failed */ return null; }
  }
  const items = Array.isArray(payload)
    ? payload
    : (payload as Record<string, unknown>)?.results ?? (payload as Record<string, unknown>)?.nodes;
  if (!Array.isArray(items) || items.length === 0) return null;
  const wanted = symbolId.toLowerCase();
  const best = items.find((it) => {
    const rec = it as Record<string, unknown>;
    return String(rec.name ?? '').toLowerCase() === wanted || rec.id === symbolId;
  }) as Record<string, unknown> | undefined;
  const chosen = best ?? (items[0] as Record<string, unknown>);
  return {
    symbolId,
    name: chosen.name ?? chosen.qualified_name ?? symbolId,
    category: chosen.kind ?? 'unknown',
    file: chosen.filePath ?? chosen.file_path ?? '?',
    line: chosen.startLine ?? chosen.start_line ?? 0,
    signature: chosen.signature ?? null,
  };
}

export function renderGraphStatus(_args: unknown, value: unknown) {
  const v = value as { status: string; nodeCount: number; edgeCount: number; sources?: Record<string, boolean> };
  const srcInfo = v.sources ? ` [codegraph:${v.sources.codegraph ? '✓' : '✗'} lens:${v.sources.lens ? '✓' : '✗'}]` : '';
  return [
    { type: 'text' as const, text: `Graph status: ${v.status} (${v.nodeCount} nodes, ${v.edgeCount} edges)${srcInfo}` },
  ];
}

export function renderGraphData(_args: unknown, value: unknown) {
  const data = value as unknown as GraphData;
  return [{ type: 'text' as const, text: summarizeGraph(data) }];
}

export function renderGraphSymbol(_args: unknown, value: unknown) {
  const v = value as { name?: string; file?: string; line?: number; category?: string; symbolId?: string } | null;
  if (!v) return [{ type: 'text' as const, text: 'Symbol not found.' }];
  return [{ type: 'text' as const, text: `${v.name ?? v.symbolId ?? '?'} (${v.category ?? 'unknown'}) @ ${v.file ?? '?'}:${v.line ?? '?'}` }];
}

export function renderGraphImpact(_args: unknown, value: unknown) {
  const v = value as { affected?: string[]; depth?: number };
  const count = v.affected?.length ?? 0;
  const list = v.affected?.slice(0, 10).join(', ') ?? '';
  return [{ type: 'text' as const, text: `Impact: ${count} symbols affected (depth ${v.depth ?? 0})${list ? `\n  ${list}` : ''}` }];
}