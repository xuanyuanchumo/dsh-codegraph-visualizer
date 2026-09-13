/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { CFGAssembler } from '../../src/client/diagram/CFGAssembler.ts';
import { FlowchartAssembler } from '../../src/client/diagram/FlowchartAssembler.ts';
import { SequenceAssembler } from '../../src/client/diagram/SequenceAssembler.ts';
import type { ASTNode } from '../../src/shared/CFGTypes.ts';

function makeAstNode(type: string, text: string, children: ASTNode[] = [], row = 0): ASTNode {
  return {
    type,
    text,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

describe('Chaos: Micro diagram assemblers with malformed inputs', () => {
  const cfgAssembler = new CFGAssembler();
  const flowchartAssembler = new FlowchartAssembler();
  const sequenceAssembler = new SequenceAssembler();

  it('CFGAssembler handles null children in AST node', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() {}', []);
    const result = cfgAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.edges.length).toBeGreaterThanOrEqual(0);
  });

  it('CFGAssembler handles deeply nested if statements (100 levels)', () => {
    let inner: ASTNode = makeAstNode('expression_statement', 'x = 1', 100);
    for (let i = 99; i >= 0; i--) {
      inner = makeAstNode('if_statement', `if (x${i})`, [
        makeAstNode('parenthesized_expression', `x${i}`, [], i),
        makeAstNode('block', '', [inner], i),
      ], i);
    }
    const astRoot = makeAstNode('function_declaration', 'function f() { ... }', [inner]);
    const result = cfgAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.metadata.maxDepth).toBeGreaterThanOrEqual(50);
  });

  it('CFGAssembler handles empty function body', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', []);
    const result = cfgAssembler.assemble(astRoot, 'src/empty.ts', 'empty');
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    const entryNode = result.nodes.find((n) => n.properties.isEntry === true);
    const exitNode = result.nodes.find((n) => n.properties.isExit === true);
    expect(entryNode).toBeDefined();
    expect(exitNode).toBeDefined();
  });

  it('CFGAssembler handles unknown statement types gracefully', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { ??? }', [
      makeAstNode('unknown_statement_type', '???', [], 1),
      makeAstNode('another_unknown', '!!!', [], 2),
    ]);
    const result = cfgAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('FlowchartAssembler handles empty function', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', []);
    const result = flowchartAssembler.assemble(astRoot, 'src/empty.ts', 'empty');
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    const startNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'start');
    const endNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'end');
    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
  });

  it('FlowchartAssembler handles deeply nested control flow', () => {
    let body: ASTNode[] = [makeAstNode('expression_statement', 'x = 1', 10)];
    for (let i = 9; i >= 0; i--) {
      const ifNode = makeAstNode('if_statement', `if (x${i})`, [
        makeAstNode('parenthesized_expression', `x${i}`, [], i),
        makeAstNode('block', '', body, i),
      ], i);
      body = [ifNode];
    }
    const astRoot = makeAstNode('function_declaration', 'function f() { ... }', body);
    const result = flowchartAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('FlowchartAssembler handles unknown block types', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { ??? }', [
      makeAstNode('completely_unknown', '???', [], 1),
    ]);
    const result = flowchartAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('SequenceAssembler handles empty function body', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', []);
    const result = sequenceAssembler.assemble(astRoot, 'src/empty.ts', 'empty');
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    const selfNode = result.nodes.find((n) => n.properties.participantType === 'self');
    expect(selfNode).toBeDefined();
  });

  it('SequenceAssembler handles deeply nested try-catch-finally', () => {
    let inner: ASTNode = makeAstNode('expression_statement', 'x = 1', 10);
    for (let i = 9; i >= 0; i--) {
      inner = makeAstNode('try_statement', 'try { ... } catch (e) { ... }', [
        makeAstNode('block', '', [inner], i),
        makeAstNode('catch_clause', 'catch (e)', [
          makeAstNode('block', '', [makeAstNode('expression_statement', 'handleError()', i)], i),
        ], i),
      ], i);
    }
    const astRoot = makeAstNode('function_declaration', 'function f() { ... }', [inner]);
    const result = sequenceAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('SequenceAssembler handles unknown AST node types', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { ??? }', [
      makeAstNode('totally_unknown_type', '???', [], 1),
      makeAstNode('another_mystery', '!!!', [], 2),
    ]);
    const result = sequenceAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('All assemblers handle very long function names', () => {
    const longName = 'a'.repeat(500);
    const astRoot = makeAstNode('function_declaration', `function ${longName}() {}`, []);
    const cfgResult = cfgAssembler.assemble(astRoot, 'src/f.ts', longName);
    const fcResult = flowchartAssembler.assemble(astRoot, 'src/f.ts', longName);
    const seqResult = sequenceAssembler.assemble(astRoot, 'src/f.ts', longName);
    expect(cfgResult.nodes.length).toBeGreaterThan(0);
    expect(fcResult.nodes.length).toBeGreaterThan(0);
    expect(seqResult.nodes.length).toBeGreaterThan(0);
  });

  it('All assemblers handle very long file paths', () => {
    const longPath = '/'.repeat(200) + 'file.ts';
    const astRoot = makeAstNode('function_declaration', 'function f() {}', []);
    const cfgResult = cfgAssembler.assemble(astRoot, longPath, 'f');
    const fcResult = flowchartAssembler.assemble(astRoot, longPath, 'f');
    const seqResult = sequenceAssembler.assemble(astRoot, longPath, 'f');
    expect(cfgResult.nodes[0]?.filePath).toBe(longPath);
    expect(fcResult.nodes[0]?.filePath).toBe(longPath);
    expect(seqResult.nodes[0]?.filePath).toBe(longPath);
  });

  it('All assemblers handle empty string function name', () => {
    const astRoot = makeAstNode('function_declaration', 'function () {}', []);
    const cfgResult = cfgAssembler.assemble(astRoot, 'src/f.ts', '');
    const fcResult = flowchartAssembler.assemble(astRoot, 'src/f.ts', '');
    const seqResult = sequenceAssembler.assemble(astRoot, 'src/f.ts', '');
    expect(cfgResult.nodes.length).toBeGreaterThan(0);
    expect(fcResult.nodes.length).toBeGreaterThan(0);
    expect(seqResult.nodes.length).toBeGreaterThan(0);
  });

  it('CFGAssembler handles switch with many cases', () => {
    const caseNodes: ASTNode[] = [];
    for (let i = 0; i < 50; i++) {
      caseNodes.push(makeAstNode('case_statement', `case ${i}:`, [
        makeAstNode('expression_statement', `x = ${i}`, i),
      ], i));
    }
    caseNodes.push(makeAstNode('default_statement', 'default:', [
      makeAstNode('expression_statement', 'x = 0', 50),
    ], 50));
    const astRoot = makeAstNode('function_declaration', 'function f() { switch(x) { ... } }', [
      makeAstNode('switch_statement', 'switch (x)', [
        makeAstNode('parenthesized_expression', 'x', [], 0),
        ...caseNodes,
      ], 0),
    ]);
    const result = cfgAssembler.assemble(astRoot, 'src/f.ts', 'f');
    expect(result.nodes.length).toBeGreaterThan(50);
  });

  it('SequenceAssembler handles many participants', () => {
    const calls: ASTNode[] = [];
    for (let i = 0; i < 30; i++) {
      calls.push(makeAstNode('call_expression', `obj${i}.method${i}()`, [
        makeAstNode('member_expression', `obj${i}.method${i}`, [
          makeAstNode('identifier', `obj${i}`, [], i),
          makeAstNode('property_identifier', `method${i}`, [], i),
        ], i),
        makeAstNode('arguments', '()', [], i),
      ], i));
    }
    const astRoot = makeAstNode('function_declaration', 'function f() { ... }', calls);
    const result = sequenceAssembler.assemble(astRoot, 'src/f.ts', 'f');
    const participants = result.nodes.filter((n) => n.properties.participantType !== undefined);
    expect(participants.length).toBeGreaterThanOrEqual(30);
  });
});