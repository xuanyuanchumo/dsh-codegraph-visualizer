import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { CFGAssembler } from './CFGAssembler.ts';
import { CALL_CHAIN } from '../../shared/constants.ts';



export interface CallChainAggregateOptions {
  depth: number;
  maxFunctions: number;
}

export interface CallChainResult {
  diagram: AssembledDiagram;
  functionCount: number;
  chainDepth: number;
  includedFunctions: string[];
}

export class CallChainAggregator {
  private cfgAssembler = new CFGAssembler();

  async aggregate(
    entryNodeId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    astFetcher: (filePath: string) => Promise<ASTNode | null>,
    options: CallChainAggregateOptions = { depth: 2, maxFunctions: CALL_CHAIN.MAX_FUNCTIONS },
  ): Promise<CallChainResult | null> {
    const entryNode = nodes.find((n) => n.id === entryNodeId);
    if (!entryNode || entryNode.type !== 'function') return null;

    const callEdges = edges.filter((e) => e.type === 'call');
    const outEdges = new Map<string, string[]>();
    for (const e of callEdges) {
      if (e.source === e.target) continue;
      const list = outEdges.get(e.source) ?? [];
      list.push(e.target);
      outEdges.set(e.source, list);
    }

    const visited = new Set<string>([entryNodeId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: entryNodeId, depth: 0 }];
    const includedFunctions: string[] = [entryNodeId];
    const callChainEdges: Array<{ source: string; target: string }> = [];

    let head = 0;
    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      if (depth >= options.depth) continue;
      if (includedFunctions.length >= options.maxFunctions) break;

      const neighbors = outEdges.get(id) ?? [];
      for (const target of neighbors) {
        if (visited.has(target)) continue;
        visited.add(target);
        includedFunctions.push(target);
        callChainEdges.push({ source: id, target });
        queue.push({ id: target, depth: depth + 1 });
      }
    }

    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const functionNodeMap = new Map<string, GraphNode>();
    const functionIndexMap = new Map<string, number>();
    for (let i = 0; i < includedFunctions.length; i++) {
      functionIndexMap.set(includedFunctions[i]!, i);
      const fnNode = nodes.find((n) => n.id === includedFunctions[i]);
      if (fnNode) functionNodeMap.set(includedFunctions[i]!, fnNode);
    }

    const astCache = new Map<string, ASTNode | null>();
    let functionCount = 0;

    for (const fnId of includedFunctions) {
      const fnNode = functionNodeMap.get(fnId);
      if (!fnNode) continue;

      let astRoot = astCache.get(fnNode.filePath);
      if (astRoot === undefined) {
        astRoot = await astFetcher(fnNode.filePath);
        astCache.set(fnNode.filePath, astRoot);
      }
      if (!astRoot) continue;

      const fnDiagram = this.cfgAssembler.assemble(astRoot, fnNode.filePath, fnNode.label);

      const prefix = `fn${functionCount}__`;
      const blockIdMap = new Map<string, string>();

      for (const blockNode of fnDiagram.nodes) {
        const newId = prefix + blockNode.id;
        blockIdMap.set(blockNode.id, newId);
        allNodes.push({
          ...blockNode,
          id: NodeId(newId),
          properties: {
            ...blockNode.properties,
            callChainFunction: fnNode.label,
            callChainFunctionId: fnId,
            callChainDepth: functionIndexMap.get(fnId) ?? 0,
          },
        });
      }

      for (const edge of fnDiagram.edges) {
        const newSource = blockIdMap.get(edge.source);
        const newTarget = blockIdMap.get(edge.target);
        if (newSource && newTarget) {
          allEdges.push({
            ...edge,
            id: EdgeId(prefix + edge.id),
            source: NodeId(newSource),
            target: NodeId(newTarget),
          });
        }
      }

      functionCount++;
    }

    const nodesByPrefix = new Map<string, GraphNode[]>();
    for (const n of allNodes) {
      const prefixKey = n.id.split('__')[0]!;
      const list = nodesByPrefix.get(prefixKey) ?? [];
      list.push(n);
      nodesByPrefix.set(prefixKey, list);
    }

    for (const { source, target } of callChainEdges) {
      const sourceFn = functionNodeMap.get(source);
      const targetFn = functionNodeMap.get(target);
      if (!sourceFn || !targetFn) continue;

      const sourceIdx = functionIndexMap.get(source) ?? 0;
      const targetIdx = functionIndexMap.get(target) ?? 0;
      const sourcePrefix = `fn${sourceIdx}`;
      const targetPrefix = `fn${targetIdx}`;

      const sourceFnNodes = nodesByPrefix.get(sourcePrefix) ?? [];
      const targetFnNodes = nodesByPrefix.get(targetPrefix) ?? [];
      const sourceExitNodes = sourceFnNodes.filter((n) => n.properties?.isExit === true);
      const targetEntryNodes = targetFnNodes.filter((n) => n.properties?.isEntry === true);

      if (sourceExitNodes.length > 0 && targetEntryNodes.length > 0) {
        const sourceExit = sourceExitNodes[0]!;
        const targetEntry = targetEntryNodes[0]!;
        allEdges.push({
          id: EdgeId(`callchain__${source}__${target}`),
          source: NodeId(sourceExit.id),
          target: NodeId(targetEntry.id),
          type: 'call',
          properties: {
            callChainEdge: true,
            sourceFunction: sourceFn.label,
            targetFunction: targetFn.label,
          },
        });
      }
    }

    if (allNodes.length === 0) return null;

    const chainDepth = includedFunctions.length > 0 ? includedFunctions.length - 1 : 0;

    return {
      diagram: {
        nodes: allNodes,
        edges: allEdges,
        metadata: {
          rootIds: [`fn0__cfg-block-0`],
          maxDepth: chainDepth,
          nodeCount: allNodes.length,
          edgeCount: allEdges.length,
        },
      },
      functionCount,
      chainDepth,
      includedFunctions,
    };
  }
}