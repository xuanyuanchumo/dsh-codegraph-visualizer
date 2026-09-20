import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { findFunctionNode, getFunctionBody } from '../../shared/CFGTypes.ts';
import type {
  Participant,
  ParticipantType,
  SequenceMessage,

  CombinedFragment,
  FragmentType,
  FragmentOperand,
  SequenceData,
} from './SequenceTypes.ts';

const CALL_NODE_TYPES = new Set([
  'call_expression', 'call', 'method_call', 'function_call',
  'await_expression', 'macro_invocation',
]);

const CONTROL_FLOW_TYPES = new Set([
  'if_statement', 'if', 'if_expression',
  'for_statement', 'for', 'for_expression', 'for_in_statement',
  'while_statement', 'while', 'while_expression',
  'switch_statement', 'switch', 'match_expression',
  'try_statement', 'try',
  'return_statement', 'return',
  'throw_statement', 'throw', 'raise_statement', 'raise',
  'break_statement', 'break', 'continue_statement', 'continue',
]);

const DESTROY_METHODS = new Set([
  'dispose', 'destroy', 'close', 'delete', 'remove', 'cleanup', 'finalize', 'free', 'release',
]);

function isNewExpression(node: ASTNode): boolean {
  return node.type === 'new_expression' || node.type === 'object_creation_expression' ||
    node.type === 'class_instance_creation_expression' || node.text.includes('new ');
}

function isDestroyMethod(methodName: string): boolean {
  return DESTROY_METHODS.has(methodName.toLowerCase());
}

function isCallExpression(node: ASTNode): boolean {
  return CALL_NODE_TYPES.has(node.type) || node.type.includes('call');
}

function isControlFlow(node: ASTNode): boolean {
  return CONTROL_FLOW_TYPES.has(node.type);
}

function extractMethodName(node: ASTNode): string {
  const children = node.children;
  const funcNode = children.find((c) =>
    c.type === 'identifier' || c.type === 'property_identifier' || c.type === 'member_expression'
  );
  if (funcNode) {
    if (funcNode.type === 'member_expression') {
      const prop = funcNode.children.find((c) => c.type === 'property_identifier');
      return prop ? prop.text : funcNode.text;
    }
    return funcNode.text;
  }
  return '<anonymous>';
}

function extractArguments(node: ASTNode): string[] {
  const argsNode = node.children.find((c) =>
    c.type === 'arguments' || c.type === 'argument_list'
  );
  if (!argsNode) return [];
  return argsNode.children
    .filter((c) => c.type !== '(' && c.type !== ')' && c.type !== ',')
    .map((c) => c.text.trim().substring(0, 30));
}

function extractReceiver(callNode: ASTNode): { receiverName: string; isSelf: boolean } {
  const children = callNode.children;
  const memberExpr = children.find((c) => c.type === 'member_expression');
  if (memberExpr) {
    const objNode = memberExpr.children.find((c) => c.type === 'identifier' || c.type === 'this');
    if (objNode) {
      return {
        receiverName: objNode.text,
        isSelf: objNode.type === 'this' || objNode.text === 'self',
      };
    }
  }
  return { receiverName: '', isSelf: false };
}

function inferParticipantType(receiverName: string, _methodName: string): ParticipantType {
  if (!receiverName || receiverName === 'this' || receiverName === 'self') return 'self';
  if (receiverName === 'fetch' || receiverName === 'console' || receiverName === 'window') return 'external';
  if (receiverName.charAt(0) === receiverName.charAt(0).toUpperCase()) return 'class';
  return 'instance';
}

function getConditionText(node: ASTNode): string {
  const condNode = node.children.find((c) =>
    c.type === 'condition' || c.type === 'parenthesized_expression'
  );
  return condNode ? condNode.text.trim().substring(0, 40) : '';
}

function getBodyChildren(node: ASTNode): ASTNode[] {
  const body = node.children.find((c) =>
    c.type === 'block' || c.type === 'statement_block' || c.type === 'body'
  );
  if (body) return body.children;
  return node.children.filter((c) =>
    c.type !== 'condition' && c.type !== 'parenthesized_expression'
  );
}

function getElseBody(node: ASTNode): ASTNode[] {
  const elseNode = node.children.find((c) => c.type === 'else_clause' || c.type === 'else');
  if (!elseNode) return [];
  const body = elseNode.children.find((c) => c.type === 'block' || c.type === 'statement_block');
  return body ? body.children : elseNode.children;
}

function getCaseNodes(node: ASTNode): ASTNode[] {
  return node.children.filter((c) =>
    c.type === 'case_statement' || c.type === 'case' ||
    c.type === 'default_statement' || c.type === 'default'
  );
}

function getCaseLabel(node: ASTNode): string {
  if (node.type === 'default_statement' || node.type === 'default') return 'default';
  const labelNode = node.children.find((c) => c.type === 'identifier' || c.type === 'number');
  return labelNode ? labelNode.text : 'case';
}

function getCaseBody(node: ASTNode): ASTNode[] {
  return node.children.filter((c) =>
    c.type !== 'identifier' && c.type !== 'number' && c.type !== ':'
  );
}

function getCatchNodes(node: ASTNode): ASTNode[] {
  return node.children.filter((c) => c.type === 'catch_clause' || c.type === 'catch');
}

function getFinallyNode(node: ASTNode): ASTNode | null {
  return node.children.find((c) => c.type === 'finally_clause' || c.type === 'finally') ?? null;
}

export class SequenceAssembler {
  private seqCounter = 0;

  private nextId(prefix: string): string {
    return `${prefix}-${this.seqCounter++}`;
  }

  assemble(astRoot: ASTNode, filePath: string, functionName: string): AssembledDiagram {
    this.seqCounter = 0;

    const participants = new Map<string, Participant>();
    const messages: SequenceMessage[] = [];
    const fragments: CombinedFragment[] = [];
    let messageSeq = 0;

    const entryParticipant: Participant = {
      id: this.nextId('participant'),
      name: functionName,
      type: 'self',
      lifelineStart: 0,
      lifelineEnd: 0,
      isCreated: false,
      isDestroyed: false,
    };
    participants.set(functionName, entryParticipant);

    const funcNode = findFunctionNode(astRoot, functionName);
    if (!funcNode) {
      throw new Error(`Function "${functionName}" not found in AST of ${filePath}`);
    }
    const targetChildren = getFunctionBody(funcNode);

    this.processStatements(
      targetChildren,
      entryParticipant.id,
      participants,
      messages,
      fragments,
      (msg: SequenceMessage) => {
        msg.sequenceNumber = messageSeq++;
        messages.push(msg);
      },
    );

    for (const participant of participants.values()) {
      participant.lifelineEnd = messageSeq;
    }

    const sequenceData: SequenceData = {
      participants: Array.from(participants.values()),
      messages,
      fragments,
      entryFunctionName: functionName,
    };

    return this.toAssembledDiagram(sequenceData, filePath, functionName);
  }

  private processStatements(
    statements: ASTNode[],
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    for (const stmt of statements) {
      if (!stmt) continue;

      if (isCallExpression(stmt)) {
        this.processCall(stmt, selfId, participants, addMessage);
      } else if (isControlFlow(stmt)) {
        this.processControlFlow(stmt, selfId, participants, messages, fragments, addMessage);
      } else {
        const childCalls: ASTNode[] = [];
        this.collectCalls(stmt, childCalls);
        for (const call of childCalls) {
          this.processCall(call, selfId, participants, addMessage);
        }
      }
    }
  }

  private collectCalls(node: ASTNode, result: ASTNode[]): void {
    if (!node) return;
    const stack: ASTNode[] = [node];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (isCallExpression(current)) {
        result.push(current);
        continue;
      }
      const children = current.children;
      if (!children || !Array.isArray(children)) continue;
      for (const child of children) {
        stack.push(child);
      }
    }
  }

  private processCall(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const methodName = extractMethodName(node);
    const args = extractArguments(node);
    const { receiverName, isSelf } = extractReceiver(node);
    const isCreate = isNewExpression(node);

    let targetId: string;
    if (isSelf && !isCreate) {
      targetId = selfId;
    } else {
      const participantName = receiverName || methodName;
      if (!participants.has(participantName)) {
        const participantType = isCreate ? 'class' : inferParticipantType(receiverName, methodName);
        participants.set(participantName, {
          id: this.nextId('participant'),
          name: participantName,
          type: participantType,
          ...(receiverName && receiverName.charAt(0) === receiverName.charAt(0).toUpperCase() ? { className: receiverName } : {}),
          lifelineStart: 0,
          lifelineEnd: 0,
          isCreated: isCreate,
          isDestroyed: false,
        });
      } else if (isCreate) {
        const existing = participants.get(participantName)!;
        existing.isCreated = true;
      }
      targetId = participants.get(participantName)!.id;
    }

    if (!isSelf && !isCreate && isDestroyMethod(methodName)) {
      const participant = participants.get(receiverName || methodName);
      if (participant) {
        participant.isDestroyed = true;
      }
    }

    const msg: SequenceMessage = {
      id: this.nextId('msg'),
      sequenceNumber: 0,
      source: selfId,
      target: targetId,
      methodName,
      arguments: args,
      isAsync: node.type === 'await_expression' || node.type === 'await',
      isSelfCall: isSelf && !isCreate,
      isReturn: false,
      isCreate,
      lineNumber: node.startPosition.row + 1,
    };

    addMessage(msg);
  }

  private processControlFlow(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const t = node.type;

    if (t === 'if_statement' || t === 'if' || t === 'if_expression') {
      this.processIfFragment(node, selfId, participants, messages, fragments, addMessage);
    } else if (t === 'for_statement' || t === 'for' || t === 'for_expression' || t === 'for_in_statement' ||
               t === 'while_statement' || t === 'while' || t === 'while_expression') {
      this.processLoopFragment(node, selfId, participants, messages, fragments, addMessage);
    } else if (t === 'switch_statement' || t === 'switch' || t === 'match_expression') {
      this.processSwitchFragment(node, selfId, participants, messages, fragments, addMessage);
    } else if (t === 'try_statement' || t === 'try') {
      this.processTryFragment(node, selfId, participants, messages, fragments, addMessage);
    } else if (t === 'return_statement' || t === 'return') {
      this.processReturnMessage(node, selfId, participants, addMessage);
    } else if (t === 'throw_statement' || t === 'throw' || t === 'raise_statement' || t === 'raise') {
      this.processThrowFragment(node, selfId, participants, messages, fragments, addMessage);
    }
  }

  private processIfFragment(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const condText = getConditionText(node);
    const elseBody = getElseBody(node);

    const fragmentType: FragmentType = elseBody.length > 0 ? 'alt' : 'opt';
    const startSeq = messages.length;

    const trueBody = getBodyChildren(node);
    this.processStatements(trueBody, selfId, participants, messages, fragments, addMessage);
    const trueEnd = messages.length;

    const operands: FragmentOperand[] = [
      { guardCondition: condText, startMessage: startSeq, endMessage: trueEnd },
    ];

    if (elseBody.length > 0) {
      const elseStart = messages.length;
      this.processStatements(elseBody, selfId, participants, messages, fragments, addMessage);
      const elseEnd = messages.length;
      operands.push({ guardCondition: 'else', startMessage: elseStart, endMessage: elseEnd });
    }

    const endSeq = messages.length;

    fragments.push({
      id: this.nextId('fragment'),
      type: fragmentType,
      condition: condText,
      startMessage: startSeq,
      endMessage: endSeq,
      operands,
    });
  }

  private processLoopFragment(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const condText = getConditionText(node);
    const startSeq = messages.length;

    const body = getBodyChildren(node);
    this.processStatements(body, selfId, participants, messages, fragments, addMessage);

    const endSeq = messages.length;

    fragments.push({
      id: this.nextId('fragment'),
      type: 'loop',
      condition: condText,
      loopConstraint: condText,
      startMessage: startSeq,
      endMessage: endSeq,
      operands: [{ guardCondition: condText, startMessage: startSeq, endMessage: endSeq }],
    });
  }

  private processSwitchFragment(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const condText = getConditionText(node);
    const startSeq = messages.length;

    const caseNodes = getCaseNodes(node);
    const operands: FragmentOperand[] = [];

    for (const caseNode of caseNodes) {
      const label = getCaseLabel(caseNode);
      const caseBody = getCaseBody(caseNode);
      const caseStart = messages.length;
      this.processStatements(caseBody, selfId, participants, messages, fragments, addMessage);
      const caseEnd = messages.length;
      operands.push({
        guardCondition: label === 'default' ? 'default' : `case ${label}`,
        startMessage: caseStart,
        endMessage: caseEnd,
      });
    }

    const endSeq = messages.length;

    fragments.push({
      id: this.nextId('fragment'),
      type: 'alt',
      condition: condText,
      startMessage: startSeq,
      endMessage: endSeq,
      operands,
    });
  }

  private processTryFragment(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const startSeq = messages.length;

    const tryBody = node.children.find((c) => c.type === 'block' || c.type === 'statement_block');
    const tryStmts = tryBody ? tryBody.children : [];
    this.processStatements(tryStmts, selfId, participants, messages, fragments, addMessage);
    const tryEnd = messages.length;

    fragments.push({
      id: this.nextId('fragment'),
      type: 'critical',
      condition: 'try',
      startMessage: startSeq,
      endMessage: tryEnd,
      operands: [{ startMessage: startSeq, endMessage: tryEnd }],
    });

    const catchNodes = getCatchNodes(node);
    for (const catchNode of catchNodes) {
      const catchStart = messages.length;
      const catchBody = catchNode.children.find((c) => c.type === 'block' || c.type === 'statement_block');
      const catchStmts = catchBody ? catchBody.children : [];
      this.processStatements(catchStmts, selfId, participants, messages, fragments, addMessage);
      const catchEnd = messages.length;

      fragments.push({
        id: this.nextId('fragment'),
        type: 'break',
        condition: 'catch',
        startMessage: catchStart,
        endMessage: catchEnd,
        operands: [{ guardCondition: 'exception', startMessage: catchStart, endMessage: catchEnd }],
      });
    }

    const finallyNode = getFinallyNode(node);
    if (finallyNode) {
      const finallyStart = messages.length;
      const finallyBody = finallyNode.children.find((c) => c.type === 'block' || c.type === 'statement_block');
      const finallyStmts = finallyBody ? finallyBody.children : [];
      this.processStatements(finallyStmts, selfId, participants, messages, fragments, addMessage);
      const finallyEnd = messages.length;

      fragments.push({
        id: this.nextId('fragment'),
        type: 'critical',
        condition: 'finally',
        startMessage: finallyStart,
        endMessage: finallyEnd,
        operands: [{ startMessage: finallyStart, endMessage: finallyEnd }],
      });
    }
  }

  private processReturnMessage(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const msg: SequenceMessage = {
      id: this.nextId('msg'),
      sequenceNumber: 0,
      source: selfId,
      target: selfId,
      methodName: 'return',
      arguments: [node.text.trim().substring(0, 30)],
      isAsync: false,
      isSelfCall: true,
      isReturn: true,
      isCreate: false,
      lineNumber: node.startPosition.row + 1,
    };
    addMessage(msg);
  }

  private processThrowFragment(
    node: ASTNode,
    selfId: string,
    participants: Map<string, Participant>,
    messages: SequenceMessage[],
    fragments: CombinedFragment[],
    addMessage: (msg: SequenceMessage) => void,
  ): void {
    const startSeq = messages.length;

    const msg: SequenceMessage = {
      id: this.nextId('msg'),
      sequenceNumber: 0,
      source: selfId,
      target: selfId,
      methodName: 'throw',
      arguments: [node.text.trim().substring(0, 30)],
      isAsync: false,
      isSelfCall: true,
      isReturn: true,
      isCreate: false,
      lineNumber: node.startPosition.row + 1,
    };
    addMessage(msg);

    const endSeq = messages.length;

    fragments.push({
      id: this.nextId('fragment'),
      type: 'break',
      condition: 'throw',
      startMessage: startSeq,
      endMessage: endSeq,
      operands: [{ guardCondition: 'exception', startMessage: startSeq, endMessage: endSeq }],
    });
  }

  private toAssembledDiagram(
    sequenceData: SequenceData,
    filePath: string,
    functionName: string,
  ): AssembledDiagram {
    const nodes: GraphNode[] = sequenceData.participants.map((p) => ({
      id: NodeId(p.id),
      label: p.name,
      type: p.type === 'class' ? 'class' : p.type === 'module' ? 'module' : 'function',
      filePath: filePath,
      lineNumber: 0,
      properties: {
        participantType: p.type,
        ...(p.className ? { className: p.className } : {}),
        lifelineStart: p.lifelineStart,
        lifelineEnd: p.lifelineEnd,
        isCreated: p.isCreated,
        isDestroyed: p.isDestroyed,
        seqFunction: functionName,
      },
    }));

    const edges: GraphEdge[] = sequenceData.messages.map((msg, idx) => ({
      id: EdgeId(`seq-edge-${idx}`),
      source: NodeId(msg.source),
      target: NodeId(msg.target),
      type: 'call',
      properties: {
        sequenceNumber: msg.sequenceNumber,
        methodName: msg.methodName,
        arguments: msg.arguments,
        isAsync: msg.isAsync,
        isSelfCall: msg.isSelfCall,
        isReturn: msg.isReturn,
        isCreate: msg.isCreate,
        ...(msg.fragmentId ? { fragmentId: msg.fragmentId } : {}),
        lineNumber: msg.lineNumber,
      },
    }));

    for (const fragment of sequenceData.fragments) {
      const fragmentNode: GraphNode = {
        id: NodeId(fragment.id),
        label: `${fragment.type}${fragment.condition ? ` [${fragment.condition}]` : ''}`,
        type: 'type',
        filePath,
        lineNumber: 0,
        properties: {
          fragmentType: fragment.type,
          ...(fragment.condition ? { condition: fragment.condition } : {}),
          ...(fragment.loopConstraint ? { loopConstraint: fragment.loopConstraint } : {}),
          startMessage: fragment.startMessage,
          endMessage: fragment.endMessage,
          ...(fragment.parentId ? { parentId: fragment.parentId } : {}),
          operands: fragment.operands,
          seqFunction: functionName,
          isFragment: true,
        },
      };
      nodes.push(fragmentNode);
    }

    return {
      nodes,
      edges,
      metadata: {
        rootIds: sequenceData.participants.length > 0 ? [sequenceData.participants[0]!.id] : [],
        maxDepth: sequenceData.fragments.length > 0 ? Math.max(...sequenceData.fragments.map((f) => f.operands.length)) : 0,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };
  }
}
