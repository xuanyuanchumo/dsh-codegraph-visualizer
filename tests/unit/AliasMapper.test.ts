import { describe, it, expect } from 'vitest';
import {
  normalizeNodeType,
  normalizeEdgeType,
  is_valid_node_type,
  is_valid_edge_type,
  NODE_TYPE_ALIASES,
  EDGE_TYPE_ALIASES,
  VALID_NODE_TYPES,
  VALID_EDGE_TYPES,
} from '../../src/shared/AliasMapper.ts';

describe('normalizeNodeType', () => {
  it('returns valid node types directly', () => {
    expect(normalizeNodeType('function')).toBe('function');
    expect(normalizeNodeType('class')).toBe('class');
    expect(normalizeNodeType('variable')).toBe('variable');
    expect(normalizeNodeType('module')).toBe('module');
    expect(normalizeNodeType('interface')).toBe('interface');
    expect(normalizeNodeType('type')).toBe('type');
  });

  it('maps aliases to canonical types', () => {
    expect(normalizeNodeType('func')).toBe('function');
    expect(normalizeNodeType('fn')).toBe('function');
    expect(normalizeNodeType('method')).toBe('function');
    expect(normalizeNodeType('cls')).toBe('class');
    expect(normalizeNodeType('mod')).toBe('module');
    expect(normalizeNodeType('file')).toBe('module');
    expect(normalizeNodeType('pkg')).toBe('module');
    expect(normalizeNodeType('package')).toBe('module');
    expect(normalizeNodeType('iface')).toBe('interface');
    expect(normalizeNodeType('typ')).toBe('type');
    expect(normalizeNodeType('enum')).toBe('type');
    expect(normalizeNodeType('const')).toBe('variable');
    expect(normalizeNodeType('var')).toBe('variable');
    expect(normalizeNodeType('let')).toBe('variable');
  });

  it('returns null for non-string input', () => {
    expect(normalizeNodeType(42)).toBeNull();
    expect(normalizeNodeType(null)).toBeNull();
    expect(normalizeNodeType(undefined)).toBeNull();
    expect(normalizeNodeType({})).toBeNull();
    expect(normalizeNodeType(true)).toBeNull();
  });

  it('returns null for unknown type strings', () => {
    expect(normalizeNodeType('unknown')).toBeNull();
    expect(normalizeNodeType('')).toBeNull();
    expect(normalizeNodeType('function_class')).toBeNull();
  });
});

describe('normalizeEdgeType', () => {
  it('returns valid edge types directly', () => {
    expect(normalizeEdgeType('call')).toBe('call');
    expect(normalizeEdgeType('import')).toBe('import');
    expect(normalizeEdgeType('extend')).toBe('extend');
    expect(normalizeEdgeType('implement')).toBe('implement');
    expect(normalizeEdgeType('dependency')).toBe('dependency');
    expect(normalizeEdgeType('contains')).toBe('contains');
    expect(normalizeEdgeType('association')).toBe('association');
    expect(normalizeEdgeType('aggregation')).toBe('aggregation');
    expect(normalizeEdgeType('composition')).toBe('composition');
  });

  it('maps aliases to canonical types', () => {
    expect(normalizeEdgeType('calls')).toBe('call');
    expect(normalizeEdgeType('invoke')).toBe('call');
    expect(normalizeEdgeType('invokes')).toBe('call');
    expect(normalizeEdgeType('imports')).toBe('import');
    expect(normalizeEdgeType('import_from')).toBe('import');
    expect(normalizeEdgeType('extends')).toBe('extend');
    expect(normalizeEdgeType('inherits')).toBe('extend');
    expect(normalizeEdgeType('inherit')).toBe('extend');
    expect(normalizeEdgeType('implements')).toBe('implement');
    expect(normalizeEdgeType('implements_interface')).toBe('implement');
    expect(normalizeEdgeType('depends')).toBe('dependency');
    expect(normalizeEdgeType('depends_on')).toBe('dependency');
    expect(normalizeEdgeType('uses')).toBe('dependency');
    expect(normalizeEdgeType('contains_node')).toBe('contains');
    expect(normalizeEdgeType('owns')).toBe('contains');
    expect(normalizeEdgeType('has')).toBe('contains');
    expect(normalizeEdgeType('assoc')).toBe('association');
    expect(normalizeEdgeType('related')).toBe('association');
    expect(normalizeEdgeType('aggregates')).toBe('aggregation');
    expect(normalizeEdgeType('aggregate')).toBe('aggregation');
    expect(normalizeEdgeType('composes')).toBe('composition');
    expect(normalizeEdgeType('compose')).toBe('composition');
  });

  it('returns null for non-string input', () => {
    expect(normalizeEdgeType(42)).toBeNull();
    expect(normalizeEdgeType(null)).toBeNull();
    expect(normalizeEdgeType(undefined)).toBeNull();
    expect(normalizeEdgeType({})).toBeNull();
    expect(normalizeEdgeType(false)).toBeNull();
  });

  it('returns null for unknown type strings', () => {
    expect(normalizeEdgeType('unknown')).toBeNull();
    expect(normalizeEdgeType('')).toBeNull();
    expect(normalizeEdgeType('calls_imports')).toBeNull();
  });
});

describe('is_valid_node_type', () => {
  it('returns true for canonical node types', () => {
    expect(is_valid_node_type('function')).toBe(true);
    expect(is_valid_node_type('class')).toBe(true);
    expect(is_valid_node_type('variable')).toBe(true);
    expect(is_valid_node_type('module')).toBe(true);
    expect(is_valid_node_type('interface')).toBe(true);
    expect(is_valid_node_type('type')).toBe(true);
  });

  it('returns true for alias node types', () => {
    expect(is_valid_node_type('func')).toBe(true);
    expect(is_valid_node_type('fn')).toBe(true);
    expect(is_valid_node_type('method')).toBe(true);
    expect(is_valid_node_type('cls')).toBe(true);
    expect(is_valid_node_type('mod')).toBe(true);
    expect(is_valid_node_type('iface')).toBe(true);
    expect(is_valid_node_type('typ')).toBe(true);
    expect(is_valid_node_type('const')).toBe(true);
    expect(is_valid_node_type('var')).toBe(true);
    expect(is_valid_node_type('let')).toBe(true);
  });

  it('returns false for invalid node types', () => {
    expect(is_valid_node_type('unknown')).toBe(false);
    expect(is_valid_node_type('')).toBe(false);
    expect(is_valid_node_type('function_class')).toBe(false);
  });
});

describe('is_valid_edge_type', () => {
  it('returns true for canonical edge types', () => {
    expect(is_valid_edge_type('call')).toBe(true);
    expect(is_valid_edge_type('import')).toBe(true);
    expect(is_valid_edge_type('extend')).toBe(true);
    expect(is_valid_edge_type('implement')).toBe(true);
    expect(is_valid_edge_type('dependency')).toBe(true);
    expect(is_valid_edge_type('contains')).toBe(true);
    expect(is_valid_edge_type('association')).toBe(true);
    expect(is_valid_edge_type('aggregation')).toBe(true);
    expect(is_valid_edge_type('composition')).toBe(true);
  });

  it('returns true for alias edge types', () => {
    expect(is_valid_edge_type('calls')).toBe(true);
    expect(is_valid_edge_type('invoke')).toBe(true);
    expect(is_valid_edge_type('imports')).toBe(true);
    expect(is_valid_edge_type('extends')).toBe(true);
    expect(is_valid_edge_type('inherits')).toBe(true);
    expect(is_valid_edge_type('implements')).toBe(true);
    expect(is_valid_edge_type('depends')).toBe(true);
    expect(is_valid_edge_type('uses')).toBe(true);
    expect(is_valid_edge_type('owns')).toBe(true);
    expect(is_valid_edge_type('assoc')).toBe(true);
    expect(is_valid_edge_type('aggregates')).toBe(true);
    expect(is_valid_edge_type('composes')).toBe(true);
  });

  it('returns false for invalid edge types', () => {
    expect(is_valid_edge_type('unknown')).toBe(false);
    expect(is_valid_edge_type('')).toBe(false);
    expect(is_valid_edge_type('calls_imports')).toBe(false);
  });
});

describe('NODE_TYPE_ALIASES', () => {
  it('maps all aliases to valid canonical types', () => {
    for (const [alias, canonical] of Object.entries(NODE_TYPE_ALIASES)) {
      expect(VALID_NODE_TYPES.has(canonical)).toBe(true);
    }
  });
});

describe('EDGE_TYPE_ALIASES', () => {
  it('maps all aliases to valid canonical types', () => {
    for (const [alias, canonical] of Object.entries(EDGE_TYPE_ALIASES)) {
      expect(VALID_EDGE_TYPES.has(canonical)).toBe(true);
    }
  });
});