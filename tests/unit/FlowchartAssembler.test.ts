import { describe, it, expect } from 'vitest';
import { FlowchartAssembler } from '../../src/client/diagram/FlowchartAssembler.ts';
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

  it('creates switch decision node with switch prefix label', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch(x) { case 1: y=1; default: y=2; } }', [
      makeAstNode('switch_statement', 'switch(x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeAstNode('identifier', '1', [], 2),
          makeStatement('expression_statement', 'y = 1', 3),
        ], 2),
        makeAstNode('default_statement', 'default:', [
          makeStatement('expression_statement', 'y = 2', 5),
        ], 5),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const switchNode = result.nodes.find((n) =>
      typeof n.label === 'string' && n.label.startsWith('switch:'),
    );
    expect(switchNode).toBeDefined();
    expect(switchNode?.properties.flowchartNodeType).toBe('decision');
  });

  it('creates case edge with condition label', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch(x) { case 1: y=1; default: y=2; } }', [
      makeAstNode('switch_statement', 'switch(x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeAstNode('identifier', '1', [], 2),
          makeStatement('expression_statement', 'y = 1', 3),
        ], 2),
        makeAstNode('default_statement', 'default:', [
          makeStatement('expression_statement', 'y = 2', 5),
        ], 5),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const caseEdges = result.edges.filter((e) => e.properties.label === '1');
    expect(caseEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates default edge with translated label', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { switch(x) { case 1: y=1; default: y=2; } }', [
      makeAstNode('switch_statement', 'switch(x)', [
        makeAstNode('parenthesized_expression', 'x', [], 1),
        makeAstNode('case_statement', 'case 1:', [
          makeAstNode('identifier', '1', [], 2),
          makeStatement('expression_statement', 'y = 1', 3),
        ], 2),
        makeAstNode('default_statement', 'default:', [
          makeStatement('expression_statement', 'y = 2', 5),
        ], 5),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const defaultEdges = result.edges.filter((e) => e.properties.label === '默认');
    expect(defaultEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates finally block as process node', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x=1; } finally { cleanup(); } }', [
      makeAstNode('try_statement', 'try { x=1; } finally { cleanup(); }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('finally_clause', 'finally', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'cleanup()', 2)], 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const finallyNodes = result.nodes.filter((n) => n.label === '最终处理');
    expect(finallyNodes.length).toBeGreaterThanOrEqual(1);
    expect(finallyNodes[0]?.properties.flowchartNodeType).toBe('process');
  });

  it('creates try block as process node', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x=1; } finally { cleanup(); } }', [
      makeAstNode('try_statement', 'try { x=1; } finally { cleanup(); }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('finally_clause', 'finally', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'cleanup()', 2)], 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const tryNodes = result.nodes.filter((n) => n.label === '尝试执行');
    expect(tryNodes.length).toBeGreaterThanOrEqual(1);
    expect(tryNodes[0]?.properties.flowchartNodeType).toBe('process');
  });

  it('creates loop prefix label for while without condition node', () => {
    // Construct a while_statement without parenthesized_expression child
    // so getConditionNode returns null and condText becomes 'while_statement'
    const astRoot = makeAstNode('function_declaration', 'function f() { while (x > 0) { x--; } }', [
      makeAstNode('while_statement', 'while (x > 0)', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x--', 2)], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'loop');
    expect(loopNodes.length).toBeGreaterThanOrEqual(1);
    // Label should contain '循环:' prefix from conditionToQuestion while/for branch
    const loopPrefixNode = result.nodes.find((n) =>
      typeof n.label === 'string' && n.label.startsWith('循环:'),
    );
    expect(loopPrefixNode).toBeDefined();
  });

  it('creates break edge for break statement in loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (x of items) { if (x) break; } }', [
      makeFor('x of items', [
        makeIf('x', [makeStatement('break_statement', 'break', 2)]),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const breakEdges = result.edges.filter((e) => e.properties.label === '跳出');
    expect(breakEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('creates continue edge for continue statement in loop', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (x of items) { if (x) continue; } }', [
      makeFor('x of items', [
        makeIf('x', [makeStatement('continue_statement', 'continue', 2)]),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const continueEdges = result.edges.filter((e) => e.properties.label === '继续');
    expect(continueEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('infers verb() label for multi-statement block with unknown function call', () => {
    // Two expression statements in one function body to create a multi-statement process block
    // First statement is a function call not in PROCESS_KEYWORDS
    const astRoot = makeAstNode('function_declaration', 'function f() { customFunc(); otherStmt(); }', [
      makeStatement('expression_statement', 'customFunc()', 1),
      makeStatement('expression_statement', 'otherStmt()', 2),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'process');
    const verbNode = processNodes.find((n) => n.label === 'customfunc()');
    expect(verbNode).toBeDefined();
  });

  it('infers statements count label for multi-statement block without verb match', () => {
    // Two non-function-call statements to avoid verbMatch
    const astRoot = makeAstNode('function_declaration', 'function f() { x = 1; y = 2; }', [
      makeStatement('expression_statement', 'x = 1', 1),
      makeStatement('expression_statement', 'y = 2', 2),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const processNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'process');
    const countNode = processNodes.find((n) =>
      typeof n.label === 'string' && n.label.includes('条语句'),
    );
    expect(countNode).toBeDefined();
  });

  it('creates catch block as error node', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { try { x=1; } catch (e) { handle(); } }', [
      makeAstNode('try_statement', 'try { x=1; } catch (e) { handle(); }', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'x = 1', 1)], 1),
        makeAstNode('catch_clause', 'catch (e)', [
          makeAstNode('block', '', [makeStatement('expression_statement', 'handle()', 2)], 2),
        ], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const catchNodes = result.nodes.filter((n) => n.label === '捕获异常');
    expect(catchNodes.length).toBeGreaterThanOrEqual(1);
    expect(catchNodes[0]?.properties.flowchartNodeType).toBe('error');
  });

  it('creates error exit node for throw label', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { throw new Error(); }', [
      makeStatement('throw_statement', 'throw new Error()', 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const errorExitNodes = result.nodes.filter((n) => n.label === '异常退出');
    expect(errorExitNodes.length).toBeGreaterThanOrEqual(1);
    expect(errorExitNodes[0]?.properties.flowchartNodeType).toBe('error');
  });

  it('creates loop-back edge for loop body returning to condition', () => {
    const astRoot = makeAstNode('function_declaration', 'function f() { for (x of items) { process(x); } }', [
      makeFor('x of items', [makeStatement('expression_statement', 'process(x)', 2)]),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    const loopEdges = result.edges.filter((e) => e.properties.flowchartEdgeType === 'loop');
    expect(loopEdges.length).toBeGreaterThanOrEqual(1);
    expect(loopEdges[0]?.properties.label).toBe('循环');
  });

  it('creates condition question for if without condition node', () => {
    // Construct an if_statement without parenthesized_expression child
    // so getConditionNode returns null and condText becomes 'if'
    const astRoot = makeAstNode('function_declaration', 'function f() { if (x) { y = 1; } }', [
      makeAstNode('if_statement', 'if (x)', [
        makeAstNode('block', '', [makeStatement('expression_statement', 'y = 1', 2)], 2),
      ], 1),
    ]);
    const result = assembler.assemble(astRoot, 'src/f.ts', 'f');

    // conditionToQuestion('if') should match the if-branch and produce 'x?' style label
    const decisionNodes = result.nodes.filter((n) => n.properties.flowchartNodeType === 'decision');
    expect(decisionNodes.length).toBeGreaterThanOrEqual(1);
    // When condText is 'if', conditionToQuestion strips 'if' prefix and adds '?'
    expect(decisionNodes[0]?.label).toContain('?');
  });
});