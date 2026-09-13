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
]);

export function findFunctionNode(astRoot: ASTNode, functionName: string): ASTNode | null {
  for (const child of astRoot.children) {
    if (FUNCTION_NODE_TYPES.has(child.type)) {
      const nameNode = child.children.find(
        (c) => c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'name',
      );
      if (nameNode && nameNode.text === functionName) {
        return child;
      }
    }
  }
  for (const child of astRoot.children) {
    if (child.type === 'class_declaration' || child.type === 'class_definition' || child.type === 'impl_item') {
      const found = findFunctionNode(child, functionName);
      if (found) return found;
    }
  }
  return null;
}

export function getFunctionBody(funcNode: ASTNode): ASTNode[] {
  const body = funcNode.children.find(
    (c) => c.type === 'block' || c.type === 'statement_block' || c.type === 'body' || c.type === 'compound_statement',
  );
  return body ? body.children : funcNode.children;
}