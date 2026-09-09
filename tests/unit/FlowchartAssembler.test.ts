import { describe, it, expect } from 'vitest';
import { FlowchartAssembler } from '../../src/client/diagram/FlowchartAssembler.ts';
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

describe('FlowchartAssembler', () => {
  const assembler = new FlowchartAssembler();

  it('creates start node for function entry', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { x = 1; }', [
      makeStatement('expression_statement', 'x = 1', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const startNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'start');
    expect(startNodes.length).toBe(1);
    expect(startNodes[0]?.label).toBe('开始');
  });

  it('creates end node for function exit', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { return 42; }', [
      makeStatement('return_statement', 'return 42', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const endNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'end');
    expect(endNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('creates decision node for if condition', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } }', [
      makeIf('x > 0', [makeStatement('expression_statement', 'y = 1', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const decisionNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'decision');
    expect(decisionNodes.length).toBeGreaterThanOrEqual(1);
    expect(decisionNodes[0]?.label).toContain('?');
  });

  it('creates yes/no edges for if condition', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } else { y = 2; } }', [
      makeIf('x > 0', [makeStatement('expression_statement', 'y = 1', 2)], [makeStatement('expression_statement', 'y = 2', 3)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const yesEdges = result.edges.filter((e) => e.properties.flowchartEdgeType === 'yes');
    const noEdges = result.edges.filter((e) => e.properties.flowchartEdgeType === 'no');
    expect(yesEdges.length).toBeGreaterThanOrEqual(1);
    expect(noEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates loop node for for/while statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (x of items) { process(x); } }', [
      makeFor('x of items', [makeStatement('expression_statement', 'process(x)', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'loop');
    expect(loopNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('creates error node for throw statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { throw new Error(); }', [
      makeStatement('throw_statement', 'throw new Error()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const errorNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'error');
    expect(errorNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('infers semantic labels from function call names', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { validateInput(data); }', [
      makeStatement('expression_statement', 'validateInput(data)', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'process');
    const validateNode = processNodes.find((n) => n.label === '验证');
    expect(validateNode).toBeDefined();
  });

  it('sets fcFunction property on all nodes', () => {
    const astRoot = makeAstNode('function_declaration', 'function myFunc() { x = 1; }', [
      makeStatement('expression_statement', 'x = 1', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/myFunc.ts', 'myFunc');

    for (const node of result.nodes) {
      expect(node.properties.fcFunction).toBe('myFunc');
    }
  });

  it('creates error edge for exception flow', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x = 1; } catch (e) { handleError(); } }', [
      makeAstNode('try_statement', 'try { x = 1; } catch (e) { handleError(); }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('catch_clause', 'catch (e)', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'handleError()', 2)], 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const errorEdges = result.edges.filter((e) => e.properties.flowchartEdgeType === 'error');
    expect(errorEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty function body', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', []);
    const result = assembler.assemble(astRoot, 'src/empty.ts', 'empty');

    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    const startNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'start');
    const endNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'end');
    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
  });
});