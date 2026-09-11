import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode, BasicBlock, StatementInfo, CFGEdgeData, CFGData } from '../../shared/CFGTypes.ts';

const CONTROL_FLOW_TYPES = new Set([
  'if_statement', 'if', 'for_statement', 'for', 'while_statement', 'while',
  'switch_statement', 'switch', 'try_statement', 'try',
  'return_statement', 'return', 'throw_statement', 'throw',
  'break_statement', 'break', 'continue_statement', 'continue',
]);

const STATEMENT_TYPES = new Set([
  'expression_statement', 'assignment', 'call', 'return_statement', 'return',
  'throw_statement', 'throw', 'break_statement', 'break', 'continue_statement', 'continue',
  'declaration', 'variable_declaration', 'const_declaration', 'let_declaration',
  'if_statement', 'if', 'for_statement', 'for', 'while_statement', 'while',
  'switch_statement', 'switch', 'try_statement', 'try',
]);


function isControlFlow(node: ASTNode): boolean {
  return CONTROL_FLOW_TYPES.has(node.type);
}

function isStatement(node: ASTNode): boolean {
  return STATEMENT_TYPES.has(node.type) || node.type.endsWith('_statement');
}

function classifyStatement(node: ASTNode): StatementInfo['type'] {
  const t = node.type;
  if (t === 'return_statement' || t === 'return') return 'return';
  if (t === 'throw_statement' || t === 'throw') return 'throw';
  if (t === 'break_statement' || t === 'break') return 'break';
  if (t === 'continue_statement' || t === 'continue') return 'continue';
  if (t === 'if_statement' || t === 'if' || t === 'for_statement' || t === 'for' ||
      t === 'while_statement' || t === 'while' || t === 'switch_statement' || t === 'switch' ||
      t === 'try_statement' || t === 'try') return 'condition';
  if (t.includes('declaration') || t === 'assignment') return 'declaration';
  if (t === 'call' || t === 'expression_statement') return 'call';
  return 'expression';
}

function simplifyText(text: string, maxLen = 40): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.substring(0, maxLen - 3) + '...';
}

function getConditionNode(node: ASTNode): ASTNode | null {
  if (node.type === 'if_statement' || node.type === 'if') {
    return node.children.find((c) => c.type === 'condition' || c.type === 'parenthesized_expression') ?? null;
  }
  if (node.type === 'while_statement' || node.type === 'while') {
    return node.children.find((c) => c.type === 'condition' || c.type === 'parenthesized_expression') ?? null;
  }
  if (node.type === 'for_statement' || node.type === 'for') {
    return node.children.find((c) => c.type === 'condition' || c.type === 'parenthesized_expression') ?? null;
  }
  return null;
}

function getBodyChildren(node: ASTNode): ASTNode[] {
  const body = node.children.find((c) =>
    c.type === 'block' || c.type === 'statement_block' || c.type === 'body'
  );
  if (body) return body.children.filter(isStatement);
  return node.children.filter((c) => c.type !== 'condition' && c.type !== 'parenthesized_expression' && isStatement(c));
}

function getElseBody(node: ASTNode): ASTNode[] {
  const elseNode = node.children.find((c) => c.type === 'else_clause' || c.type === 'else');
  if (!elseNode) return [];
  const body = elseNode.children.find((c) =>
    c.type === 'block' || c.type === 'statement_block'
  );
  if (body) return body.children.filter(isStatement);
  return elseNode.children.filter(isStatement);
}

export class CFGAssembler {
  private blockCounter = 0;

  private nextBlockId(): string {
    return `cfg-block-${this.blockCounter++}`;
  }

  assemble(astRoot: ASTNode, filePath: string, functionName: string): AssembledDiagram {
    this.blockCounter = 0;

    const blocks: BasicBlock[] = [];
    const edges: CFGEdgeData[] = [];

    const entryBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'Entry',
      statements: [],
      isEntry: true,
      isExit: false,
      blockType: 'entry',
      depth: 0,
    };
    blocks.push(entryBlock);

    const exitBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'Exit',
      statements: [],
      isEntry: false,
      isExit: true,
      blockType: 'exit',
      depth: 0,
    };

    this.processStatements(astRoot.children, entryBlock.id, exitBlock.id, blocks, edges, 1, filePath);

    const hasExitEdge = edges.some((e) => e.target === exitBlock.id);
    if (!hasExitEdge) {
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && !lastBlock.isExit) {
        edges.push({ source: lastBlock.id, target: exitBlock.id, edgeType: 'fallthrough' });
      }
    }

    blocks.push(exitBlock);

    const cfgData: CFGData = {
      blocks,
      edges,
      entryBlockId: entryBlock.id,
      exitBlockIds: blocks.filter((b) => b.isExit).map((b) => b.id),
    };

    return this.toAssembledDiagram(cfgData, filePath, functionName);
  }

  private processStatements(
    statements: ASTNode[],
    entryId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
    _filePath: string,
  ): string {
    if (statements.length === 0) {
      edges.push({ source: entryId, target: exitId, edgeType: 'fallthrough' });
      return entryId;
    }

    let currentId = entryId;
    let currentBlock: BasicBlock | null = blocks.find((b) => b.id === currentId) ?? null;

    if (!currentBlock || currentBlock.isEntry) {
      currentBlock = this.createProcessBlock(blocks, depth);
      edges.push({ source: entryId, target: currentBlock.id, edgeType: 'fallthrough' });
      currentId = currentBlock.id;
    }

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;

      if (isControlFlow(stmt)) {
        currentId = this.processControlFlow(stmt, currentId, exitId, blocks, edges, depth, _filePath);
        currentBlock = blocks.find((b) => b.id === currentId) ?? null;
        if (!currentBlock) {
          currentBlock = this.createProcessBlock(blocks, depth);
          currentId = currentBlock.id;
        }
      } else {
        if (!currentBlock || currentBlock.blockType !== 'process') {
          currentBlock = this.createProcessBlock(blocks, depth);
          edges.push({ source: currentId, target: currentBlock.id, edgeType: 'fallthrough' });
          currentId = currentBlock.id;
        }
        currentBlock.statements.push({
          type: classifyStatement(stmt),
          text: simplifyText(stmt.text),
          line: stmt.startPosition.row + 1,
        });
      }
    }

    if (currentId !== exitId) {
      edges.push({ source: currentId, target: exitId, edgeType: 'fallthrough' });
    }

    return currentId;
  }

  private processControlFlow(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
    _filePath: string,
  ): string {
    const t = node.type;

    if (t === 'if_statement' || t === 'if') {
      return this.processIf(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'for_statement' || t === 'for' || t === 'while_statement' || t === 'while') {
      return this.processLoop(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'switch_statement' || t === 'switch') {
      return this.processSwitch(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'try_statement' || t === 'try') {
      return this.processTry(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'return_statement' || t === 'return') {
      return this.processReturn(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'throw_statement' || t === 'throw') {
      return this.processThrow(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'break_statement' || t === 'break') {
      edges.push({ source: currentId, target: exitId, edgeType: 'break' });
      return exitId;
    }
    if (t === 'continue_statement' || t === 'continue') {
      edges.push({ source: currentId, target: exitId, edgeType: 'continue' });
      return exitId;
    }

    return currentId;
  }

  private processIf(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
  ): string {
    const condNode = getConditionNode(node);
    const condText = condNode ? simplifyText(condNode.text) : 'if';

    const condBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: condText,
      statements: [{ type: 'condition', text: condText, line: node.startPosition.row + 1 }],
      isEntry: false,
      isExit: false,
      blockType: 'condition',
      depth,
    };
    blocks.push(condBlock);
    edges.push({ source: currentId, target: condBlock.id, edgeType: 'fallthrough' });

    const mergeBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'merge',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth,
    };
    blocks.push(mergeBlock);

    const trueBody = getBodyChildren(node);
    const trueEntryId = this.nextBlockId();
    const trueEntry: BasicBlock = {
      id: trueEntryId,
      label: 'true',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth: depth + 1,
    };
    blocks.push(trueEntry);
    edges.push({ source: condBlock.id, target: trueEntryId, edgeType: 'true', condition: condText });

    this.processStatements(trueBody, trueEntryId, mergeBlock.id, blocks, edges, depth + 1, '');

    const elseBody = getElseBody(node);
    if (elseBody.length > 0) {
      const falseEntryId = this.nextBlockId();
      const falseEntry: BasicBlock = {
        id: falseEntryId,
        label: 'false',
        statements: [],
        isEntry: false,
        isExit: false,
        blockType: 'process',
        depth: depth + 1,
      };
      blocks.push(falseEntry);
      edges.push({ source: condBlock.id, target: falseEntryId, edgeType: 'false', condition: condText });

      this.processStatements(elseBody, falseEntryId, mergeBlock.id, blocks, edges, depth + 1, '');
    } else {
      edges.push({ source: condBlock.id, target: mergeBlock.id, edgeType: 'false', condition: condText });
    }

    return mergeBlock.id;
  }

  private processLoop(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
  ): string {
    const condNode = getConditionNode(node);
    const condText = condNode ? simplifyText(condNode.text) : node.type;

    const condBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: condText,
      statements: [{ type: 'condition', text: condText, line: node.startPosition.row + 1 }],
      isEntry: false,
      isExit: false,
      blockType: 'loop',
      depth,
    };
    blocks.push(condBlock);
    edges.push({ source: currentId, target: condBlock.id, edgeType: 'fallthrough' });

    const loopExitBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'loop-exit',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth,
    };
    blocks.push(loopExitBlock);

    const body = getBodyChildren(node);
    const bodyEntryId = this.nextBlockId();
    const bodyEntry: BasicBlock = {
      id: bodyEntryId,
      label: 'loop-body',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth: depth + 1,
    };
    blocks.push(bodyEntry);
    edges.push({ source: condBlock.id, target: bodyEntryId, edgeType: 'true', condition: condText });

    this.processStatements(body, bodyEntryId, condBlock.id, blocks, edges, depth + 1, '');

    edges.push({ source: condBlock.id, target: loopExitBlock.id, edgeType: 'false', condition: condText });

    return loopExitBlock.id;
  }

  private processSwitch(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
  ): string {
    const condNode = node.children.find((c) => c.type === 'condition' || c.type === 'parenthesized_expression');
    const condText = condNode ? simplifyText(condNode.text) : 'switch';

    const condBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: condText,
      statements: [{ type: 'condition', text: condText, line: node.startPosition.row + 1 }],
      isEntry: false,
      isExit: false,
      blockType: 'switch',
      depth,
    };
    blocks.push(condBlock);
    edges.push({ source: currentId, target: condBlock.id, edgeType: 'fallthrough' });

    const mergeBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'switch-merge',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth,
    };
    blocks.push(mergeBlock);

    const caseNodes = node.children.filter((c) =>
      c.type === 'case_statement' || c.type === 'case' || c.type === 'default_statement' || c.type === 'default'
    );

    for (const caseNode of caseNodes) {
      const isDefault = caseNode.type === 'default_statement' || caseNode.type === 'default';
      const caseLabel = isDefault ? 'default' :
        (caseNode.children.find((c) => c.type === 'identifier' || c.type === 'number')?.text ?? 'case');

      const caseEntryId = this.nextBlockId();
      const caseEntry: BasicBlock = {
        id: caseEntryId,
        label: caseLabel,
        statements: [],
        isEntry: false,
        isExit: false,
        blockType: 'process',
        depth: depth + 1,
      };
      blocks.push(caseEntry);

      edges.push({
        source: condBlock.id,
        target: caseEntryId,
        edgeType: isDefault ? 'default' : 'case',
        condition: caseLabel,
      });

      const caseBody = caseNode.children.filter((c) =>
        c.type !== 'identifier' && c.type !== 'number' && isStatement(c)
      );
      this.processStatements(caseBody, caseEntryId, mergeBlock.id, blocks, edges, depth + 1, '');
    }

    if (!caseNodes.some((c) => c.type === 'default_statement' || c.type === 'default')) {
      edges.push({ source: condBlock.id, target: mergeBlock.id, edgeType: 'default' });
    }

    return mergeBlock.id;
  }

  private processTry(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
  ): string {
    const tryBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'try',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'try',
      depth,
    };
    blocks.push(tryBlock);
    edges.push({ source: currentId, target: tryBlock.id, edgeType: 'fallthrough' });

    const tryBody = node.children.find((c) => c.type === 'block' || c.type === 'statement_block');
    const tryStmts = tryBody ? tryBody.children.filter(isStatement) : [];

    const mergeBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'try-merge',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth,
    };
    blocks.push(mergeBlock);

    this.processStatements(tryStmts, tryBlock.id, mergeBlock.id, blocks, edges, depth + 1, '');

    const catchNodes = node.children.filter((c) =>
      c.type === 'catch_clause' || c.type === 'catch'
    );
    for (const catchNode of catchNodes) {
      const catchBlock: BasicBlock = {
        id: this.nextBlockId(),
        label: 'catch',
        statements: [],
        isEntry: false,
        isExit: false,
        blockType: 'catch',
        depth,
      };
      blocks.push(catchBlock);

      edges.push({ source: tryBlock.id, target: catchBlock.id, edgeType: 'exception' });

      const catchBody = catchNode.children.find((c) => c.type === 'block' || c.type === 'statement_block');
      const catchStmts = catchBody ? catchBody.children.filter(isStatement) : [];
      this.processStatements(catchStmts, catchBlock.id, mergeBlock.id, blocks, edges, depth + 1, '');
    }

    const finallyNode = node.children.find((c) =>
      c.type === 'finally_clause' || c.type === 'finally'
    );
    if (finallyNode) {
      const finallyBlock: BasicBlock = {
        id: this.nextBlockId(),
        label: 'finally',
        statements: [],
        isEntry: false,
        isExit: false,
        blockType: 'finally',
        depth,
      };
      blocks.push(finallyBlock);

      edges.push({ source: mergeBlock.id, target: finallyBlock.id, edgeType: 'fallthrough' });

      const finallyBody = finallyNode.children.find((c) => c.type === 'block' || c.type === 'statement_block');
      const finallyStmts = finallyBody ? finallyBody.children.filter(isStatement) : [];

      const afterFinally: BasicBlock = {
        id: this.nextBlockId(),
        label: 'after-finally',
        statements: [],
        isEntry: false,
        isExit: false,
        blockType: 'process',
        depth,
      };
      blocks.push(afterFinally);
      this.processStatements(finallyStmts, finallyBlock.id, afterFinally.id, blocks, edges, depth + 1, '');
      return afterFinally.id;
    }

    return mergeBlock.id;
  }

  private processReturn(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
  ): string {
    const exitBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'return',
      statements: [{ type: 'return', text: simplifyText(node.text), line: node.startPosition.row + 1 }],
      isEntry: false,
      isExit: true,
      blockType: 'exit',
      depth,
    };
    blocks.push(exitBlock);
    edges.push({ source: currentId, target: exitBlock.id, edgeType: 'fallthrough' });
    return exitBlock.id;
  }

  private processThrow(
    node: ASTNode,
    currentId: string,
    exitId: string,
    blocks: BasicBlock[],
    edges: CFGEdgeData[],
    depth: number,
  ): string {
    const exitBlock: BasicBlock = {
      id: this.nextBlockId(),
      label: 'throw',
      statements: [{ type: 'throw', text: simplifyText(node.text), line: node.startPosition.row + 1 }],
      isEntry: false,
      isExit: true,
      blockType: 'exit',
      depth,
    };
    blocks.push(exitBlock);
    edges.push({ source: currentId, target: exitBlock.id, edgeType: 'exception' });
    return exitBlock.id;
  }

  private createProcessBlock(blocks: BasicBlock[], depth: number): BasicBlock {
    const block: BasicBlock = {
      id: this.nextBlockId(),
      label: '',
      statements: [],
      isEntry: false,
      isExit: false,
      blockType: 'process',
      depth,
    };
    blocks.push(block);
    return block;
  }

  private toAssembledDiagram(cfgData: CFGData, filePath: string, functionName: string): AssembledDiagram {
    const nodes: GraphNode[] = cfgData.blocks.map((block) => {
      const label = block.isEntry ? 'Entry' :
        block.isExit ? (block.label || 'Exit') :
        block.statements.length > 0 ? block.statements[0]!.text :
        block.label || block.blockType;

      return {
        id: NodeId(block.id),
        label,
        type: 'function',
        filePath,
        lineNumber: block.statements[0]?.line ?? 0,
        properties: {
          isEntry: block.isEntry,
          isExit: block.isExit,
          blockType: block.blockType,
          depth: block.depth,
          statements: block.statements,
          cfgFunction: functionName,
        },
      };
    });

    const edges: GraphEdge[] = cfgData.edges.map((edge, idx) => ({
      id: EdgeId(`cfg-edge-${idx}`),
      source: NodeId(edge.source),
      target: NodeId(edge.target),
      type: 'call',
      properties: {
        cfgEdgeType: edge.edgeType,
        ...(edge.condition ? { condition: edge.condition } : {}),
      },
    }));

    return {
      nodes,
      edges,
      metadata: {
        rootIds: [cfgData.entryBlockId],
        maxDepth: Math.max(0, ...nodes.map((n) => (n.properties.depth as number) ?? 0)),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };
  }
}