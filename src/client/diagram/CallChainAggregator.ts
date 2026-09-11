import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId, EdgeId } from '../../types/index.ts';
import type { AssembledDiagram } from './DiagramAssembler.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { CFGAssembler } from './CFGAssembler.ts';


const MAX_FUNCTIONS = 20;

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
    options: CallChainAggregateOptions = { depth: 2, maxFunctions: MAX_FUNCTIONS },
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
    for (const fnId of includedFunctions) {
      const fnNode = nodes.find((n) => n.id === fnId);
      if (fnNode) functionNodeMap.set(fnId, fnNode);
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
            callChainDepth: includedFunctions.indexOf(fnId),
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

    for (const { source, target } of callChainEdges) {
      const sourceFn = functionNodeMap.get(source);
      const targetFn = functionNodeMap.get(target);
      if (!sourceFn || !targetFn) continue;

      const sourceIdx = includedFunctions.indexOf(source);
      const targetIdx = includedFunctions.indexOf(target);
      const sourcePrefix = `fn${sourceIdx}__`;
      const targetPrefix = `fn${targetIdx}__`;

      const sourceExitNodes = allNodes.filter(
        (n) => n.id.startsWith(sourcePrefix) && n.properties?.isExit === true,
      );
      const targetEntryNodes = allNodes.filter(
        (n) => n.id.startsWith(targetPrefix) && n.properties?.isEntry === true,
      );

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

    const chainDepth = Math.max(
      0,
      ...includedFunctions.map((id) => includedFunctions.indexOf(id)),
    );

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