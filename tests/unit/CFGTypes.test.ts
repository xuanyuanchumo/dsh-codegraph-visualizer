import { describe, it, expect } from 'vitest';
import { FUNCTION_NODE_TYPES, BODY_NODE_TYPES, findFunctionNode, getFunctionBody } from '../../src/shared/CFGTypes.ts';
import type { ASTNode } from '../../src/shared/CFGTypes.ts';

function makeNode(type: string, children: ASTNode[] = [], text = ''): ASTNode {
  return { type, text, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, children };
}

describe('CFGTypes', () => {
  describe('FUNCTION_NODE_TYPES', () => {
    it('contains common function declaration types', () => {
      expect(FUNCTION_NODE_TYPES.has('function_declaration')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('function_definition')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('method_declaration')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('method_definition')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('arrow_function')).toBe(true);
    });

    it('contains async function types', () => {
      expect(FUNCTION_NODE_TYPES.has('async_function_declaration')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('async_function_expression')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('async_arrow_function')).toBe(true);
    });

    it('contains generator function types', () => {
      expect(FUNCTION_NODE_TYPES.has('generator_function_declaration')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('generator_function')).toBe(true);
    });

    it('contains constructor and destructor types', () => {
      expect(FUNCTION_NODE_TYPES.has('constructor_declaration')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('destructor_declaration')).toBe(true);
    });

    it('contains signature types', () => {
      expect(FUNCTION_NODE_TYPES.has('function_signature')).toBe(true);
      expect(FUNCTION_NODE_TYPES.has('method_signature')).toBe(true);
    });

    it('contains Rust function_item', () => {
      expect(FUNCTION_NODE_TYPES.has('function_item')).toBe(true);
    });
  });

  describe('BODY_NODE_TYPES', () => {
    it('contains block types', () => {
      expect(BODY_NODE_TYPES.has('block')).toBe(true);
      expect(BODY_NODE_TYPES.has('statement_block')).toBe(true);
    });

    it('contains body types', () => {
      expect(BODY_NODE_TYPES.has('body')).toBe(true);
      expect(BODY_NODE_TYPES.has('function_body')).toBe(true);
      expect(BODY_NODE_TYPES.has('method_body')).toBe(true);
    });

    it('contains compound_statement and suite', () => {
      expect(BODY_NODE_TYPES.has('compound_statement')).toBe(true);
      expect(BODY_NODE_TYPES.has('suite')).toBe(true);
    });
  });

  describe('findFunctionNode', () => {
    it('finds function by exact name', () => {
      const funcNode = makeNode('function_declaration', [makeNode('identifier', [], 'myFunc')], 'myFunc');
      const ast = makeNode('program', [funcNode]);
      expect(findFunctionNode(ast, 'myFunc')).toBe(funcNode);
    });

    it('finds function by normalized name (strips prefix)', () => {
      const funcNode = makeNode('function_declaration', [makeNode('identifier', [], 'innerFunc')], 'innerFunc');
      const ast = makeNode('program', [funcNode]);
      expect(findFunctionNode(ast, 'module.innerFunc')).toBe(funcNode);
    });

    it('finds function by property_identifier', () => {
      const funcNode = makeNode('method_declaration', [makeNode('property_identifier', [], 'myMethod')], 'myMethod');
      const ast = makeNode('program', [funcNode]);
      expect(findFunctionNode(ast, 'myMethod')).toBe(funcNode);
    });

    it('finds function by name node', () => {
      const funcNode = makeNode('function_item', [makeNode('name', [], 'rust_func')], 'rust_func');
      const ast = makeNode('program', [funcNode]);
      expect(findFunctionNode(ast, 'rust_func')).toBe(funcNode);
    });

    it('finds nested function', () => {
      const funcNode = makeNode('function_declaration', [makeNode('identifier', [], 'deepFunc')], 'deepFunc');
      const ast = makeNode('program', [makeNode('class_declaration', [funcNode])]);
      expect(findFunctionNode(ast, 'deepFunc')).toBe(funcNode);
    });

    it('returns null when function not found', () => {
      const ast = makeNode('program', [makeNode('identifier', [], 'notFunc')]);
      expect(findFunctionNode(ast, 'nonexistent')).toBeNull();
    });

    it('returns null for empty ast', () => {
      const ast = makeNode('program', []);
      expect(findFunctionNode(ast, 'anyFunc')).toBeNull();
    });

    it('matches function without name child', () => {
      const funcNode = makeNode('function_declaration', [], 'anonFunc');
      const ast = makeNode('program', [funcNode]);
      expect(findFunctionNode(ast, 'anonFunc')).toBe(funcNode);
    });
  });

  describe('getFunctionBody', () => {
    it('returns children of block body', () => {
      const bodyNode = makeNode('block', [makeNode('stmt1'), makeNode('stmt2')]);
      const funcNode = makeNode('function_declaration', [makeNode('identifier'), bodyNode]);
      expect(getFunctionBody(funcNode)).toHaveLength(2);
    });

    it('returns children of statement_block body', () => {
      const bodyNode = makeNode('statement_block', [makeNode('stmt1')]);
      const funcNode = makeNode('function_declaration', [makeNode('identifier'), bodyNode]);
      expect(getFunctionBody(funcNode)).toHaveLength(1);
    });

    it('returns children of suite body (Python)', () => {
      const bodyNode = makeNode('suite', [makeNode('stmt1')]);
      const funcNode = makeNode('function_definition', [makeNode('identifier'), bodyNode]);
      expect(getFunctionBody(funcNode)).toHaveLength(1);
    });

    it('returns all children when no body type found', () => {
      const funcNode = makeNode('function_declaration', [makeNode('identifier'), makeNode('stmt1')]);
      expect(getFunctionBody(funcNode)).toHaveLength(2);
    });

    it('returns empty array for function with no children', () => {
      const funcNode = makeNode('function_declaration', []);
      expect(getFunctionBody(funcNode)).toHaveLength(0);
    });
  });
});