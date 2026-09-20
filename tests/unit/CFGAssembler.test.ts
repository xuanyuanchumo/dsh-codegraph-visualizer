import { describe, it, expect } from 'vitest';
import { CFGAssembler } from '../../src/client/diagram/CFGAssembler.ts';
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

  // --- break/continue in loops ---

  it('creates break edge to loop exit when break is inside while loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { break; } }', [
      makeWhile('x > 0', [makeStatement('break_statement', 'break', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const breakEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'break');
    expect(breakEdges.length).toBe(1);
    // break edge should target the loop-exit block, not the function exit
    const loopExitNodes = result.nodes.filter((n) => n.label === 'loop-exit');
    expect(loopExitNodes.length).toBe(1);
    expect(breakEdges[0]!.target).toBe(loopExitNodes[0]!.id);
  });

  it('creates continue edge to loop condition when continue is inside for loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (i = 0; i < 10; i++) { continue; } }', [
      makeFor('i < 10', [makeStatement('continue_statement', 'continue', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const continueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'continue');
    expect(continueEdges.length).toBe(1);
    // continue edge should target the loop condition block
    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
    expect(continueEdges[0]!.target).toBe(loopNodes[0]!.id);
  });

  it('creates break edge to function exit when break is not inside any loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { break; }', [
      makeStatement('break_statement', 'break', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const breakEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'break');
    expect(breakEdges.length).toBe(1);
  });

  it('creates continue edge to function exit when continue is not inside any loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { continue; }', [
      makeStatement('continue_statement', 'continue', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const continueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'continue');
    expect(continueEdges.length).toBe(1);
  });

  // --- for loop CFG ---

  it('creates loop block for for statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (i = 0; i < 10; i++) { x = i; } }', [
      makeFor('i < 10', [makeStatement('expression_statement', 'x = i', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
    const trueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'true');
    expect(trueEdges.length).toBeGreaterThanOrEqual(1);
    const falseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'false');
    expect(falseEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates loop-back edge for while loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { x--; } }', [
      makeWhile('x > 0', [makeStatement('expression_statement', 'x--', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopBackEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'loop-back');
    expect(loopBackEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- try/catch/finally ---

  it('creates finally block for try-catch-finally', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x = 1; } catch (e) { y = 2; } finally { z = 3; } }', [
      makeAstNode('try_statement', 'try { x = 1; } catch (e) { y = 2; } finally { z = 3; }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('catch_clause', 'catch (e)', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'y = 2', 2)], 2),
        ], 2),
        makeAstNode('finally_clause', 'finally', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'z = 3', 3)], 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const finallyNodes = result.nodes.filter((n) => n.properties.blockType === 'finally');
    expect(finallyNodes.length).toBe(1);
    const afterFinallyNodes = result.nodes.filter((n) => n.label === 'after-finally');
    expect(afterFinallyNodes.length).toBe(1);
  });

  it('creates try-finally without catch', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x = 1; } finally { z = 3; } }', [
      makeAstNode('try_statement', 'try { x = 1; } finally { z = 3; }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('finally_clause', 'finally', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'z = 3', 3)], 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const finallyNodes = result.nodes.filter((n) => n.properties.blockType === 'finally');
    expect(finallyNodes.length).toBe(1);
    const catchNodes = result.nodes.filter((n) => n.properties.blockType === 'catch');
    expect(catchNodes.length).toBe(0);
  });

  // --- switch without default ---

  it('creates implicit default edge when switch has no default case', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch (x) { case 1: y = 1; } }', [
      makeAstNode('switch_statement', 'switch (x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeStatement('expression_statement', 'y = 1', 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const switchNodes = result.nodes.filter((n) => n.properties.blockType === 'switch');
    expect(switchNodes.length).toBe(1);
    const defaultEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'default');
    expect(defaultEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- nested control structures ---

  it('creates nested if inside while loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { if (x > 5) { y = 1; } x--; } }', [
      makeWhile('x > 0', [
        makeIf('x > 5', [makeStatement('expression_statement', 'y = 1', 3)]),
        makeStatement('expression_statement', 'x--', 4),
      ]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
    const condNodes = result.nodes.filter((n) => n.properties.blockType === 'condition');
    expect(condNodes.length).toBe(1);
    expect(result.metadata.maxDepth).toBeGreaterThanOrEqual(3);
  });

  it('creates nested loops with break in inner loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { while (y > 0) { break; } x--; } }', [
      makeWhile('x > 0', [
        makeWhile('y > 0', [makeStatement('break_statement', 'break', 3)]),
        makeStatement('expression_statement', 'x--', 4),
      ]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const breakEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'break');
    expect(breakEdges.length).toBe(1);
    // break should target the inner loop's exit block, not the outer loop's exit
    const outerLoopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(outerLoopNodes.length).toBe(2);
    // The break edge target should be a process block that is NOT the function exit
    const breakTargetId = breakEdges[0]!.target;
    const breakTargetNode = result.nodes.find((n) => n.id === breakTargetId);
    expect(breakTargetNode).toBeDefined();
    expect(breakTargetNode!.properties.isExit).not.toBe(true);
  });

  // --- function not found ---

  it('returns minimal diagram when function is not found', () => {
    // Include identifier child so findFunctionNode does not match by !nameNode
    const astRoot = makeAstNode('function_declaration', 'function other() {}', [
      makeAstNode('identifier', 'other', [], 0),
      makeAstNode('block', '', [], 0),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'nonexistent');

    expect(result.nodes.length).toBe(1);
    expect(result.edges.length).toBe(0);
    expect(result.metadata.nodeCount).toBe(1);
  });

  // --- simplifyText truncation ---

  it('truncates long statement text with ellipsis', () => {
    const longText = 'a'.repeat(60);
    const astRoot = makeAstNode('function_declaration', `function f() { ${longText}; }`, [
      makeStatement('expression_statement', longText, 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter(
      (n) => n.properties.blockType === 'process' && n.properties.statements,
    );
    const stmtsWithText = processNodes.flatMap(
      (n) => (n.properties.statements as Array<{ text: string }>),
    );
    const truncated = stmtsWithText.find((s) => s.text.includes('...'));
    expect(truncated).toBeDefined();
    expect(truncated!.text.length).toBeLessThanOrEqual(40);
  });

  // --- raise statement (throw alternative) ---

  it('creates exception edge for raise statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { raise ValueError(); }', [
      makeStatement('raise_statement', 'raise ValueError()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const raiseNodes = result.nodes.filter((n) => n.properties.isExit === true && n.label === 'throw');
    expect(raiseNodes.length).toBe(1);
    const exceptionEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'exception');
    expect(exceptionEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- if without else (false edge directly to merge) ---

  it('creates false edge directly to merge block when if has no else', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } }', [
      makeIf('x > 0', [makeStatement('expression_statement', 'y = 1', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const falseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'false');
    expect(falseEdges.length).toBeGreaterThanOrEqual(1);
    // The false edge should target the merge block
    const mergeNodes = result.nodes.filter((n) => n.label === 'merge');
    expect(mergeNodes.length).toBe(1);
    expect(falseEdges.some((e) => e.target === mergeNodes[0]!.id)).toBe(true);
  });

  // --- match_expression ---

  it('creates switch block for match expression', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { match x { 1 => { y = 1; } _ => { y = 0; } } }', [
      makeAstNode('match_expression', 'match x', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('match_arm', '1 => { y = 1; }', [
          makeStatement('expression_statement', 'y = 1', 2),
        ], 2),
        makeAstNode('match_arm', '_ => { y = 0; }', [
          makeAstNode('wildcard_pattern', '_', [], 3),
          makeStatement('expression_statement', 'y = 0', 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const switchNodes = result.nodes.filter((n) => n.properties.blockType === 'switch');
    expect(switchNodes.length).toBe(1);
    const defaultEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'default');
    expect(defaultEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- for_in_statement ---

  it('creates loop block for for_in statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (item in list) { x = item; } }', [
      makeAstNode('for_in_statement', 'for (item in list)', [
        makeAstNode('parenthesized_expression', 'item in list', [], 1),
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = item', 2)], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
  });

  // --- declaration and call statement types ---

  it('classifies declaration statements correctly', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { let x = 1; const y = 2; }', [
      makeStatement('lexical_declaration', 'let x = 1', 1),
      makeStatement('const_declaration', 'const y = 2', 2),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter(
      (n) => n.properties.blockType === 'process' && n.properties.statements,
    );
    const allStmts = processNodes.flatMap(
      (n) => (n.properties.statements as Array<{ type: string }>),
    );
    const declStmts = allStmts.filter((s) => s.type === 'declaration');
    expect(declStmts.length).toBe(2);
  });

  it('classifies call statements correctly', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { foo(); }', [
      makeStatement('call', 'foo()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter(
      (n) => n.properties.blockType === 'process' && n.properties.statements,
    );
    const allStmts = processNodes.flatMap(
      (n) => (n.properties.statements as Array<{ type: string }>),
    );
    const callStmts = allStmts.filter((s) => s.type === 'call');
    expect(callStmts.length).toBe(1);
  });

  // --- edge metadata and node count ---

  it('sets edgeCount and nodeCount in metadata correctly', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { x = 1; }', [
      makeStatement('expression_statement', 'x = 1', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    expect(result.metadata.nodeCount).toBe(result.nodes.length);
    expect(result.metadata.edgeCount).toBe(result.edges.length);
  });

  it('sets condition property on true and false edges', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } else { y = 2; } }', [
      makeIf('x > 0', [makeStatement('expression_statement', 'y = 1', 2)], [makeStatement('expression_statement', 'y = 2', 3)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const trueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'true');
    const falseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'false');
    for (const edge of trueEdges) {
      expect(edge.properties.condition).toBeDefined();
    }
    for (const edge of falseEdges) {
      expect(edge.properties.condition).toBeDefined();
    }
  });

  // --- break in switch targets switch merge, not loop exit ---

  it('creates break edge to switch merge when break is inside switch', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch (x) { case 1: break; default: y = 0; } }', [
      makeAstNode('switch_statement', 'switch (x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeStatement('break_statement', 'break', 2),
        ], 2),
        makeAstNode('default_statement', 'default:', [
          makeStatement('expression_statement', 'y = 0', 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const breakEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'break');
    expect(breakEdges.length).toBe(1);
    // break in switch should target the switch-merge block
    const switchMergeNodes = result.nodes.filter((n) => n.label === 'switch-merge');
    expect(switchMergeNodes.length).toBe(1);
    expect(breakEdges[0]!.target).toBe(switchMergeNodes[0]!.id);
  });

  // --- continue skips switch and targets nearest loop ---

  it('continue inside switch targets the enclosing loop, not the switch', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { switch (x) { case 1: continue; default: y = 0; } } }', [
      makeWhile('x > 0', [
        makeAstNode('switch_statement', 'switch (x)', [
          makeAstNode('parenthesized_expression', 'x', [], 2),
          makeAstNode('case_statement', 'case 1:', [
            makeStatement('continue_statement', 'continue', 3),
          ], 3),
          makeAstNode('default_statement', 'default:', [
            makeStatement('expression_statement', 'y = 0', 4),
          ], 4),
        ], 2),
      ]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const continueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'continue');
    expect(continueEdges.length).toBe(1);
    // continue should target the while loop's condition block, not the switch
    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
    expect(continueEdges[0]!.target).toBe(loopNodes[0]!.id);
  });

  // --- empty function body produces only Entry and Exit ---

  it('produces only Entry and Exit blocks connected by fallthrough when function body is empty', () => {
    const astRoot = makeAstNode('function_declaration', 'function empty() {}', [
      makeAstNode('identifier', 'empty', [], 0),
      makeAstNode('block', '', [], 0),
    ]);
    const result = assembler.assemble(astRoot, 'src/empty.ts', 'empty');

    // Empty body: Entry -> fallthrough -> Exit
    expect(result.nodes.length).toBe(2);
    const entryNode = result.nodes.find((n) => n.properties.isEntry === true);
    const exitNode = result.nodes.find((n) => n.properties.isExit === true);
    expect(entryNode).toBeDefined();
    expect(exitNode).toBeDefined();
    const fallthroughEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'fallthrough');
    expect(fallthroughEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- if with condition node found via 'condition' type child ---

  it('finds condition node via condition type child for if statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } }', [
      makeAstNode('if_statement', 'if (x > 0)', [
        makeAstNode('condition', 'x > 0', [], 1),
        makeAstNode('block', '', [makeStatement('expression_statement', 'y = 1', 2)], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const condNodes = result.nodes.filter((n) => n.properties.blockType === 'condition');
    expect(condNodes.length).toBe(1);
    expect(condNodes[0]!.label).toContain('x > 0');
  });

  // --- while with condition node found via 'condition' type child ---

  it('finds condition node via condition type child for while statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { x--; } }', [
      makeAstNode('while_statement', 'while (x > 0)', [
        makeAstNode('condition', 'x > 0', [], 1),
        makeAstNode('block', '', [makeStatement('expression_statement', 'x--', 2)], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
    expect(loopNodes[0]!.label).toContain('x > 0');
  });

  // --- for with condition node found via 'for_header' type child ---

  it('finds condition node via for_header type child for for statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (i = 0; i < 10; i++) { x = i; } }', [
      makeAstNode('for_statement', 'for (i = 0; i < 10; i++)', [
        makeAstNode('for_header', 'i = 0; i < 10; i++', [], 1),
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = i', 2)], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.blockType === 'loop');
    expect(loopNodes.length).toBe(1);
  });

  // --- if body without block (direct statement children) ---

  it('processes if body when block is absent and statements are direct children', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) y = 1; }', [
      makeAstNode('if_statement', 'if (x > 0) y = 1;', [
        makeAstNode('parenthesized_expression', 'x > 0', [], 1),
        makeStatement('expression_statement', 'y = 1', 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const condNodes = result.nodes.filter((n) => n.properties.blockType === 'condition');
    expect(condNodes.length).toBe(1);
    const trueEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'true');
    expect(trueEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- else body without block (direct statement children) ---

  it('processes else body when block is absent in else clause', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { y = 1; } else y = 2; }', [
      makeAstNode('if_statement', 'if (x > 0) { y = 1; } else y = 2;', [
        makeAstNode('parenthesized_expression', 'x > 0', [], 1),
        makeAstNode('block', '', [makeStatement('expression_statement', 'y = 1', 2)], 2),
        makeAstNode('else_clause', 'else y = 2;', [
          makeStatement('expression_statement', 'y = 2', 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const falseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'false');
    expect(falseEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- return statement creates exit block with correct statement info ---

  it('return statement creates exit block with return type statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { return 42; }', [
      makeStatement('return_statement', 'return 42', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const returnExitNodes = result.nodes.filter(
      (n) => n.properties.isExit === true && n.label === 'return',
    );
    expect(returnExitNodes.length).toBe(1);
    const stmts = returnExitNodes[0]!.properties.statements as Array<{ type: string; text: string }>;
    expect(stmts.length).toBe(1);
    expect(stmts[0]!.type).toBe('return');
    expect(stmts[0]!.text).toBe('return 42');
  });

  // --- throw statement creates exit block with throw type statement ---

  it('throw statement creates exit block with throw type statement', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { throw new Error(); }', [
      makeStatement('throw_statement', 'throw new Error()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const throwExitNodes = result.nodes.filter(
      (n) => n.properties.isExit === true && n.label === 'throw',
    );
    expect(throwExitNodes.length).toBe(1);
    const stmts = throwExitNodes[0]!.properties.statements as Array<{ type: string; text: string }>;
    expect(stmts.length).toBe(1);
    expect(stmts[0]!.type).toBe('throw');
  });

  // --- multiple catch clauses ---

  it('creates multiple catch blocks for try with multiple catch clauses', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x = 1; } catch (e1) { y = 1; } catch (e2) { y = 2; } }', [
      makeAstNode('try_statement', 'try { x = 1; } catch (e1) { y = 1; } catch (e2) { y = 2; }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('catch_clause', 'catch (e1)', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'y = 1', 2)], 2),
        ], 2),
        makeAstNode('catch_clause', 'catch (e2)', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'y = 2', 3)], 3),
        ], 3),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const catchNodes = result.nodes.filter((n) => n.properties.blockType === 'catch');
    expect(catchNodes.length).toBe(2);
    const exceptionEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'exception');
    expect(exceptionEdges.length).toBe(2);
  });

  // --- switch with multiple cases ---

  it('creates multiple case edges for switch with multiple cases', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch (x) { case 1: y = 1; case 2: y = 2; default: y = 0; } }', [
      makeAstNode('switch_statement', 'switch (x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeStatement('expression_statement', 'y = 1', 2),
        ], 2),
        makeAstNode('case_statement', 'case 2:', [
          makeStatement('expression_statement', 'y = 2', 3),
        ], 3),
        makeAstNode('default_statement', 'default:', [
          makeStatement('expression_statement', 'y = 0', 4),
        ], 4),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const caseEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'case');
    expect(caseEdges.length).toBe(2);
    const defaultEdges = result.edges.filter((e) => e.properties.cfgEdgeType === 'default');
    expect(defaultEdges.length).toBeGreaterThanOrEqual(1);
  });

  // --- entry node has depth 0 ---

  it('entry and exit blocks have depth 0', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { x = 1; }', [
      makeStatement('expression_statement', 'x = 1', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const entryNode = result.nodes.find((n) => n.properties.isEntry === true);
    expect(entryNode).toBeDefined();
    expect(entryNode!.properties.depth).toBe(0);
  });

  // --- return inside if statement ---

  it('return inside if creates exit block reachable from true branch', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x > 0) { return 1; } return 0; }', [
      makeIf('x > 0', [makeStatement('return_statement', 'return 1', 2)]),
      makeStatement('return_statement', 'return 0', 3),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const returnExitNodes = result.nodes.filter(
      (n) => n.properties.isExit === true && n.label === 'return',
    );
    expect(returnExitNodes.length).toBe(2);
  });
});