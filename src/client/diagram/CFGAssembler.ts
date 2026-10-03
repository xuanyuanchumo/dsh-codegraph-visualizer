import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode, BasicBlock, StatementInfo, CFGEdgeData, CFGData } from '../../shared/CFGTypes.ts';
import { findFunctionNode, getFunctionBody } from '../../shared/CFGTypes.ts';
import { BASE_CONTROL_FLOW_TYPES, isControlFlow as isControlFlowBase, simplifyText as simplifyTextShared, getBodyChildren as getBodyChildrenShared, getElseBody as getElseBodyShared } from '../../shared/astUtils.ts';

const CFG_CONTROL_FLOW_TYPES = new Set([...BASE_CONTROL_FLOW_TYPES, 'match_arm', 'elif_clause', 'elif', 'except_clause', 'except', 'finally_clause', 'finally', 'catch_clause', 'catch']);

const STATEMENT_TYPES = new Set([
  'expression_statement', 'assignment', 'call', 'return_statement', 'return',
  'throw_statement', 'throw', 'raise_statement', 'raise',
  'break_statement', 'break', 'continue_statement', 'continue',
  'declaration', 'variable_declaration', 'const_declaration', 'let_declaration',
  'lexical_declaration',
  'if_statement', 'if', 'if_expression',
  'for_statement', 'for', 'for_expression', 'for_in_statement',
  'while_statement', 'while', 'while_expression',
  'switch_statement', 'switch', 'match_expression',
  'try_statement', 'try',
  'import_statement', 'import_declaration', 'use_declaration',
  'export_statement',
  'pass_statement', 'pass',
  'assert_statement', 'assert',
  'with_statement', 'with',
  'yield_statement', 'yield',
  'await_expression',
  'macro_invocation',
]);


function isControlFlow(node: ASTNode): boolean {
  return isControlFlowBase(node, CFG_CONTROL_FLOW_TYPES);
}

function isStatement(node: ASTNode): boolean {
  return STATEMENT_TYPES.has(node.type) || node.type.endsWith('_statement');
}

function classifyStatement(node: ASTNode): StatementInfo['type'] {
  const t = node.type;
  if (t === 'return_statement' || t === 'return') return 'return';
  if (t === 'throw_statement' || t === 'throw' || t === 'raise_statement' || t === 'raise') return 'throw';
  if (t === 'break_statement' || t === 'break') return 'break';
  if (t === 'continue_statement' || t === 'continue') return 'continue';
  if (t === 'if_statement' || t === 'if' || t === 'if_expression' ||
      t === 'for_statement' || t === 'for' || t === 'for_expression' || t === 'for_in_statement' ||
      t === 'while_statement' || t === 'while' || t === 'while_expression' ||
      t === 'switch_statement' || t === 'switch' || t === 'match_expression' ||
      t === 'try_statement' || t === 'try') return 'condition';
  if (t.includes('declaration') || t === 'assignment' || t === 'lexical_declaration') return 'declaration';
  if (t === 'call' || t === 'expression_statement' || t === 'await_expression' || t === 'macro_invocation') return 'call';
  return 'expression';
}

function simplifyText(text: string, maxLen = 40): string {
  return simplifyTextShared(text, maxLen);
}


function getConditionNode(node: ASTNode): ASTNode | null {
  if (node.type === 'if_statement' || node.type === 'if' || node.type === 'if_expression') {
    return node.children.find((c) =>
      c.type === 'condition' || c.type === 'parenthesized_expression' ||
      c.type === 'binary_expression' || c.type === 'comparison_expression'
    ) ?? null;
  }
  if (node.type === 'while_statement' || node.type === 'while' || node.type === 'while_expression') {
    return node.children.find((c) =>
      c.type === 'condition' || c.type === 'parenthesized_expression' ||
      c.type === 'binary_expression'
    ) ?? null;
  }
  if (node.type === 'for_statement' || node.type === 'for' || node.type === 'for_expression' || node.type === 'for_in_statement') {
    return node.children.find((c) =>
      c.type === 'condition' || c.type === 'parenthesized_expression' ||
      c.type === 'for_header' || c.type === 'binary_expression'
    ) ?? null;
  }
  return null;
}

function getBodyChildren(node: ASTNode): ASTNode[] {
  return getBodyChildrenShared(node, isStatement);
}

function getElseBody(node: ASTNode): ASTNode[] {
  return getElseBodyShared(node, isStatement);
}

interface LoopContext {
  condBlockId: string;
  exitBlockId: string;
  isSwitch: boolean;
}

export class CFGAssembler {
  private blockCounter = 0;
  private loopStack: LoopContext[] = [];

  private nextBlockId(): string {
    return `cfg-block-${this.blockCounter++}`;
  }

  assemble(astRoot: ASTNode, filePath: string, functionName: string): AssembledDiagram {
    this.blockCounter = 0;
    this.loopStack = [];

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

    const funcNode = findFunctionNode(astRoot, functionName);
    if (!funcNode) {
      // The requested function is not in this AST. Keep the fallback diagram self-consistent: the
      // exit block used to be named in `exitBlockIds` without ever being added to `blocks`, so the
      // metadata pointed at a node the diagram did not contain.
      edges.push({ source: entryBlock.id, target: exitBlock.id, edgeType: 'fallthrough' });
      blocks.push(exitBlock);
      return this.toAssembledDiagram(
        { blocks, edges, entryBlockId: entryBlock.id, exitBlockIds: [exitBlock.id] },
        filePath,
        functionName,
      );
    }
    const targetChildren = getFunctionBody(funcNode);

    this.processStatements(targetChildren, entryBlock.id, exitBlock.id, blocks, edges, 1);

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
        currentId = this.processControlFlow(stmt, currentId, exitId, blocks, edges, depth);
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

  ): string {
    const t = node.type;

    if (t === 'if_statement' || t === 'if' || t === 'if_expression') {
      return this.processIf(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'for_statement' || t === 'for' || t === 'for_expression' || t === 'for_in_statement' ||
        t === 'while_statement' || t === 'while' || t === 'while_expression') {
      return this.processLoop(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'switch_statement' || t === 'switch' || t === 'match_expression') {
      return this.processSwitch(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'try_statement' || t === 'try') {
      return this.processTry(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'return_statement' || t === 'return') {
      return this.processReturn(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'throw_statement' || t === 'throw' || t === 'raise_statement' || t === 'raise') {
      return this.processThrow(node, currentId, exitId, blocks, edges, depth);
    }
    if (t === 'break_statement' || t === 'break') {
      const loopCtx = this.loopStack[this.loopStack.length - 1];
      if (loopCtx) {
        edges.push({ source: currentId, target: loopCtx.exitBlockId, edgeType: 'break' });
        return loopCtx.exitBlockId;
      }
      edges.push({ source: currentId, target: exitId, edgeType: 'break' });
      return exitId;
    }
    if (t === 'continue_statement' || t === 'continue') {
      for (let i = this.loopStack.length - 1; i >= 0; i--) {
        const ctx = this.loopStack[i];
        if (ctx && !ctx.isSwitch) {
          edges.push({ source: currentId, target: ctx.condBlockId, edgeType: 'continue' });
          return ctx.condBlockId;
        }
      }
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

    this.processStatements(trueBody, trueEntryId, mergeBlock.id, blocks, edges, depth + 1);

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

      this.processStatements(elseBody, falseEntryId, mergeBlock.id, blocks, edges, depth + 1);
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

    const edgeCountBefore = edges.length;
    this.loopStack.push({ condBlockId: condBlock.id, exitBlockId: loopExitBlock.id, isSwitch: false });
    this.processStatements(body, bodyEntryId, condBlock.id, blocks, edges, depth + 1);
    this.loopStack.pop();

    for (let i = edgeCountBefore; i < edges.length; i++) {
      const e = edges[i]!;
      if (e.target === condBlock.id && e.edgeType === 'fallthrough') {
        e.edgeType = 'loop-back';
      }
    }

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
      c.type === 'case_statement' || c.type === 'case' ||
      c.type === 'default_statement' || c.type === 'default' ||
      c.type === 'match_arm'
    );

    for (const caseNode of caseNodes) {
      const isDefault = caseNode.type === 'default_statement' || caseNode.type === 'default' ||
        (caseNode.type === 'match_arm' && caseNode.children.some((c) => c.type === 'wildcard_pattern' || c.text === '_'));
      const caseLabel = isDefault ? 'default' :
        (caseNode.children.find((c) => c.type === 'identifier' || c.type === 'number' || c.type === 'string' || c.type === 'literal_pattern')?.text ?? 'case');

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
      this.loopStack.push({ condBlockId: condBlock.id, exitBlockId: mergeBlock.id, isSwitch: true });
      this.processStatements(caseBody, caseEntryId, mergeBlock.id, blocks, edges, depth + 1);
      this.loopStack.pop();
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

    this.processStatements(tryStmts, tryBlock.id, mergeBlock.id, blocks, edges, depth + 1);

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
      this.processStatements(catchStmts, catchBlock.id, mergeBlock.id, blocks, edges, depth + 1);
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
      this.processStatements(finallyStmts, finallyBlock.id, afterFinally.id, blocks, edges, depth + 1);
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