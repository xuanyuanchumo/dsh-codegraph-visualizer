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