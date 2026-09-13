export interface ASTNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: ASTNode[];
}

export interface BasicBlock {
  id: string;
  label: string;
  statements: StatementInfo[];
  isEntry: boolean;
  isExit: boolean;
  blockType: 'entry' | 'exit' | 'process' | 'condition' | 'loop' | 'switch' | 'try' | 'catch' | 'finally';
  depth: number;
}

export interface StatementInfo {
  type: 'assignment' | 'call' | 'return' | 'throw' | 'condition' | 'declaration' | 'break' | 'continue' | 'expression';
  text: string;
  line: number;
}

export interface CFGEdgeData {
  source: string;
  target: string;
  edgeType: 'fallthrough' | 'true' | 'false' | 'case' | 'default' | 'exception' | 'loop-back' | 'break' | 'continue';
  condition?: string;
}

export interface CFGData {
  blocks: BasicBlock[];
  edges: CFGEdgeData[];
  entryBlockId: string;
  exitBlockIds: string[];
}
const FUNCTION_NODE_TYPES = new Set([
  'function_declaration', 'function_definition', 'method_declaration',
  'method_definition', 'arrow_function', 'function_item',
  'constructor_declaration', 'destructor_declaration',
  'function_expression', 'generator_function_declaration',
  'generator_function', 'async_function_declaration',
  'async_function_expression', 'async_arrow_function',
  'function_signature', 'method_signature',
]);


const BODY_NODE_TYPES = new Set([
  'block', 'statement_block', 'body', 'compound_statement',
  'function_body', 'method_body', 'suite',
]);

export function findFunctionNode(astRoot: ASTNode, functionName: string): ASTNode | null {
  const normalizedTarget = functionName.replace(/^.*\./, '');

  const matchNode = (node: ASTNode): ASTNode | null => {
    if (FUNCTION_NODE_TYPES.has(node.type)) {
      const nameNode = node.children.find(
        (c) => c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'name',
      );
      if (!nameNode || nameNode.text === functionName || nameNode.text === normalizedTarget) {
        return node;
      }
    }
    for (const child of node.children) {
      const found = matchNode(child);
      if (found) return found;
    }
    return null;
  };

  return matchNode(astRoot);
}

export function getFunctionBody(funcNode: ASTNode): ASTNode[] {
  const body = funcNode.children.find((c) => BODY_NODE_TYPES.has(c.type));
  return body ? body.children : funcNode.children;
}