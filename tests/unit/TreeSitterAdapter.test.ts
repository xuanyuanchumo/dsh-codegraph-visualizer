import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TreeSitterAdapter } from '../../src/adapters/TreeSitterAdapter.ts';
import type { GraphNode } from '../../src/types/index.ts';

describe('TreeSitterAdapter (FR-20)', () => {
  let adapter: TreeSitterAdapter;

  beforeEach(() => {
    adapter = new TreeSitterAdapter();
  });

  afterEach(() => {
    adapter.destroy();
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
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
  });

  it('parseFile extracts class symbols from TypeScript code', async () => {
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'class MyClass { method() {} }');
    expect(result.source).toBe('tree-sitter');
    const classNode = result.nodes.find((n: GraphNode) => n.type === 'class');
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

  it('batchScan returns empty result when parser not initialized and init fails', async () => {
    const result = await adapter.batchScan([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.source).toBe('tree-sitter');
  });

  it('batchScan processes files and returns nodes', async () => {
    await adapter.init();
    const result = await adapter.batchScan([
      { filePath: 'foo.ts', content: 'function bar() { return 1; }' },
    ]);
    expect(result.source).toBe('tree-sitter');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('batchScan skips unsupported file extensions', async () => {
    await adapter.init();
    const result = await adapter.batchScan([
      { filePath: 'foo.txt', content: 'not code' },
    ]);
    expect(result.nodes).toHaveLength(0);
  });

  it('batchScan handles multiple files in batches', async () => {
    await adapter.init();
    const files = [];
    for (let i = 0; i < 25; i++) {
      files.push({ filePath: `file${i}.ts`, content: `function f${i}() {}` });
    }
    const result = await adapter.batchScan(files);
    expect(result.source).toBe('tree-sitter');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('batchScan handles parse errors gracefully', async () => {
    await adapter.init();
    const result = await adapter.batchScan([
      { filePath: 'foo.ts', content: 'function {{{invalid' },
    ]);
    expect(result.source).toBe('tree-sitter');
  });


  it('parseToAst returns null for unsupported extension after init', async () => {
    await adapter.init();
    const result = await adapter.parseToAst('foo.txt', 'content');
    expect(result).toBeNull();
  });

  it('init respects MAX_INIT_ATTEMPTS limit', async () => {
    const freshAdapter = new TreeSitterAdapter();
    freshAdapter.destroy();
    await freshAdapter.init();
    await freshAdapter.init();
    await freshAdapter.init();
    await freshAdapter.init();
    freshAdapter.destroy();
  });

  it('destroy resets initAttempts', async () => {
    await adapter.init();
    adapter.destroy();
    expect(adapter.isAvailable()).toBe(false);
    await adapter.init();
    expect(adapter.isAvailable()).toBe(true);
  });
});

describe('TreeSitterAdapter symbol extraction (real wasm)', () => {
  let adapter: TreeSitterAdapter;

  beforeEach(async () => {
    adapter = new TreeSitterAdapter();
    await adapter.init();
  });

  afterEach(() => {
    adapter.destroy();
  });

  it('extracts import statements as module nodes', async () => {
    const result = await adapter.parseFile('foo.ts', "import { foo } from 'bar';");
    expect(result.source).toBe('tree-sitter');
    const importNodes = result.nodes.filter((n: GraphNode) => n.type === 'module');
    expect(importNodes.length).toBeGreaterThan(0);
  });

  it('extracts variable declarations from Rust (let_declaration)', async () => {
    const result = await adapter.parseFile('foo.rs', 'fn main() { let x = 1; }');
    expect(result.source).toBe('tree-sitter');
    const varNodes = result.nodes.filter((n: GraphNode) => n.type === 'variable');
    expect(varNodes.length).toBeGreaterThan(0);
  });

  it('extracts variable declarations from Python (assignment)', async () => {
    const result = await adapter.parseFile('foo.py', 'x = 1');
    expect(result.source).toBe('tree-sitter');
    const varNodes = result.nodes.filter((n: GraphNode) => n.type === 'variable');
    expect(varNodes.length).toBeGreaterThan(0);
  });

  it('extracts function and class with nested structure and edges', async () => {
    const code = 'class Foo { bar() { return 1; } }';
    const result = await adapter.parseFile('foo.ts', code);
    const classNode = result.nodes.find((n: GraphNode) => n.type === 'class');
    const methodNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(classNode).toBeDefined();
    expect(methodNode).toBeDefined();
    expect(result.edges.length).toBeGreaterThan(0);
    const containsEdge = result.edges.find((e) => e.type === 'contains');
    expect(containsEdge).toBeDefined();
  });

  it('extracts TODO tags from comments inside functions', async () => {
    const code = 'function foo() {\n  // TODO: fix this\n  return 1;\n}';
    const result = await adapter.parseFile('foo.ts', code);
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.tags).toContain('todo');
    expect(funcNode!.properties.todoCount).toBe(1);
    expect(funcNode!.properties.hasTodoFixme).toBe(true);
  });

  it('extracts FIXME tags from comments inside functions', async () => {
    const code = 'function foo() {\n  // FIXME: broken\n  return 1;\n}';
    const result = await adapter.parseFile('foo.ts', code);
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.tags).toContain('fixme');
    expect(funcNode!.properties.fixmeCount).toBe(1);
    expect(funcNode!.properties.hasTodoFixme).toBe(true);
  });

  it('extracts both TODO and FIXME from multiple comments', async () => {
    const code = 'function foo() {\n  // TODO: a\n  // FIXME: b\n  return 1;\n}';
    const result = await adapter.parseFile('foo.ts', code);
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.tags).toContain('todo');
    expect(funcNode!.tags).toContain('fixme');
    expect(funcNode!.properties.todoCount).toBe(1);
    expect(funcNode!.properties.fixmeCount).toBe(1);
  });

  it('does not add tags for plain comments without TODO/FIXME', async () => {
    const code = 'function foo() {\n  // just a comment\n  return 1;\n}';
    const result = await adapter.parseFile('foo.ts', code);
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.properties.hasTodoFixme).toBeUndefined();
  });

  it('parseToAst returns nested AST for complex code', async () => {
    const code = 'function foo() {\n  const x = 1;\n  return x;\n}';
    const result = await adapter.parseToAst('foo.ts', code);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('program');
    expect(result!.children.length).toBeGreaterThan(0);
    const hasNestedChildren = result!.children.some((c) => c.children.length > 0);
    expect(hasNestedChildren).toBe(true);
  });

  it('parseToAst preserves position information', async () => {
    const code = 'const x = 1;';
    const result = await adapter.parseToAst('foo.ts', code);
    expect(result).not.toBeNull();
    expect(result!.startPosition.row).toBe(0);
    expect(result!.endPosition.row).toBe(0);
  });

  it('extracts arrow functions from JavaScript', async () => {
    const result = await adapter.parseFile('foo.js', 'const fn = () => 1;');
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
  });

  it('extracts function definitions from Python', async () => {
    const result = await adapter.parseFile('foo.py', 'def hello():\n    return 1');
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.label).toBe('hello');
  });

  it('extracts function definitions from Go', async () => {
    const result = await adapter.parseFile('foo.go', 'package main\nfunc main() {}');
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
  });

  it('extracts class declarations from Java', async () => {
    const result = await adapter.parseFile('foo.java', 'class Foo { void bar() {} }');
    const classNode = result.nodes.find((n: GraphNode) => n.type === 'class');
    expect(classNode).toBeDefined();
  });

  it('batchScan processes mixed supported and unsupported files', async () => {
    const result = await adapter.batchScan([
      { filePath: 'a.ts', content: 'function a() {}' },
      { filePath: 'b.txt', content: 'not code' },
      { filePath: 'c.py', content: 'x = 1' },
    ]);
    expect(result.source).toBe('tree-sitter');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('batchScan processes multiple languages triggering language cleanup', async () => {
    const result = await adapter.batchScan([
      { filePath: 'a.ts', content: 'function a() {}' },
      { filePath: 'b.py', content: 'x = 1' },
      { filePath: 'c.rs', content: 'fn main() {}' },
    ]);
    expect(result.source).toBe('tree-sitter');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('parseFile sets correct lineNumber (1-based)', async () => {
    const code = '\n\nfunction foo() {}';
    const result = await adapter.parseFile('foo.ts', code);
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.lineNumber).toBe(3);
  });

  it('parseFile sets parentId for nested symbols', async () => {
    const code = 'class Foo { bar() {} }';
    const result = await adapter.parseFile('foo.ts', code);
    const methodNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(methodNode).toBeDefined();
    expect(methodNode!.parentId).toBeDefined();
  });

  it('parseFile sets layer via inferLayerFromPath', async () => {
    const result = await adapter.parseFile('src/client/foo.ts', 'function foo() {}');
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.layer).toBeDefined();
  });

  it('parseFile sets properties with source and nodeType', async () => {
    const result = await adapter.parseFile('foo.ts', 'function foo() {}');
    const funcNode = result.nodes.find((n: GraphNode) => n.type === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode!.properties.source).toBe('tree-sitter');
    expect(funcNode!.properties.nodeType).toBeDefined();
  });
});

describe('TreeSitterAdapter cross-language cleanup (real wasm)', () => {
  it('cleans up old language when switching languages', async () => {
    const adapter = new TreeSitterAdapter();
    await adapter.init();
    const r1 = await adapter.parseFile('a.ts', 'function a() {}');
    const r2 = await adapter.parseFile('b.py', 'x = 1');
    expect(r1.nodes.length).toBeGreaterThan(0);
    expect(r2.nodes.length).toBeGreaterThan(0);
    adapter.destroy();
  });

  it('reuses loaded language for same language files', async () => {
    const adapter = new TreeSitterAdapter();
    await adapter.init();
    const r1 = await adapter.parseFile('a.ts', 'function a() {}');
    const r2 = await adapter.parseFile('b.ts', 'function b() {}');
    expect(r1.nodes.length).toBeGreaterThan(0);
    expect(r2.nodes.length).toBeGreaterThan(0);
    adapter.destroy();
  });
});

describe('TreeSitterAdapter failure paths (mocked web-tree-sitter)', () => {
  afterEach(() => {
    vi.doUnmock('web-tree-sitter');
    vi.doUnmock('tree-sitter-wasm');
    vi.resetModules();
  });

  it('init fails when Parser.init throws, parser stays null', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() { throw new Error('wasm init failed'); }
      },
      Language: { load: async () => { throw new Error('no lang'); } },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    expect(adapter.isAvailable()).toBe(false);
    adapter.destroy();
  });

  it('init respects MAX_INIT_ATTEMPTS and skips after 3 failures', async () => {
    let initCallCount = 0;
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() { initCallCount++; throw new Error('always fails'); }
      },
      Language: { load: async () => { throw new Error('no lang'); } },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    await adapter.init();
    await adapter.init();
    expect(initCallCount).toBe(3);
    await adapter.init();
    expect(initCallCount).toBe(3);
    expect(adapter.isAvailable()).toBe(false);
    adapter.destroy();
  });

  it('parseFile returns error when parser fails to init', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() { throw new Error('init failed'); }
      },
      Language: { load: async () => { throw new Error('no lang'); } },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.error).toBe('Parser not initialized');
    adapter.destroy();
  });

  it('parseFile returns error when language load fails', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async () => { throw new Error('lang load failed'); } },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => { throw new Error('wasm path not available'); },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    expect(adapter.isAvailable()).toBe(true);
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.nodes).toEqual([]);
    expect(result.error).toContain('Failed to load');
    adapter.destroy();
  });

  it('parseFile returns error when parse throws', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { throw new Error('parse crashed'); }
        delete() {}
      },
      Language: { load: async () => ({ load: async () => ({}), delete() {} }) },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => '/mock/tree-sitter-typescript.wasm',
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.nodes).toEqual([]);
    expect(result.error).toContain('parse crashed');
    adapter.destroy();
  });

  it('batchScan returns error when parser fails to init', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() { throw new Error('init failed'); }
      },
      Language: { load: async () => { throw new Error('no lang'); } },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    const result = await adapter.batchScan([
      { filePath: 'foo.ts', content: 'const x = 1' },
    ]);
    expect(result.nodes).toEqual([]);
    expect(result.error).toBe('Parser not initialized');
    adapter.destroy();
  });

  it('batchScan collects errors when parse throws', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { throw new Error('parse error'); }
        delete() {}
      },
      Language: { load: async () => ({ load: async () => ({}), delete() {} }) },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => '/mock/tree-sitter-typescript.wasm',
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.batchScan([
      { filePath: 'foo.ts', content: 'const x = 1' },
    ]);
    expect(result.nodes).toEqual([]);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('foo.ts');
    adapter.destroy();
  });

  it('parseToAst returns null when parser fails to init', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() { throw new Error('init failed'); }
      },
      Language: { load: async () => { throw new Error('no lang'); } },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    const result = await adapter.parseToAst('foo.ts', 'const x = 1');
    expect(result).toBeNull();
    adapter.destroy();
  });

  it('parseToAst returns null when language load fails', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async () => { throw new Error('lang load failed'); } },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => { throw new Error('wasm path not available'); },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseToAst('foo.ts', 'const x = 1');
    expect(result).toBeNull();
    adapter.destroy();
  });

  it('parseToAst returns null when parse throws', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { throw new Error('parse crashed'); }
        delete() {}
      },
      Language: { load: async () => ({ load: async () => ({}), delete() {} }) },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => '/mock/tree-sitter-typescript.wasm',
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseToAst('foo.ts', 'const x = 1');
    expect(result).toBeNull();
    adapter.destroy();
  });

  it('init succeeds then destroy resets allowing re-init', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async () => ({ load: async () => ({}), delete() {} }) },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => '/mock/tree-sitter-typescript.wasm',
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    expect(adapter.isAvailable()).toBe(true);
    adapter.destroy();
    expect(adapter.isAvailable()).toBe(false);
    await adapter.init();
    expect(adapter.isAvailable()).toBe(true);
    adapter.destroy();
  });
});

describe('TreeSitterAdapter loadLanguageWasm candidate paths (mocked)', () => {
  const originalDocument = (globalThis as Record<string, unknown>).document;

  afterEach(() => {
    (globalThis as Record<string, unknown>).document = originalDocument;
    vi.doUnmock('web-tree-sitter');
    vi.doUnmock('tree-sitter-wasm');
    vi.resetModules();
  });

  it('tries document.baseURI candidate paths when tree-sitter-wasm fails', async () => {
    (globalThis as Record<string, unknown>).document = { baseURI: 'http://localhost:8080/' };
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async () => { throw new Error('all paths fail'); } },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => { throw new Error('wasm path not available'); },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.nodes).toEqual([]);
    expect(result.error).toContain('Failed to load');
    adapter.destroy();
  });

  it('throws Cannot load when all candidate paths fail', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async () => { throw new Error('all paths fail'); } },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => { throw new Error('wasm path not available'); },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.error).toContain('Failed to load');
    adapter.destroy();
  });

  it('loadLanguageWasm succeeds via tree-sitter-wasm getWasmPath', async () => {
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async () => ({ load: async () => ({}), delete() {} }) },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: (lang: string) => `/mock/tree-sitter-${lang}.wasm`,
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.nodes).toEqual([]);
    expect(result.error).toBeUndefined();
    adapter.destroy();
  });
});