import { describe, it, expect } from 'vitest';
import { Trie } from '../../src/shared/Trie.ts';

describe('Trie', () => {
  it('insert and search for exact prefix', () => {
    const trie = new Trie();
    trie.insert('hello');
    trie.insert('help');
    trie.insert('world');
    const results = trie.search('hel');
    expect(results).toContain('hello');
    expect(results).toContain('help');
    expect(results).not.toContain('world');
  });

  it('hasPrefix returns true for valid prefix', () => {
    const trie = new Trie();
    trie.insert('function');
    expect(trie.hasPrefix('func')).toBe(true);
    expect(trie.hasPrefix('function')).toBe(true);
  });

  it('hasPrefix returns false for invalid prefix', () => {
    const trie = new Trie();
    trie.insert('function');
    expect(trie.hasPrefix('xyz')).toBe(false);
  });

  it('search returns empty array for non-existent prefix', () => {
    const trie = new Trie();
    trie.insert('hello');
    expect(trie.search('xyz')).toEqual([]);
  });

  it('handles case-insensitive search', () => {
    const trie = new Trie();
    trie.insert('MyFunction');
    const results = trie.search('myfunc');
    expect(results).toContain('MyFunction');
  });

  it('clears all entries', () => {
    const trie = new Trie();
    trie.insert('hello');
    trie.clear();
    expect(trie.search('hel')).toEqual([]);
    expect(trie.hasPrefix('hel')).toBe(false);
  });

  it('handles multiple words with same prefix', () => {
    const trie = new Trie();
    trie.insert('test');
    trie.insert('testing');
    trie.insert('tester');
    trie.insert('testcase');
    const results = trie.search('test');
    expect(results.length).toBe(4);
    expect(results).toContain('test');
    expect(results).toContain('testing');
    expect(results).toContain('tester');
    expect(results).toContain('testcase');
  });
});
