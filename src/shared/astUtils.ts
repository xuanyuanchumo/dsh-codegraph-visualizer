import type { ASTNode } from './CFGTypes.ts';

export const BASE_CONTROL_FLOW_TYPES = new Set([
  'if_statement', 'if', 'if_expression',
  'for_statement', 'for', 'for_expression', 'for_in_statement',
  'while_statement', 'while', 'while_expression',
  'switch_statement', 'switch', 'match_expression',
  'try_statement', 'try',
  'return_statement', 'return',
  'throw_statement', 'throw', 'raise_statement', 'raise',
  'break_statement', 'break',
  'continue_statement', 'continue',
]);

export function isControlFlow(node: ASTNode, types: Set<string> = BASE_CONTROL_FLOW_TYPES): boolean {
  return types.has(node.type);
}

export function findElseNode(node: ASTNode): ASTNode | undefined {
  return node.children.find((c) => c.type === 'else_clause' || c.type === 'else');
}

export function findConditionNode(node: ASTNode): ASTNode | undefined {
  return node.children.find((c) =>
    c.type === 'condition' || c.type === 'parenthesized_expression',
  );
}
