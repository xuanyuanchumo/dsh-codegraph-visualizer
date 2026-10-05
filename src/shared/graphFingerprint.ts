import type { GraphData, GraphEdge, GraphNode } from '../types/index.ts';
import { FINGERPRINT } from './constants.ts';

/**
 * Structural fingerprint + content hash for the code graph (P0-6).
 *
 * Why this exists: snapshot rows used to be keyed by
 * `${nodeCount}:${edgeCount}:${metadata.timestamp}`, so every scan produced a brand-new hash.
 * `idx_snapshots_repo_hash UNIQUE(repo_id, snapshot_hash)` could therefore never fire, and
 * `pruneSnapshots()` was the only thing bounding the table.
 *
 * The fingerprint is derived purely from graph *content* (ids, structural fields and properties)
 * and deliberately excludes `metadata.timestamp`, so two scans of an unchanged repository produce
 * the same value and the snapshot write becomes idempotent.
 *
 * The digest is implemented in plain arithmetic rather than `node:crypto`: this module lives under
 * `src/shared/**`, which `tsconfig.client.json` type-checks and `scripts/build-client.mjs` pulls
 * into the browser bundle. It is a change-detection hash, not a cryptographic digest.
 */

/** Separates fields inside one canonical record; never appears in adapter-produced values. */
const FIELD_SEP = '\u0001';
/** Separates records in the hashed payload. */
const RECORD_SEP = '\u0002';

/** Standard FNV-1a 32-bit offset basis and prime. */
const FNV_OFFSET_A = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** A second, independent lane keeps the combined digest 64-bit wide. */
const FNV_OFFSET_B = 0x9e3779b9;

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * Two independent FNV-1a 32-bit lanes combined into a 64-bit (16 hex digit) digest. `Math.imul`
 * gives the exact 32-bit multiplication FNV requires without BigInt, so hashing a multi-megabyte
 * payload stays cheap.
 */
export function hash64(input: string): string {
  let a = FNV_OFFSET_A;
  let b = FNV_OFFSET_B;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ (code & 0xff), FNV_PRIME);
    b = Math.imul(b ^ (code & 0xff), FNV_PRIME);
    const high = code >>> 8;
    if (high !== 0) {
      a = Math.imul(a ^ high, FNV_PRIME);
      b = Math.imul(b ^ high, FNV_PRIME);
    }
  }
  return toHex32(a) + toHex32(b);
}

/**
 * Deterministic JSON-ish serialisation: object keys are sorted recursively and `undefined`
 * object values are dropped, so two structurally equal values always render identically.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'bigint') return `${String(value)}n`;
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  // Functions and symbols never appear in adapter-produced graph payloads.
  return 'null';
}

/**
 * Canonical record for one node. Ordering, whitespace and `metadata` never leak in; only the
 * fields that describe the node's identity and structure do.
 */
export function canonicalizeNode(node: GraphNode): string {
  return [
    'n',
    node.id,
    node.label,
    node.type,
    node.filePath,
    String(node.lineNumber ?? 0),
    node.parentId ?? '',
    node.layer ?? '',
    stableStringify(node.properties ?? {}),
  ].join(FIELD_SEP);
}

/** Canonical record for one edge. `id` participates, so re-keyed edges count as a change. */
export function canonicalizeEdge(edge: GraphEdge): string {
  return [
    'e',
    edge.id,
    edge.source,
    edge.target,
    edge.type,
    edge.direction ?? '',
    edge.weight === undefined ? '' : String(edge.weight),
    stableStringify(edge.properties ?? {}),
  ].join(FIELD_SEP);
}

/**
 * Hash of a raw text payload (a file's source, a serialized graph). Used by the tree-sitter route
 * so identical input is recognisable without re-parsing.
 */
export function computeContentHash(content: string): string {
  return `v${FINGERPRINT.VERSION}:${hash64(content)}`;
}

/** 会被 ETag 定域的数据端点。`/data` 之外的路由返回的都是派生数据，与缓存图不是同一份资源。 */
export type GraphEtagResource = 'graph' | 'bootstrap' | 'children' | 'outline' | 'ast' | 'edges';

/**
 * ETag for a graph resource, **scoped to both the workspace identity and the resource dimension**.
 *
 * 为什么不能只回 `String(metadata.timestamp)`：host 只保留一个 `lastGraphData` 槽，槽里可能装着另一个
 * 工作区的图。若校验值只有时间戳，两个工作区在毫秒级上撞到同一个 timestamp 时，客户端带着 A 工作区
 * 的校验值去问 B 工作区，host 会回 304，客户端于是保留旧画布并**静默丢弃一次真实更新**。把 `repoId`
 * 混进校验值后，不同工作区的 ETag 必然不同，"校验器与被校验资源无关"这类缺陷在结构上不再可能。
 *
 * 为什么还要 `resource` 维度：`/data`、`/bootstrap`、`/children`、`/outline`、`/ast`、`/edges` 全都拿
 * 同一个单槽缓存图去比对。若校验值不含资源维度，客户端持有的 `/data` 校验值就能让 `/children` 回
 * 304——"校验器与被校验资源无关"的同一条缺陷换了个形状。该参数**必填**（不给默认值）：任何新增调用点
 * 都被类型检查强制回答"我校验的是哪一份资源"，与 `fetchGraphDataIncremental` 的 `scopeRepoId` 同一设计。
 *
 * 值仍然是"弱校验器"语义（`W/` 前缀）：它随内容变化，但不是逐字节摘要。刻意**不**改用
 * `computeGraphFingerprint()`——指纹要遍历全部节点与边，而 ETag 在每次 `/data` 请求上都会被计算；
 * 这里的目的是**身份定域**，不是内容寻址。
 */
export function computeGraphEtag(
  repoId: string | null | undefined,
  revision: number,
  resource: GraphEtagResource,
): string {
  return `W/"${revision}-${hash64(`${resource}\u0001${repoId ?? ''}`)}"`;
}

/**
 * Fingerprint of a graph's content. Independent of node/edge ordering and of `metadata.timestamp`,
 * so it is stable across repeated scans of an unchanged repository.
 */
export function computeGraphFingerprint(data: GraphData): string {
  const nodeLines = data.nodes.map(canonicalizeNode).sort();
  const edgeLines = data.edges.map(canonicalizeEdge).sort();
  const meta = data.metadata;
  const header = [
    `nodes=${nodeLines.length}`,
    `edges=${edgeLines.length}`,
    `totalNodes=${meta.totalNodeCount ?? nodeLines.length}`,
    `totalEdges=${meta.totalEdgeCount ?? edgeLines.length}`,
    `truncated=${meta.truncated === true ? 1 : 0}`,
  ].join(FIELD_SEP);
  return `v${FINGERPRINT.VERSION}:${hash64([header, ...nodeLines, ...edgeLines].join(RECORD_SEP))}`;
}
