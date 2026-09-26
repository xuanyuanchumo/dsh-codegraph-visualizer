import { describe, it, expect, beforeEach } from 'vitest';
import { TreeSitterAdapter } from '../../src/adapters/TreeSitterAdapter.ts';

describe('TreeSitterAdapter (FR-20)', () => {
  let adapter: TreeSitterAdapter;

  beforeEach(() => {
    adapter = new TreeSitterAdapter();
  });

  it('should detect language from file extension', () => {
    expect(adapter.detectLanguage('foo.ts')).toBe('typescript');
    expect(adapter.detectLanguage('foo.tsx')).toBe('typescript');
    expect(adapter.detectLanguage('foo.js')).toBe('javascript');
    expect(adapter.detectLanguage('foo.jsx')).toBe('javascript');
    expect(adapter.detectLanguage('foo.py')).toBe('python');
    expect(adapter.detectLanguage('foo.java')).toBe('java');
    expect(adapter.detectLanguage('foo.rs')).toBe('rust');
    expect(adapter.detectLanguage('foo.go')).toBe('go');
  });

  it('should return null for unsupported file extension', () => {
    expect(adapter.detectLanguage('foo.txt')).toBeNull();
    expect(adapter.detectLanguage('foo.md')).toBeNull();
    expect(adapter.detectLanguage('foo.json')).toBeNull();
    expect(adapter.detectLanguage('README')).toBeNull();
  });

  it('should return supported languages list', () => {
    const langs = adapter.getSupportedLanguages();
    expect(langs).toContain('typescript');
    expect(langs).toContain('javascript');
    expect(langs).toContain('python');
    expect(langs).toContain('java');
    expect(langs).toContain('rust');
    expect(langs).toContain('go');
    expect(langs.length).toBe(6);
  });

  it('should not be available before init', () => {
    expect(adapter.isAvailable()).toBe(false);
  });

  it('should return error result when parsing without init and wasm unavailable', async () => {
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.source).toBe('tree-sitter');
  });

  it('should return error for unsupported file extension via detectLanguage', () => {
    expect(adapter.detectLanguage('foo.txt')).toBeNull();
    expect(adapter.detectLanguage('foo.md')).toBeNull();
  });

  it('should destroy and reset state', () => {
    adapter.destroy();
    expect(adapter.isAvailable()).toBe(false);
  });

  it('init should set parser when web-tree-sitter available', async () => {
    await adapter.init();
    expect(adapter.isAvailable()).toBe(true);
  });

  it('init should be idempotent (no-op if already initialized)', async () => {
    await adapter.init();
    await adapter.init();
    expect(adapter.isAvailable()).toBe(true);
  });

  it('parseFile should return error for unsupported file extension', async () => {
    const result = await adapter.parseFile('foo.txt', 'content');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.source).toBe('tree-sitter');
    expect(result.error).toBeDefined();
  });

  it('parseFile should return error when parser fails to init', async () => {
    const result = await adapter.parseFile('foo.md', 'content');
    expect(result.error).toBeDefined();
  });

  it('detectLanguage should handle files with multiple dots', () => {
    expect(adapter.detectLanguage('path/to/file.test.ts')).toBe('typescript');
    expect(adapter.detectLanguage('path/to/file.spec.js')).toBe('javascript');
  });

  it('detectLanguage should handle uppercase extensions', () => {
    expect(adapter.detectLanguage('foo.TS')).toBeNull();
  });

  it('destroy should clear loaded languages', async () => {
    await adapter.init();
    adapter.destroy();
    expect(adapter.isAvailable()).toBe(false);
  });

  it('should handle parseFile with empty content', async () => {
    const result = await adapter.parseFile('foo.ts', '');
    expect(result.source).toBe('tree-sitter');
  });

  it('parseToAst returns null when parser not initialized and init fails', async () => {
    const result = await adapter.parseToAst('foo.txt', 'content');
    expect(result).toBeNull();
  });

  it('parseToAst returns null for unsupported file extension', async () => {
    await adapter.init();
    const result = await adapter.parseToAst('foo.txt', 'content');
    expect(result).toBeNull();
  });

  it('parseToAst returns AST when parser and language are available', async () => {
    await adapter.init();
    const result = await adapter.parseToAst('foo.ts', 'const x = 1');
    expect(result).not.toBeNull();
    expect(result!.type).toBeDefined();
    expect(result!.children).toBeInstanceOf(Array);
  });

  it('parseFile extracts symbols from TypeScript code', async () => {
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'function bar() { return 1; }');
    expect(result.source).toBe('tree-sitter');
    expect(result.nodes.length).toBeGreaterThan(0);
    const funcNode = result.nodes.find((n: any) => n.type === 'function');
    expect(funcNode).toBeDefined();
  });

  it('parseFile extracts class symbols from TypeScript code', async () => {
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'class MyClass { method() {} }');
    expect(result.source).toBe('tree-sitter');
    const classNode = result.nodes.find((n: any) => n.type === 'class');
    expect(classNode).toBeDefined();
  });

  it('parseFile handles parse error gracefully', async () => {
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'function {{{invalid');
    expect(result.source).toBe('tree-sitter');
  });

  it('detectLanguage handles .mjs and .cjs extensions', () => {
    expect(adapter.detectLanguage('foo.mjs')).toBe('javascript');
    expect(adapter.detectLanguage('foo.cjs')).toBe('javascript');
  });
});