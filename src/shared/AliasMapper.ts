import type { GraphNode, GraphEdge } from '../types/index.ts';

const NODE_TYPE_ALIASES: Record<string, GraphNode['type']> = {
  func: 'function',
  fn: 'function',
  method: 'function',
  cls: 'class',
  mod: 'module',
  file: 'module',
  pkg: 'module',
  package: 'module',
  iface: 'interface',
  typ: 'type',
  enum: 'type',
  const: 'variable',
  var: 'variable',
  let: 'variable',
};

const EDGE_TYPE_ALIASES: Record<string, GraphEdge['type']> = {
  calls: 'call',
  invoke: 'call',
  invokes: 'call',
  imports: 'import',
  import_from: 'import',
  extends: 'extend',
  inherits: 'extend',
  inherit: 'extend',
  implements: 'implement',
  implements_interface: 'implement',
  depends: 'dependency',
  depends_on: 'dependency',
  uses: 'dependency',
  contains_node: 'contains',
  owns: 'contains',
  has: 'contains',
  assoc: 'association',
  related: 'association',
  aggregates: 'aggregation',
  aggregate: 'aggregation',
  composes: 'composition',
  compose: 'composition',
};

const VALID_NODE_TYPES = new Set(['function', 'class', 'variable', 'module', 'interface', 'type']);
const VALID_EDGE_TYPES = new Set(['call', 'import', 'extend', 'implement', 'dependency', 'contains', 'association', 'aggregation', 'composition']);

export function normalizeNodeType(type: unknown): GraphNode['type'] | null {
  if (typeof type !== 'string') return null;
  if (VALID_NODE_TYPES.has(type as GraphNode['type'])) return type as GraphNode['type'];
  const alias = NODE_TYPE_ALIASES[type];
  if (alias) return alias;
  return null;
}

export function normalizeEdgeType(type: unknown): GraphEdge['type'] | null {
  if (typeof type !== 'string') return null;
  if (VALID_EDGE_TYPES.has(type as GraphEdge['type'])) return type as GraphEdge['type'];
  const alias = EDGE_TYPE_ALIASES[type];
  if (alias) return alias;
  return null;
}

export function is_valid_node_type(type: string): boolean {
  return VALID_NODE_TYPES.has(type as GraphNode['type']) || type in NODE_TYPE_ALIASES;
}

export function is_valid_edge_type(type: string): boolean {
  return VALID_EDGE_TYPES.has(type as GraphEdge['type']) || type in EDGE_TYPE_ALIASES;
}

export { NODE_TYPE_ALIASES, EDGE_TYPE_ALIASES, VALID_NODE_TYPES, VALID_EDGE_TYPES };