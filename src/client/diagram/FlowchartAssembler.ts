import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode, StatementInfo } from '../../shared/CFGTypes.ts';
import { CFGAssembler } from './CFGAssembler.ts';
import { simplifyText as simplifyTextShared } from '../../shared/astUtils.ts';
import { t } from '../i18n/index.ts';

const PROCESS_KEYWORDS: Record<string, string> = {
  init: 'flowchart.semantic.init',
  prepare: 'flowchart.semantic.prepare',
  load: 'flowchart.semantic.load',
  save: 'flowchart.semantic.save',
  fetch: 'flowchart.semantic.fetch',
  find: 'flowchart.semantic.find',
  create: 'flowchart.semantic.create',
  update: 'flowchart.semantic.update',
  delete: 'flowchart.semantic.delete',
  validate: 'flowchart.semantic.validate',
  check: 'flowchart.semantic.check',
  parse: 'flowchart.semantic.parse',
  format: 'flowchart.semantic.format',
  transform: 'flowchart.semantic.transform',
  render: 'flowchart.semantic.render',
  compute: 'flowchart.semantic.compute',
  build: 'flowchart.semantic.build',
  register: 'flowchart.semantic.register',
  cleanup: 'flowchart.semantic.cleanup',
  destroy: 'flowchart.semantic.destroy',
  start: 'flowchart.semantic.start',
  stop: 'flowchart.semantic.stop',
  handle: 'flowchart.semantic.handle',
  send: 'flowchart.semantic.send',
  receive: 'flowchart.semantic.receive',
  read: 'flowchart.semantic.read',
  write: 'flowchart.semantic.write',
  log: 'flowchart.semantic.log',
  notify: 'flowchart.semantic.notify',
  dispatch: 'flowchart.semantic.dispatch',
  resolve: 'flowchart.semantic.resolve',
  reject: 'flowchart.semantic.reject',
};

export interface FlowchartNode {
  id: string;
  label: string;
  nodeType: 'start' | 'end' | 'process' | 'decision' | 'loop' | 'io' | 'subprocess' | 'error';
  description?: string;
  depth: number;
}

export interface FlowchartEdge {
  source: string;
  target: string;
  label?: string;
  edgeType: 'normal' | 'yes' | 'no' | 'loop' | 'error';
}

function inferSemanticLabel(statements: StatementInfo[], blockLabel: string): string {
  if (statements.length === 0) return blockLabel;

  const firstStmt = statements[0];
  if (!firstStmt) return blockLabel;

  const text = firstStmt.text.toLowerCase();

  for (const [keyword, i18nKey] of Object.entries(PROCESS_KEYWORDS)) {
    if (text.includes(keyword)) return t(i18nKey);
  }

  if (firstStmt.type === 'return') return t('flowchart.returnResult');
  if (firstStmt.type === 'throw') return t('flowchart.throwException');

  if (statements.length === 1) {
    return simplifyForLabel(firstStmt.text);
  }

  const verbMatch = text.match(/^(\w+)\s*\(/);
  if (verbMatch && verbMatch[1]) {
    const verb = verbMatch[1];
    if (PROCESS_KEYWORDS[verb]) return t(PROCESS_KEYWORDS[verb]!);
    return `${verb}()`;
  }

  return t('flowchart.statementsCount', { n: statements.length });
}

function simplifyForLabel(text: string, maxLen = 20): string {
  return simplifyTextShared(text, maxLen);
}

function conditionToQuestion(condText: string): string {
  const trimmed = condText.trim();

  if (trimmed.startsWith('if') || trimmed.startsWith('if (') || trimmed.startsWith('if(')) {
    const inner = trimmed.replace(/^if\s*\(?/, '').replace(/\)?$/, '').trim();
    return `${inner}?`;
  }

  if (trimmed.startsWith('while') || trimmed.startsWith('for')) {
    return t('flowchart.loopPrefix', { cond: trimmed });
  }

  return `${trimmed}?`;
}

export class FlowchartAssembler {
  private cfgAssembler: CFGAssembler;
  private fcCounter = 0;

  constructor(cfgAssembler?: CFGAssembler) {
    this.cfgAssembler = cfgAssembler ?? new CFGAssembler();
  }

  private nextFcId(): string {
    return `fc-node-${this.fcCounter++}`;
  }

  assemble(astRoot: ASTNode, filePath: string, functionName: string): AssembledDiagram {
    this.fcCounter = 0;

    const cfgResult = this.cfgAssembler.assemble(astRoot, filePath, functionName);

    const cfgBlocks = cfgResult.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      blockType: n.properties.blockType as string,
      isEntry: n.properties.isEntry as boolean,
      isExit: n.properties.isExit as boolean,
      depth: n.properties.depth as number,
      statements: n.properties.statements as StatementInfo[],
    }));

    const cfgEdges = cfgResult.edges.map((e) => ({
      source: e.source,
      target: e.target,
      edgeType: e.properties.cfgEdgeType as string,
      condition: e.properties.condition as string | undefined,
    }));

    const fcNodes: FlowchartNode[] = [];
    const fcEdges: FlowchartEdge[] = [];
    const blockToFc = new Map<string, string>();

    for (const block of cfgBlocks) {
      const fcId = this.nextFcId();
      blockToFc.set(block.id, fcId);

      let nodeType: FlowchartNode['nodeType'] = 'process';
      let label = block.label;

      if (block.isEntry) {
        nodeType = 'start';
        label = t('flowchart.start');
      } else if (block.isExit) {
        nodeType = block.label === 'throw' ? 'error' : 'end';
        label = block.label === 'throw' ? t('flowchart.errorExit') : t('flowchart.end');
      } else if (block.blockType === 'condition') {
        nodeType = 'decision';
        label = conditionToQuestion(block.label);
      } else if (block.blockType === 'loop') {
        nodeType = 'loop';
        label = conditionToQuestion(block.label);
      } else if (block.blockType === 'switch') {
        nodeType = 'decision';
        label = t('flowchart.switchPrefix', { expr: block.label });
      } else if (block.blockType === 'try') {
        nodeType = 'process';
        label = t('flowchart.tryBlock');
      } else if (block.blockType === 'catch') {
        nodeType = 'error';
        label = t('flowchart.catchBlock');
      } else if (block.blockType === 'finally') {
        nodeType = 'process';
        label = t('flowchart.finallyBlock');
      } else {
        nodeType = 'process';
        label = inferSemanticLabel(block.statements, block.label);
      }

      fcNodes.push({
        id: fcId,
        label,
        nodeType,
        depth: block.depth,
      });
    }

    for (const edge of cfgEdges) {
      const sourceFc = blockToFc.get(edge.source);
      const targetFc = blockToFc.get(edge.target);
      if (!sourceFc || !targetFc) continue;

      let edgeLabel: string | undefined;
      let flowchartEdgeType: FlowchartEdge['edgeType'] = 'normal';

      if (edge.edgeType === 'true') {
        edgeLabel = t('flowchart.edge.yes');
        flowchartEdgeType = 'yes';
      } else if (edge.edgeType === 'false') {
        edgeLabel = t('flowchart.edge.no');
        flowchartEdgeType = 'no';
      } else if (edge.edgeType === 'loop-back') {
        edgeLabel = t('flowchart.edge.loop');
        flowchartEdgeType = 'loop';
      } else if (edge.edgeType === 'exception') {
        edgeLabel = t('flowchart.edge.error');
        flowchartEdgeType = 'error';
      } else if (edge.edgeType === 'case') {
        edgeLabel = edge.condition;
      } else if (edge.edgeType === 'default') {
        edgeLabel = t('flowchart.edge.default');
      } else if (edge.edgeType === 'break') {
        edgeLabel = t('flowchart.edge.break');
      } else if (edge.edgeType === 'continue') {
        edgeLabel = t('flowchart.edge.continue');
      }

      fcEdges.push({
        source: sourceFc,
        target: targetFc,
        ...(edgeLabel ? { label: edgeLabel } : {}),
        edgeType: flowchartEdgeType,
      });
    }

    return this.toAssembledDiagram(fcNodes, fcEdges, filePath, functionName);
  }

  private toAssembledDiagram(
    fcNodes: FlowchartNode[],
    fcEdges: FlowchartEdge[],
    filePath: string,
    functionName: string,
  ): AssembledDiagram {
    const nodes: GraphNode[] = fcNodes.map((node) => ({
      id: NodeId(node.id),
      label: node.label,
      type: 'function',
      filePath,
      lineNumber: 0,
      properties: {
        flowchartNodeType: node.nodeType,
        depth: node.depth,
        ...(node.description ? { description: node.description } : {}),
        fcFunction: functionName,
      },
    }));

    const edges: GraphEdge[] = fcEdges.map((edge, idx) => ({
      id: EdgeId(`fc-edge-${idx}`),
      source: NodeId(edge.source),
      target: NodeId(edge.target),
      type: 'call',
      properties: {
        flowchartEdgeType: edge.edgeType,
        ...(edge.label ? { label: edge.label } : {}),
      },
    }));

    const startIds = nodes.filter((n) => n.properties.flowchartNodeType === 'start').map((n) => n.id);

    return {
      nodes,
      edges,
      metadata: {
        rootIds: startIds,
        maxDepth: Math.max(0, ...nodes.map((n) => (n.properties.depth as number) ?? 0)),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
    };
  }
}
