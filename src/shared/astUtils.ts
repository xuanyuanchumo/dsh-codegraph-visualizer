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
export function simplifyText(text: string, maxLen = 40): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.substring(0, maxLen - 3) + '...';
}

export function getBodyChildren(node: ASTNode, filter?: (c: ASTNode) => boolean): ASTNode[] {
  const body = node.children.find((c) =>
    c.type === 'block' || c.type === 'statement_block' || c.type === 'body' ||
    c.type === 'compound_statement' || c.type === 'suite' || c.type === 'function_body'
  );
  if (body) return filter ? body.children.filter(filter) : body.children;
  return node.children.filter((c) =>
    c.type !== 'condition' && c.type !== 'parenthesized_expression' && (!filter || filter(c))
  );
}

export function getElseBody(node: ASTNode, filter?: (c: ASTNode) => boolean): ASTNode[] {
  const elseNode = findElseNode(node);
  if (!elseNode) return [];
  const body = elseNode.children.find((c) =>
    c.type === 'block' || c.type === 'statement_block'
  );
  if (body) return filter ? body.children.filter(filter) : body.children;
  return filter ? elseNode.children.filter(filter) : elseNode.children;
}
