import { describe, it, expect } from 'vitest';
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

function makeCall(caller: string, method: string, args: string[] = [], row = 0): ASTNode {
  const argNodes = args.map((a) => makeAstNode('identifier', a, [], row));
  return makeAstNode('call_expression', `${caller}.${method}(${args.join(', ')})`, [
    makeAstNode('member_expression', `${caller}.${method}`, [
      makeAstNode('identifier', caller, [], row),
      makeAstNode('property_identifier', method, [], row),
    ], row),
    makeAstNode('arguments', `(${args.join(', ')})`, argNodes, row),
  ], row);
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

function makeReturn(text: string, row = 0): ASTNode {
  return makeAstNode('return_statement', text, [], row);
}

function makeThrow(text: string, row = 0): ASTNode {
  return makeAstNode('throw_statement', text, [], row);
}

describe('SequenceAssembler', () => {
  const assembler = new SequenceAssembler();

  it('creates self participant for entry function', () => {
    const astRoot = makeAstNode('function_declaration', 'function myFunc() { x = 1; }', [
      makeAstNode('expression_statement', 'x = 1', [], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/myFunc.ts', 'myFunc');

    const selfNodes = result.nodes.filter((n) => n.properties.participantType === 'self');
    expect(selfNodes.length).toBe(1);
    expect(selfNodes[0]?.label).toBe('myFunc');
  });

  it('creates participant for external call receiver', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { db.query(sql); }', [
      makeCall('db', 'query', ['sql'], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const participants = result.nodes.filter((n) => n.properties.participantType !== undefined);
    expect(participants.length).toBeGreaterThanOrEqual(2);
    const dbParticipant = participants.find((p) => p.label === 'db');
    expect(dbParticipant).toBeDefined();
  });

  it('creates message edges for call expressions', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { db.query(sql); }', [
      makeCall('db', 'query', ['sql'], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    const callEdge = result.edges[0];
    expect(callEdge?.properties.methodName).toBe('query');
    expect(callEdge?.properties.arguments).toEqual(['sql']);
  });

  it('creates alt fragment for if-else', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { db.save(); } else { db.delete(); } }', [
      makeIf('x > 0', [makeCall('db', 'save', [], 2)], [makeCall('db', 'delete', [], 3)], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const fragmentNodes = result.nodes.filter((n) => n.properties.isFragment === true);
    expect(fragmentNodes.length).toBeGreaterThanOrEqual(1);
    const altFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'alt');
    expect(altFragment).toBeDefined();
  });

  it('creates opt fragment for if without else', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { db.save(); } }', [
      makeIf('x > 0', [makeCall('db', 'save', [], 2)], [], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const fragmentNodes = result.nodes.filter((n) => n.properties.isFragment === true);
    const optFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'opt');
    expect(optFragment).toBeDefined();
  });

  it('creates loop fragment for for statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (item of items) { db.save(item); } }', [
      makeFor('item of items', [makeCall('db', 'save', ['item'], 2)], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const fragmentNodes = result.nodes.filter((n) => n.properties.isFragment === true);
    const loopFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'loop');
    expect(loopFragment).toBeDefined();
  });

  it('creates return message for return statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { return 42; }', [
      makeReturn('return 42', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const returnEdges = result.edges.filter((e) => e.properties.isReturn === true);
    expect(returnEdges.length).toBeGreaterThanOrEqual(1);
    expect(returnEdges[0]?.properties.methodName).toBe('return');
  });

  it('creates break fragment for throw statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { throw new Error(); }', [
      makeThrow('throw new Error()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const fragmentNodes = result.nodes.filter((n) => n.properties.isFragment === true);
    const breakFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'break');
    expect(breakFragment).toBeDefined();
  });

  it('creates critical fragment for try block', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { db.save(); } catch (e) { log.error(); } }', [
      makeAstNode('try_statement', 'try { db.save(); } catch (e) { log.error(); }', [
        makeAstNode('block', '', [makeCall('db', 'save', [], 1)], 1),
        makeAstNode('catch_clause', 'catch (e)', [
          makeAstNode('block', '', [makeCall('log', 'error', [], 2)], 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const fragmentNodes = result.nodes.filter((n) => n.properties.isFragment === true);
    const criticalFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'critical');
    expect(criticalFragment).toBeDefined();
    const breakFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'break');
    expect(breakFragment).toBeDefined();
  });

  it('sets seqFunction property on all nodes', () => {
    const astRoot = makeAstNode('function_declaration', 'function myFunc() { db.query(); }', [
      makeCall('db', 'query', [], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/myFunc.ts', 'myFunc');

    for (const node of result.nodes) {
      expect(node.properties.seqFunction).toBe('myFunc');
    }
  });

  it('handles empty function body', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', []);
    const result = assembler.assemble(astRoot, 'src/empty.ts', 'empty');

    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    const selfNode = result.nodes.find((n) => n.properties.participantType === 'self');
    expect(selfNode).toBeDefined();
  });

  it('creates alt fragment for switch statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch (x) { case 1: db.save(); default: db.delete(); } }', [
      makeAstNode('switch_statement', 'switch (x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeCall('db', 'save', [], 2),
        ], 2),
        makeAstNode('default_statement', 'default:', [
          makeCall('db', 'delete', [], 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const fragmentNodes = result.nodes.filter((n) => n.properties.isFragment === true);
    const altFragment = fragmentNodes.find((f) => f.properties.fragmentType === 'alt');
    expect(altFragment).toBeDefined();
  });
});