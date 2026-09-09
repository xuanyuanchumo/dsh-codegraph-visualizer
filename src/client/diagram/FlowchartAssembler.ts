import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode, StatementInfo } from './CFGTypes.ts';
import { CFGAssembler } from './CFGAssembler.ts';

const PROCESS_KEYWORDS: Record<string, string> = {
  init: '初始化',
  prepare: '数据准备',
  load: '加载数据',
  save: '保存数据',
  fetch: '获取数据',
  find: '查找',
  create: '创建',
  update: '更新',
  delete: '删除',
  validate: '验证',
  check: '检查',
  parse: '解析',
  format: '格式化',
  transform: '转换',
  render: '渲染',
  compute: '计算',
  build: '构建',
  register: '注册',
  cleanup: '清理',
  destroy: '销毁',
  start: '开始',
  stop: '停止',
  handle: '处理',
  send: '发送',
  receive: '接收',
  read: '读取',
  write: '写入',
  log: '记录日志',
  notify: '通知',
  dispatch: '分发',
  resolve: '解析',
  reject: '拒绝',
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

let fcCounter = 0;

function nextFcId(): string {
  return `fc-node-${fcCounter++}`;
}

function resetCounter(): void {
  fcCounter = 0;
}

function inferSemanticLabel(statements: StatementInfo[], blockLabel: string): string {
  if (statements.length === 0) return blockLabel;

  const firstStmt = statements[0];
  if (!firstStmt) return blockLabel;

  const text = firstStmt.text.toLowerCase();

  for (const [keyword, label] of Object.entries(PROCESS_KEYWORDS)) {
    if (text.includes(keyword)) return label;
  }

  if (firstStmt.type === 'return') return '返回结果';
  if (firstStmt.type === 'throw') return '抛出异常';

  if (statements.length === 1) {
    return simplifyForLabel(firstStmt.text);
  }

  const verbMatch = text.match(/^(\w+)\s*\(/);
  if (verbMatch && verbMatch[1]) {
    const verb = verbMatch[1];
    if (PROCESS_KEYWORDS[verb]) return PROCESS_KEYWORDS[verb];
    return `${verb}()`;
  }

  return `${statements.length} 条语句`;
}

function simplifyForLabel(text: string, maxLen = 20): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.substring(0, maxLen - 3) + '...';
}

function conditionToQuestion(condText: string): string {
  const trimmed = condText.trim();

  if (trimmed.startsWith('if') || trimmed.startsWith('if (') || trimmed.startsWith('if(')) {
    const inner = trimmed.replace(/^if\s*\(?/, '').replace(/\)?$/, '').trim();
    return `${inner}?`;
  }

  if (trimmed.startsWith('while') || trimmed.startsWith('for')) {
    return `循环: ${trimmed}`;
  }

  return `${trimmed}?`;
}

export class FlowchartAssembler {
  private cfgAssembler = new CFGAssembler();

  assemble(astRoot: ASTNode, filePath: string, functionName: string): AssembledDiagram {
    resetCounter();

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
      const fcId = nextFcId();
      blockToFc.set(block.id, fcId);

      let nodeType: FlowchartNode['nodeType'] = 'process';
      let label = block.label;

      if (block.isEntry) {
        nodeType = 'start';
        label = '开始';
      } else if (block.isExit) {
        nodeType = block.label === 'throw' ? 'error' : 'end';
        label = block.label === 'throw' ? '异常退出' : '结束';
      } else if (block.blockType === 'condition') {
        nodeType = 'decision';
        label = conditionToQuestion(block.label);
      } else if (block.blockType === 'loop') {
        nodeType = 'loop';
        label = conditionToQuestion(block.label);
      } else if (block.blockType === 'switch') {
        nodeType = 'decision';
        label = `switch: ${block.label}`;
      } else if (block.blockType === 'try') {
        nodeType = 'process';
        label = '尝试执行';
      } else if (block.blockType === 'catch') {
        nodeType = 'error';
        label = '捕获异常';
      } else if (block.blockType === 'finally') {
        nodeType = 'process';
        label = '最终处理';
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
        edgeLabel = '是';
        flowchartEdgeType = 'yes';
      } else if (edge.edgeType === 'false') {
        edgeLabel = '否';
        flowchartEdgeType = 'no';
      } else if (edge.edgeType === 'loop-back') {
        edgeLabel = '循环';
        flowchartEdgeType = 'loop';
      } else if (edge.edgeType === 'exception') {
        edgeLabel = '异常';
        flowchartEdgeType = 'error';
      } else if (edge.edgeType === 'case') {
        edgeLabel = edge.condition;
      } else if (edge.edgeType === 'default') {
        edgeLabel = '默认';
      } else if (edge.edgeType === 'break') {
        edgeLabel = '跳出';
      } else if (edge.edgeType === 'continue') {
        edgeLabel = '继续';
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