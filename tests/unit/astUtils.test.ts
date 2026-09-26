import { describe, it, expect } from 'vitest';
import { isControlFlow, findElseNode, findConditionNode, simplifyText, getBodyChildren, getElseBody, BASE_CONTROL_FLOW_TYPES } from '../../src/shared/astUtils.ts';
import type { ASTNode } from '../../src/shared/CFGTypes.ts';

function makeNode(type: string, children: ASTNode[] = [], text = ''): ASTNode {
  return { type, text, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, children };
}

describe('astUtils', () => {
  describe('BASE_CONTROL_FLOW_TYPES', () => {
    it('contains if statement types', () => {
      expect(BASE_CONTROL_FLOW_TYPES.has('if_statement')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('if')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('if_expression')).toBe(true);
    });

    it('contains loop types', () => {
      expect(BASE_CONTROL_FLOW_TYPES.has('for_statement')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('while_statement')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('for_in_statement')).toBe(true);
    });

    it('contains return and throw types', () => {
      expect(BASE_CONTROL_FLOW_TYPES.has('return_statement')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('throw_statement')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('raise_statement')).toBe(true);
    });

    it('contains break and continue types', () => {
      expect(BASE_CONTROL_FLOW_TYPES.has('break_statement')).toBe(true);
      expect(BASE_CONTROL_FLOW_TYPES.has('continue_statement')).toBe(true);
    });
  });

  describe('isControlFlow', () => {
    it('returns true for control flow nodes', () => {
      expect(isControlFlow(makeNode('if_statement'))).toBe(true);
      expect(isControlFlow(makeNode('for_statement'))).toBe(true);
      expect(isControlFlow(makeNode('return_statement'))).toBe(true);
    });

    it('returns false for non-control-flow nodes', () => {
      expect(isControlFlow(makeNode('identifier'))).toBe(false);
      expect(isControlFlow(makeNode('string'))).toBe(false);
      expect(isControlFlow(makeNode('expression'))).toBe(false);
    });

    it('accepts custom types set', () => {
      const customTypes = new Set(['custom_type']);
      expect(isControlFlow(makeNode('custom_type'), customTypes)).toBe(true);
      expect(isControlFlow(makeNode('if_statement'), customTypes)).toBe(false);
    });
  });

  describe('findElseNode', () => {
    it('finds else_clause child', () => {
      const elseNode = makeNode('else_clause');
      const parent = makeNode('if_statement', [makeNode('condition'), elseNode]);
      expect(findElseNode(parent)).toBe(elseNode);
    });

    it('finds else child', () => {
      const elseNode = makeNode('else');
      const parent = makeNode('if', [makeNode('condition'), elseNode]);
      expect(findElseNode(parent)).toBe(elseNode);
    });

    it('returns undefined when no else node', () => {
      const parent = makeNode('if_statement', [makeNode('condition')]);
      expect(findElseNode(parent)).toBeUndefined();
    });
  });

  describe('findConditionNode', () => {
    it('finds condition child', () => {
      const condNode = makeNode('condition');
      const parent = makeNode('if_statement', [condNode, makeNode('block')]);
      expect(findConditionNode(parent)).toBe(condNode);
    });

    it('finds parenthesized_expression child', () => {
      const condNode = makeNode('parenthesized_expression');
      const parent = makeNode('if_statement', [condNode, makeNode('block')]);
      expect(findConditionNode(parent)).toBe(condNode);
    });

    it('returns undefined when no condition node', () => {
      const parent = makeNode('if_statement', [makeNode('block')]);
      expect(findConditionNode(parent)).toBeUndefined();
    });
  });

  describe('simplifyText', () => {
    it('returns text as-is when shorter than maxLen', () => {
      expect(simplifyText('short text')).toBe('short text');
    });

    it('truncates text longer than maxLen', () => {
      const long = 'a'.repeat(50);
      const result = simplifyText(long, 40);
      expect(result.length).toBe(40);
      expect(result.endsWith('...')).toBe(true);
    });

    it('collapses whitespace', () => {
      expect(simplifyText('  multiple   spaces  ')).toBe('multiple spaces');
    });

    it('uses default maxLen of 40', () => {
      const long = 'a'.repeat(50);
      const result = simplifyText(long);
      expect(result.length).toBe(40);
    });
  });

  describe('getBodyChildren', () => {
    it('finds block body', () => {
      const bodyNode = makeNode('block', [makeNode('stmt1'), makeNode('stmt2')]);
      const parent = makeNode('if_statement', [makeNode('condition'), bodyNode]);
      expect(getBodyChildren(parent)).toHaveLength(2);
    });

    it('finds statement_block body', () => {
      const bodyNode = makeNode('statement_block', [makeNode('stmt1')]);
      const parent = makeNode('function_declaration', [bodyNode]);
      expect(getBodyChildren(parent)).toHaveLength(1);
    });

    it('finds body type', () => {
      const bodyNode = makeNode('body', [makeNode('stmt1')]);
      const parent = makeNode('function_item', [bodyNode]);
      expect(getBodyChildren(parent)).toHaveLength(1);
    });

    it('finds compound_statement body', () => {
      const bodyNode = makeNode('compound_statement', [makeNode('stmt1')]);
      const parent = makeNode('for_statement', [bodyNode]);
      expect(getBodyChildren(parent)).toHaveLength(1);
    });

    it('finds suite body (Python)', () => {
      const bodyNode = makeNode('suite', [makeNode('stmt1')]);
      const parent = makeNode('function_definition', [bodyNode]);
      expect(getBodyChildren(parent)).toHaveLength(1);
    });

    it('finds function_body', () => {
      const bodyNode = makeNode('function_body', [makeNode('stmt1')]);
      const parent = makeNode('method_declaration', [bodyNode]);
      expect(getBodyChildren(parent)).toHaveLength(1);
    });

    it('falls back to filtering non-condition children', () => {
      const parent = makeNode('if_statement', [makeNode('condition'), makeNode('stmt1'), makeNode('stmt2')]);
      const children = getBodyChildren(parent);
      expect(children).toHaveLength(2);
      expect(children[0]?.type).toBe('stmt1');
    });

    it('applies filter when provided', () => {
      const bodyNode = makeNode('block', [makeNode('return_statement'), makeNode('expression')]);
      const parent = makeNode('if_statement', [makeNode('condition'), bodyNode]);
      const filtered = getBodyChildren(parent, (c) => c.type === 'return_statement');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.type).toBe('return_statement');
    });
  });

  describe('getElseBody', () => {
    it('returns children of else block', () => {
      const elseBlock = makeNode('block', [makeNode('stmt1')]);
      const elseNode = makeNode('else_clause', [elseBlock]);
      const parent = makeNode('if_statement', [makeNode('condition'), elseNode]);
      expect(getElseBody(parent)).toHaveLength(1);
    });

    it('returns empty array when no else node', () => {
      const parent = makeNode('if_statement', [makeNode('condition'), makeNode('block')]);
      expect(getElseBody(parent)).toHaveLength(0);
    });

    it('returns else children directly when no block', () => {
      const elseNode = makeNode('else_clause', [makeNode('stmt1'), makeNode('stmt2')]);
      const parent = makeNode('if_statement', [makeNode('condition'), elseNode]);
      expect(getElseBody(parent)).toHaveLength(2);
    });

    it('applies filter when provided', () => {
      const elseBlock = makeNode('block', [makeNode('return_statement'), makeNode('expression')]);
      const elseNode = makeNode('else_clause', [elseBlock]);
      const parent = makeNode('if_statement', [makeNode('condition'), elseNode]);
      const filtered = getElseBody(parent, (c) => c.type === 'return_statement');
      expect(filtered).toHaveLength(1);
    });

    it('applies filter on else children directly when no block body', () => {
      const elseNode = makeNode('else_clause', [makeNode('return_statement'), makeNode('expression')]);
      const parent = makeNode('if_statement', [makeNode('condition'), elseNode]);
      const filtered = getElseBody(parent, (c) => c.type === 'return_statement');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.type).toBe('return_statement');
    });
  });

  describe('getBodyChildren fallback with filter', () => {
    it('applies filter in fallback path when no body node found', () => {
      const parent = makeNode('if_statement', [makeNode('condition'), makeNode('return_statement'), makeNode('expression')]);
      const filtered = getBodyChildren(parent, (c) => c.type === 'return_statement');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.type).toBe('return_statement');
    });

    it('filters out condition and parenthesized_expression in fallback without filter', () => {
      const parent = makeNode('if_statement', [
        makeNode('condition'),
        makeNode('parenthesized_expression'),
        makeNode('stmt1'),
      ]);
      const children = getBodyChildren(parent);
      expect(children).toHaveLength(1);
      expect(children[0]?.type).toBe('stmt1');
    });
  });
});