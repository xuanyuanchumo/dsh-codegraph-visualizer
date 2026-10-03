import { describe, it, expect } from 'vitest';
import { Trie } from '../../src/shared/Trie.ts';

describe('Trie', () => {
  it('insert and search for exact prefix', () => {
    const trie = new Trie();
    trie.insert('hello', 'node-1');
    trie.insert('help', 'node-2');
    trie.insert('world', 'node-3');
    const results = trie.search('hel');
    expect(results).toContain('node-1');
    expect(results).toContain('node-2');
    expect(results).not.toContain('node-3');
  });

  it('hasPrefix returns true for valid prefix', () => {
    const trie = new Trie();
    trie.insert('function', 'node-1');
    expect(trie.hasPrefix('func')).toBe(true);
    expect(trie.hasPrefix('function')).toBe(true);
  });

  it('hasPrefix returns false for invalid prefix', () => {
    const trie = new Trie();
    trie.insert('function', 'node-1');
    expect(trie.hasPrefix('xyz')).toBe(false);
  });

  it('search returns empty array for non-existent prefix', () => {
    const trie = new Trie();
    trie.insert('hello', 'node-1');
    expect(trie.search('xyz')).toEqual([]);
  });

  it('handles case-insensitive search', () => {
    const trie = new Trie();
    trie.insert('MyFunction', 'node-1');
    const results = trie.search('myfunc');
    expect(results).toContain('node-1');
  });

  it('clears all entries', () => {
    const trie = new Trie();
    trie.insert('hello', 'node-1');
    trie.clear();
    expect(trie.search('hel')).toEqual([]);
    expect(trie.hasPrefix('hel')).toBe(false);
  });

  it('handles multiple words with same prefix', () => {
    const trie = new Trie();
    trie.insert('test', 'node-1');
    trie.insert('testing', 'node-2');
    trie.insert('tester', 'node-3');
    trie.insert('testcase', 'node-4');
    const results = trie.search('test');
    expect(results.length).toBe(4);
    expect(results).toContain('node-1');
    expect(results).toContain('node-2');
    expect(results).toContain('node-3');
    expect(results).toContain('node-4');
  });

  it('stores multiple nodeIds for same label', () => {
    const trie = new Trie();
    trie.insert('foo', 'node-1');
    trie.insert('foo', 'node-2');
    const results = trie.search('foo');
    expect(results.length).toBe(2);
    expect(results).toContain('node-1');
    expect(results).toContain('node-2');
  });
});
