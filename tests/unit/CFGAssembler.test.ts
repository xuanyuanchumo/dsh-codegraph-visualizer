import { describe, it, expect } from 'vitest';
import { CFGAssembler } from '../../src/client/diagram/CFGAssembler.ts';
import type { ASTNode } from '../../src/client/diagram/CFGTypes.ts';

function makeAstNode(type: string, text: string, children: ASTNode[] = [], row = 0): ASTNode {
  return {
    type,
    text,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

function makeStatement(type: string, text: string, row = 0): ASTNode {
  return makeAstNode(type, text, [], row);
}

function makeIf(condition: string, trueBody: ASTNode[], falseBody: ASTNode[] = [], row = 0): ASTNode {
  const children: ASTNode[] = [
    makeAstNode('parenthesized_expression', condition, [], row),
    makeAstNode('block', '', trueBody, row),
  ];
  if (falseBody.length > 0) {
    children.push(makeAstNode('else_clause', '', [
      makeAstNode('block', '', falseBody, row),
    ], row));
  }
  return makeAstNode('if_statement', `if (${condition})`, children, row);
}

function makeFor(condition: string, body: ASTNode[], row = 0): ASTNode {
  return makeAstNode('for_statement', `for (${condition})`, [
    makeAstNode('parenthesized_expression', condition, [], row),
    makeAstNode('block', '', body, row),
  ], row);
}

function makeWhile(condition: string, body: ASTNode[], row = 0): ASTNode {
  return makeAstNode('while_statement', `while (${condition})`, [
    makeAstNode('parenthesized_expression', condition, [], row),
    makeAstNode('block', '', body, row),
  ], row);
}

describe('CFGAssembler', () => {
  const assembler = new CFGAssembler();

  it('creates Entry and Exit blocks for empty function', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', []);
    const result = assembler.assemble(astRoot, 'src/empty.ts', 'empty');

    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    const entryNode = result.nodes.find((n) => n.properties.isEntry === true);
    const exitNode = result.nodes.find((n) => n.properties.isExit === true);
    expect(entryNode).toBeDefined();
    expect(exitNode).toBeDefined();
    expect(result.metadata.rootIds).toContain(entryNode!.id);
  });

  it('creates process blocks for sequential statements', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { x = 1; y = 2; }', [
      makeStatement('expression_statement', 'x = 1', 1),
      makeStatement('expression_statement', 'y = 2', 2),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter((n) => n.properties.blockType === 'process');
    expect(processNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('creates condition block for if statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } }', [
      makeIf('x > 0', [makeStatement('expression_statement', 'y = 1', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const condNodes = result.nodes.filter((n) => n.properties.blockType === 'condition');
    expect(condNodes.length).toBe(1);
    expect(condNodes[0]?.label).toContain('x > 0');
  });

  it('creates true and false edges for if statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } else { y = 2; } }', [
      makeIf('x > 0', [makeStatement('expression_statement', 'y = 1', 2)], [makeStatement('expression_statement', 'y = 2', 3)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const trueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'true');
    const falseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'false');
    expect(trueEdges.length).toBeGreaterThanOrEqual(1);
    expect(falseEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates loop block for while statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { x--; } }', [
      makeWhile('x > 0', [makeStatement('expression_statement', 'x--', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
  });

  it('creates exit block for return statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { return 42; }', [
      makeStatement('return_statement', 'return 42', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const exitNodes = result.nodes.filter((n) => n.properties.isExit === true);
    expect(exitNodes.length).toBeGreaterThanOrEqual(1);
    const returnExit = exitNodes.find((n) => n.label === 'return');
    expect(returnExit).toBeDefined();
  });

  it('creates exception edge for throw statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { throw new Error(); }', [
      makeStatement('throw_statement', 'throw new Error()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const throwNodes = result.nodes.filter((n) => n.properties.isExit === true && n.label === 'throw');
    expect(throwNodes.length).toBe(1);
    const exceptionEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'exception');
    expect(exceptionEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates try and catch blocks for try-catch', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x = 1; } catch (e) { y = 2; } }', [
      makeAstNode('try_statement', 'try { x = 1; } catch (e) { y = 2; }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('catch_clause', 'catch (e)', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'y = 2', 2)], 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const tryNodes = result.nodes.filter((n) => n.properties.blockType === 'try');
    const catchNodes = result.nodes.filter((n) => n.properties.blockType === 'catch');
    expect(tryNodes.length).toBe(1);
    expect(catchNodes.length).toBe(1);
    const exceptionEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'exception');
    expect(exceptionEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates switch and case blocks', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch (x) { case 1: y = 1; default: y = 0; } }', [
      makeAstNode('switch_statement', 'switch (x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeStatement('expression_statement', 'y = 1', 2),
        ], 2),
        makeAstNode('default_statement', 'default:', [
          makeStatement('expression_statement', 'y = 0', 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const switchNodes = result.nodes.filter((n) => n.properties.blockType === 'switch');
    expect(switchNodes.length).toBe(1);
    const caseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'case');
    const defaultEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'default');
    expect(caseEdges.length).toBeGreaterThanOrEqual(1);
    expect(defaultEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('sets cfgFunction property on all nodes', () => {
    const astRoot = makeAstNode('function_declaration', 'function myFunc() { x = 1; }', [
      makeStatement('expression_statement', 'x = 1', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/myFunc.ts', 'myFunc');

    for (const node of result.nodes) {
      expect(node.properties.cfgFunction).toBe('myFunc');
    }
  });

  it('computes maxDepth in metadata', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x) { if (y) { z = 1; } } }', [
      makeIf('x', [makeIf('y', [makeStatement('expression_statement', 'z = 1', 3)])]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    expect(result.metadata.maxDepth).toBeGreaterThanOrEqual(2);
  });
});