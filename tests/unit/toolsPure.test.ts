import { describe, it, expect } from 'vitest';
import {
  summarizeGraph,
  normalizeImpact,
  pickBestMatch,
  renderGraphStatus,
  renderGraphData,
  renderGraphSymbol,
  renderGraphImpact,
} from '../../src/tools.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

describe('tools pure functions', () => {
  it('summarizeGraph formats graph summary', () => {
    const data = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'class', 'b.ts', 2)],
      [makeEdge('e1', 'n1', 'n2', 'call')],
    );
    const summary = summarizeGraph(data);
    expect(summary).toContain('function:1');
    expect(summary).toContain('class:1');
    expect(summary).toContain('call:1');
    expect(summary).toContain('A (function)');
  });

  it('summarizeGraph with empty graph', () => {
    const data = makeGraphData([], []);
    const summary = summarizeGraph(data);
    expect(summary).toContain('0 nodes');
    expect(summary).toContain('0 edges');
  });

  it('normalizeImpact parses object with affected array', () => {
    const result = normalizeImpact({ affected: ['foo', 'bar'], depth: 3 });
    expect(result).toEqual({ affected: ['foo', 'bar'], depth: 3 });
  });

  it('normalizeImpact parses JSON string', () => {
    const result = normalizeImpact('{"affected":["x"],"depth":1}');
    expect(result).toEqual({ affected: ['x'], depth: 1 });
  });

  it('normalizeImpact returns null for invalid input', () => {
    expect(normalizeImpact(null)).toBeNull();
    expect(normalizeImpact(42)).toBeNull();
    expect(normalizeImpact('not-json')).toBeNull();
    expect(normalizeImpact({})).toBeNull();
    expect(normalizeImpact({ affected: 'not-array' })).toBeNull();
  });

  it('normalizeImpact handles node objects with name/id', () => {
    const result = normalizeImpact({ nodes: [{ name: 'fn1' }, { id: 'fn2' }] });
    expect(result).toEqual({ affected: ['fn1', 'fn2'], depth: 2 });
  });

  it('pickBestMatch finds exact name match', () => {
    const raw = [{ name: 'foo', kind: 'function', filePath: 'a.ts', startLine: 1 }];
    const result = pickBestMatch(raw, 'foo');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('foo');
    expect(result!.category).toBe('function');
  });

  it('pickBestMatch falls back to first item', () => {
    const raw = [{ name: 'bar', id: 'b1' }];
    const result = pickBestMatch(raw, 'nonexistent');
    expect(result).not.toBeNull();
    expect(result!.symbolId).toBe('nonexistent');
    expect(result!.name).toBe('bar');
  });

  it('pickBestMatch returns null for empty/null', () => {
    expect(pickBestMatch(null, 'x')).toBeNull();
    expect(pickBestMatch([], 'x')).toBeNull();
    expect(pickBestMatch('not-json', 'x')).toBeNull();
  });

  it('pickBestMatch parses JSON string', () => {
    const result = pickBestMatch('[{"name":"fn","id":"f1"}]', 'fn');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('fn');
  });

  it('renderGraphStatus formats status output', () => {
    const output = renderGraphStatus({}, { status: 'ready', nodeCount: 5, edgeCount: 3, sources: { codegraph: true, lens: false } });
    expect(output[0]!.text).toContain('ready');
    expect(output[0]!.text).toContain('5 nodes');
    expect(output[0]!.text).toContain('codegraph:✓');
    expect(output[0]!.text).toContain('lens:✗');
  });

  it('renderGraphStatus without sources', () => {
    const output = renderGraphStatus({}, { status: 'unavailable', nodeCount: 0, edgeCount: 0 });
    expect(output[0]!.text).toContain('unavailable');
    expect(output[0]!.text).not.toContain('codegraph');
  });

  it('renderGraphData formats graph data', () => {
    const data = makeGraphData([makeNode('n1', 'A', 'function', 'a.ts', 1)], []);
    const output = renderGraphData({}, data);
    expect(output[0]!.text).toContain('A (function)');
  });

  it('renderGraphSymbol formats symbol output', () => {
    const output = renderGraphSymbol({}, { name: 'myFn', category: 'function', file: 'a.ts', line: 10 });
    expect(output[0]!.text).toContain('myFn');
    expect(output[0]!.text).toContain('a.ts:10');
  });

  it('renderGraphSymbol handles null value', () => {
    const output = renderGraphSymbol({}, null);
    expect(output[0]!.text).toContain('not found');
  });

  it('renderGraphImpact formats impact output', () => {
    const output = renderGraphImpact({}, { affected: ['fn1', 'fn2'], depth: 2 });
    expect(output[0]!.text).toContain('2 symbols affected');
    expect(output[0]!.text).toContain('depth 2');
  });

  it('renderGraphImpact with empty affected', () => {
    const output = renderGraphImpact({}, { affected: [], depth: 0 });
    expect(output[0]!.text).toContain('0 symbols affected');
  });
});