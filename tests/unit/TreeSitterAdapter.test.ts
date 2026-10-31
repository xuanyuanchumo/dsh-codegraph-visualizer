import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TreeSitterAdapter, isTreeSitterRuntimePresent } from '../../src/adapters/TreeSitterAdapter.ts';
import type { GraphNode } from '../../src/types/index.ts';
import type { ASTNode } from '../../src/shared/CFGTypes.ts';

/**
 * JSX inside a component body is exactly what the non-JSX `typescript` grammar cannot parse, and the
 * arrow component after it is what disappears from symbol extraction when the wrong grammar is used.
 */
const TSX_SOURCE = [
  "import React from 'react';",
  'export function Widget({ label }: { label: string }) {',
  '  return <div className="w"><span>{label}</span></div>;',
  '}',
  'export const Other = () => <p>hi</p>;',
  '',
].join('\n');

function countNodesOfType(node: ASTNode, type: string): number {
  let count = node.type === type ? 1 : 0;
  for (const child of node.children) count += countNodesOfType(child, type);
  return count;
}

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

  it('lazily initializes and extracts a symbol when init() was not called explicitly', async () => {
    const result = await adapter.parseFile('foo.ts', 'const x = 1');
    expect(result.error).toBeUndefined();
    expect(result.edges).toEqual([]);
    expect(result.source).toBe('tree-sitter');
    // Regression: this used to return no nodes at all. The old shared type table listed the
    // nameless `variable_declaration` *wrapper* instead of `variable_declarator` (the node that
    // carries the name), so the assertion below only ever held because of that bug.
    expect(result.nodes.map((n: GraphNode) => n.label)).toEqual(['x']);
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

  it('attributes contains edges to the ast origin (P1-N4: the first producer of that tier)', async () => {
    // 修前 `contains` 边的 `properties` 是 `{}`，于是 `GraphDataMerger` 的
    // `EDGE_ORIGIN_RANK.ast = 3`（最高档）**没有任何边能走到**——一条写在裁决表里、
    // 却永远不生效的规则。这里钉住三件事：
    //   · `edgeOrigin` 真的是 `'ast'`（不是 db、也不是缺失）；
    //   · `edgeLocatable` 为 true 且带 `line`（两端都在本文件里，源码可回溯）；
    //   · 每一行都有 line —— 不是只有第一条（循环里漏写是最常见的形态）。
    const code = 'class Foo {\n  bar() { return 1; }\n}';
    const result = await adapter.parseFile('foo.ts', code);
    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.length).toBeGreaterThan(0);
    for (const edge of containsEdges) {
      expect(edge.properties.edgeOrigin).toBe('ast');
      expect(edge.properties.edgeLocatable).toBe(true);
      expect(typeof edge.properties.line).toBe('number');
      expect(edge.properties.line as number).toBeGreaterThan(0);
    }
  });

  it('keeps the ast line number matching the child symbol node it points at', async () => {
    // line 必须是**目标节点**的行号，不是父节点的、也不是 0。写死一个常量也能让上面那条
    // 通过（只要它是 number 且 > 0），所以这里做一次真实的对应检查。
    const code = 'class Foo {\n  bar() { return 1; }\n  baz() { return 2; }\n}';
    const result = await adapter.parseFile('foo.ts', code);
    const byId = new Map(result.nodes.map((n) => [String(n.id), n]));
    const containsEdges = result.edges.filter((e) => e.type === 'contains');
    expect(containsEdges.length).toBeGreaterThan(0);
    for (const edge of containsEdges) {
      const target = byId.get(String(edge.target));
      expect(target).toBeDefined();
      expect(edge.properties.line).toBe(target!.lineNumber);
    }
  });

  it('reports whether the tree-sitter runtime is present', () => {
    // 能力位 `astSource` 的判据之一。这个仓的 node_modules 里两个包都在，
    // 所以这里期望 true；若它变 false，说明打包/安装形态变了，能力位会静默降级成
    // 「没有 AST 通道」——一个不会被任何界面断言发现的假阴性。
    expect(typeof isTreeSitterRuntimePresent()).toBe('boolean');
    expect(isTreeSitterRuntimePresent()).toBe(true);
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

  it('maps .tsx to the JSX-aware tsx grammar while still reporting TypeScript', () => {
    expect(adapter.detectGrammar('src/App.tsx')).toBe('tsx');
    expect(adapter.detectGrammar('src/App.ts')).toBe('typescript');
    expect(adapter.detectLanguage('src/App.tsx')).toBe('typescript');
    expect(adapter.detectGrammar('src/App.txt')).toBeNull();
  });

  it('parses .tsx without ERROR nodes (the plain typescript grammar cannot parse JSX)', async () => {
    const ast = await adapter.parseToAst('src/App.tsx', TSX_SOURCE);
    expect(ast).not.toBeNull();
    expect(countNodesOfType(ast!, 'ERROR')).toBe(0);
  });

  it('keeps the JSX arrow component as a symbol when parsing .tsx', async () => {
    const asTsx = await adapter.parseFile('src/App.tsx', TSX_SOURCE);
    expect(asTsx.error).toBeUndefined();
    // Same source through two grammars: the JSX-aware one must not lose symbols. Before the fix the
    // `typescript` grammar swallowed `const Other = () => <p/>` into an ERROR node, so the .tsx
    // result had strictly fewer nodes than the same text parsed as .ts.
    const asTs = await adapter.parseFile('src/App.ts', TSX_SOURCE);
    expect(asTs.nodes.length).toBeGreaterThan(0);
    expect(asTsx.nodes.length).toBeGreaterThanOrEqual(asTs.nodes.length);
  });
});

describe('TreeSitterAdapter per-grammar symbol types (real wasm)', () => {
  let adapter: TreeSitterAdapter;

  beforeEach(async () => {
    adapter = new TreeSitterAdapter();
    await adapter.init();
  });

  afterEach(() => {
    adapter.destroy();
  });

  const labelsOf = (nodes: GraphNode[], type: GraphNode['type']): string[] =>
    nodes.filter((n: GraphNode) => n.type === type).map((n: GraphNode) => n.label);

  /** Node types whose only possible label is the `<node.type>` placeholder — none may reach the graph. */
  const NAMELESS_WRAPPERS = [
    'lexical_declaration', 'variable_declaration', 'var_declaration', 'short_var_declaration',
    'type_declaration', 'field_declaration', 'struct_type', 'interface_type',
  ];

  it('extracts Rust functions, types and constants instead of dropping them', async () => {
    const code = [
      'use std::fmt;',
      'fn foo() {}',
      'struct Bar { x: i32 }',
      'enum Color { Red, Green }',
      'trait Shape { fn area(&self) -> i32; }',
      'impl Bar {',
      '  fn method(&self) {}',
      '}',
      'const LIMIT: i32 = 10;',
      'static GLOBAL: i32 = 1;',
      'fn main() { let x = 1; }',
    ].join('\n');
    const result = await adapter.parseFile('foo.rs', code);
    expect(result.source).toBe('tree-sitter');
    expect(result.error).toBeUndefined();

    const functions = labelsOf(result.nodes, 'function');
    // `function_item` was missing from the shared flat set, so every Rust function was invisible.
    expect(functions).toEqual(expect.arrayContaining(['foo', 'method', 'main', 'area']));

    const classes = labelsOf(result.nodes, 'class');
    // `impl_item` has no `name` field; its label must come from the `type` field, not `<impl_item>`.
    expect(classes).toEqual(expect.arrayContaining(['Bar', 'Color', 'Shape']));
    expect(classes).not.toContain('<impl_item>');

    const variables = labelsOf(result.nodes, 'variable');
    expect(variables).toEqual(expect.arrayContaining(['x', 'LIMIT', 'GLOBAL']));

    const modules = labelsOf(result.nodes, 'module');
    expect(modules.length).toBeGreaterThan(0);
  });

  it('extracts TypeScript symbols without the nameless declaration wrappers', async () => {
    const code = [
      'export function foo() {}',
      'export interface Shape { area(): number; }',
      'export type Alias = string;',
      'export enum Color { Red, Green }',
      'export class Bar { method() {} }',
      'const x = 1;',
      'let y = 2;',
    ].join('\n');
    const result = await adapter.parseFile('foo.ts', code);
    expect(result.error).toBeUndefined();

    expect(labelsOf(result.nodes, 'function')).toEqual(expect.arrayContaining(['foo', 'method']));
    expect(labelsOf(result.nodes, 'class')).toEqual(
      expect.arrayContaining(['Bar', 'Shape', 'Alias', 'Color']));
    // `variable_declarator` carries the name; the `lexical_declaration` wrapper does not.
    expect(labelsOf(result.nodes, 'variable')).toEqual(expect.arrayContaining(['x', 'y']));
    expect(result.nodes.some((n: GraphNode) => n.properties?.nodeType === 'variable_declaration')).toBe(false);
    expect(result.nodes.some((n: GraphNode) => n.properties?.nodeType === 'lexical_declaration')).toBe(false);
  });

  it('extracts JavaScript symbols', async () => {
    const code = 'function foo() {}\nclass Bar { method() {} }\nconst x = 1;';
    const result = await adapter.parseFile('foo.js', code);
    expect(labelsOf(result.nodes, 'function')).toEqual(expect.arrayContaining(['foo', 'method']));
    expect(labelsOf(result.nodes, 'class')).toContain('Bar');
    expect(labelsOf(result.nodes, 'variable')).toContain('x');
  });

  it('extracts Java constructors, interface methods and fields', async () => {
    const code = [
      'import java.util.List;',
      'public interface Shape { int area(); }',
      'public enum Color { RED }',
      'public class Bar {',
      '  private int global = 1;',
      '  public Bar() {}',
      '  public void method() {}',
      '}',
    ].join('\n');
    const result = await adapter.parseFile('Bar.java', code);
    expect(result.error).toBeUndefined();
    expect(labelsOf(result.nodes, 'function')).toEqual(expect.arrayContaining(['Bar', 'method', 'area']));
    expect(labelsOf(result.nodes, 'class')).toEqual(expect.arrayContaining(['Bar', 'Shape', 'Color']));
    expect(labelsOf(result.nodes, 'variable')).toContain('global');
  });

  it('extracts Go types, interface methods and specs', async () => {
    const code = [
      'package main',
      'import "fmt"',
      'func foo() {}',
      'type Bar struct { x int }',
      'type Shape interface { area() int }',
      'type Alias = int',
      'func (b Bar) method() {}',
      'var x = 1',
      'const K = 2',
    ].join('\n');
    const result = await adapter.parseFile('main.go', code);
    expect(result.error).toBeUndefined();
    expect(labelsOf(result.nodes, 'function')).toEqual(expect.arrayContaining(['foo', 'method', 'area']));
    expect(labelsOf(result.nodes, 'class')).toEqual(expect.arrayContaining(['Bar', 'Shape', 'Alias']));
    expect(labelsOf(result.nodes, 'variable')).toEqual(expect.arrayContaining(['x', 'K']));
  });

  it('extracts Python symbols', async () => {
    const code = 'import os\ndef foo():\n    pass\nclass Bar:\n    def method(self):\n        pass\nx = 1\n';
    const result = await adapter.parseFile('foo.py', code);
    expect(labelsOf(result.nodes, 'function')).toEqual(expect.arrayContaining(['foo', 'method']));
    expect(labelsOf(result.nodes, 'class')).toContain('Bar');
    expect(labelsOf(result.nodes, 'variable')).toContain('x');
  });

  it('never emits a nameless declaration wrapper as a symbol across all six grammars', async () => {
    const samples: Array<{ filePath: string; code: string }> = [
      { filePath: 'a.ts', code: 'const x = 1;\nlet y = 2;\nvar z = 3;\nfunction f() {}' },
      { filePath: 'a.js', code: 'const x = 1;\nlet y = 2;\nvar z = 3;\nfunction f() {}' },
      { filePath: 'a.py', code: 'x = 1\ndef f():\n    pass\n' },
      { filePath: 'a.java', code: 'class A { private int x = 1; void f() {} }' },
      { filePath: 'a.rs', code: 'fn f() { let x = 1; }\nconst K: i32 = 1;' },
      { filePath: 'a.go', code: 'package main\nvar x = 1\nconst K = 2\nfunc f() { y := 3 }' },
    ];
    for (const sample of samples) {
      const result = await adapter.parseFile(sample.filePath, sample.code);
      expect(result.error, sample.filePath).toBeUndefined();
      const wrappers = result.nodes.filter(
        (n: GraphNode) => NAMELESS_WRAPPERS.includes(String(n.properties?.nodeType)));
      expect(wrappers.map((n: GraphNode) => n.properties?.nodeType), sample.filePath).toEqual([]);
      const symbols = result.nodes.filter((n: GraphNode) => n.type !== 'module');
      expect(symbols.length, sample.filePath).toBeGreaterThan(0);
      for (const node of symbols) {
        // `<node.type>` placeholders stay allowed only where the grammar genuinely has no name.
        if (node.label.startsWith('<')) {
          expect(['arrow_function', 'closure_expression']).toContain(String(node.properties?.nodeType));
        }
      }
    }
  });
});

describe('TreeSitterAdapter per-grammar parser isolation (real wasm)', () => {
  it('parses a mixed-language batch without one grammar leaking into another', async () => {
    const adapter = new TreeSitterAdapter();
    await adapter.init();
    const mixed = await adapter.batchScan([
      { filePath: 'a.tsx', content: TSX_SOURCE },
      { filePath: 'b.ts', content: 'export function alpha() {}' },
      { filePath: 'c.py', content: 'def hello():\n    return 1' },
    ]);
    expect(mixed.error).toBeUndefined();
    const labels = mixed.nodes.map((n: GraphNode) => n.label);
    expect(labels).toContain('alpha');
    expect(labels).toContain('hello');
    // Both JSX-aware symbols of a.tsx must survive the *concurrent* batch: the old shared-parser
    // design set the language on one parser after an await, so a .ts sibling could win the race and
    // parse a.tsx with the plain typescript grammar, silently dropping the arrow component.
    const fromTsx = mixed.nodes.filter((n: GraphNode) => n.filePath === 'a.tsx' && n.type === 'function');
    expect(fromTsx.length).toBeGreaterThanOrEqual(2);
    adapter.destroy();
  });

  it('reuses one parser per grammar across repeated files', async () => {
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

  it('resolves wasm through tree-sitter-wasm only, then the bare file name', async () => {
    const attempted: string[] = [];
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async (path: string) => { attempted.push(path); throw new Error('all paths fail'); } },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: (lang: string) => `/pkg/out/${lang}/tree-sitter-${lang}.wasm`,
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    const result = await adapter.parseFile('App.tsx', 'const x = 1;');
    expect(result.error).toContain('Failed to load tsx');
    // Absolute package path first, bare file name last — and nothing else. The removed
    // `plugins/dsh-codegraph-visualizer/…`, `node_modules/web-tree-sitter/dist/…` and
    // `document.baseURI` candidates could never resolve: DSH serves no asset route for plugin files.
    expect(attempted).toEqual(['/pkg/out/tsx/tree-sitter-tsx.wasm', 'tree-sitter-tsx.wasm']);
    adapter.destroy();
  });

  it('never builds a browser URL even when document.baseURI exists', async () => {
    (globalThis as Record<string, unknown>).document = { baseURI: 'http://localhost:8080/' };
    const attempted: string[] = [];
    vi.doMock('web-tree-sitter', () => ({
      Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, childCount: 0, child: () => null, childForFieldName: () => null, children: [] }, delete() {} }; }
        delete() {}
      },
      Language: { load: async (path: string) => { attempted.push(path); throw new Error('all paths fail'); } },
    }));
    vi.doMock('tree-sitter-wasm', () => ({
      getWasmPath: () => { throw new Error('wasm path not available'); },
    }));
    vi.resetModules();
    const { TreeSitterAdapter: MockedAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const adapter = new MockedAdapter();
    await adapter.init();
    await adapter.parseFile('foo.ts', 'const x = 1');
    expect(attempted).toEqual(['tree-sitter-typescript.wasm']);
    expect(attempted.some((p) => p.includes('://'))).toBe(false);
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
  // ── 继承边提取（cycle-123，研究报告 Phase 1 P0 数据质量缺口）──────────
  // 量化缺口：上游索引对 interface extends 检出 0（本仓 17 处 extends 只出
  // 9 条 class→class）。AST heritage 提取是数据增补面。
  describe('heritage extraction (real wasm)', () => {
    let adapter: TreeSitterAdapter;

    beforeEach(async () => {
      adapter = new TreeSitterAdapter();
      await adapter.init();
    });

    afterEach(() => {
      adapter.destroy();
    });

    const heritageOf = (result: { edges: Array<{ type: string; source: string; target: string; properties?: Record<string, unknown> }> }) =>
      result.edges.filter((e) => e.type === 'extend' || e.type === 'implement');

    it('interface extends 提取 extend 边（extends_type_clause 形态）', async () => {
      const result = await adapter.parseFile('t.ts', 'export interface A { x: string }\nexport interface B extends A { y: number }\n');
      const h = heritageOf(result);
      expect(h).toHaveLength(1);
      expect(h[0]!.type).toBe('extend');
      expect(String(h[0]!.source)).toContain(':B:');
      expect(String(h[0]!.target)).toContain('<type>:A');
      expect(h[0]!.properties?.edgeOrigin).toBe('ast');
    });

    it('interface 多继承（extends A, C）逐目标各出一条', async () => {
      const result = await adapter.parseFile('t.ts', 'export interface A { }\nexport interface C { }\nexport interface B extends A, C { }\n');
      const h = heritageOf(result);
      expect(h).toHaveLength(2);
      expect(h.every((e) => e.type === 'extend')).toBe(true);
    });

    it('class implements + extends（class_heritage 两种 clause）', async () => {
      const code = 'export interface B { }\nexport interface C { }\nexport class D implements B, C { }\nexport class E extends D implements B { }\n';
      const result = await adapter.parseFile('t.ts', code);
      const h = heritageOf(result);
      // D implements B,C（2）+ E extends D（1）+ E implements B（1）= 4
      expect(h).toHaveLength(4);
      expect(h.filter((e) => e.type === 'implement').length).toBe(3);
      expect(h.filter((e) => e.type === 'extend').length).toBe(1);
    });

    it('自继承（X extends X）不产边', async () => {
      const result = await adapter.parseFile('t.ts', 'export interface X extends X { }\n');
      expect(heritageOf(result)).toHaveLength(0);
    });

    it('非声明节点（函数/变量）不触发 heritage 提取', async () => {
      const result = await adapter.parseFile('t.ts', 'const a = 1;\nfunction f() { return a; }\n');
      expect(heritageOf(result)).toHaveLength(0);
    });

    it('Python class 继承（superclasses 字段）提为 extend', async () => {
      const result = await adapter.parseFile('t.py', 'class B(A):\n    pass\n');
      const h = heritageOf(result);
      expect(h).toHaveLength(1);
      expect(h[0]!.type).toBe('extend');
    });
  });
});
