import type { Core } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types/index.ts';

export class FilterController {
  private cy: Core;

  constructor(cy: Core) {
    this.cy = cy;
  }

  filterByType(type: string): void {
    const hidden = new Set<string>();
    if (type !== 'all') {
      this.cy.nodes().forEach((node) => {
        const isCluster = node.data('isCluster') === true;
        if (!isCluster && node.data('type') !== type) hidden.add(node.id());
      });
    }
    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const isFiltered = hidden.has(node.id());
        node.data('typeFiltered', isFiltered);
        const connectionFiltered = node.data('connectionFiltered') === true;
        node.style('display', (isFiltered || connectionFiltered) ? 'none' : 'element');
      });
      this.cy.edges().forEach((edge) => {
        const hiddenEdge = hidden.has(edge.source().id()) || hidden.has(edge.target().id());
        edge.data('typeFiltered', hiddenEdge);
        const connectionFiltered = edge.data('connectionFiltered') === true;
        edge.style('display', (hiddenEdge || connectionFiltered) ? 'none' : 'element');
      });
    });
  }

  filterByGraphType(graphType: 'all' | 'call' | 'dependency'): void {
    const allowedEdgeTypes = new Set<string>();
    if (graphType === 'all') {
      allowedEdgeTypes.add('call'); allowedEdgeTypes.add('import');
      allowedEdgeTypes.add('extend'); allowedEdgeTypes.add('implement');
      allowedEdgeTypes.add('dependency'); allowedEdgeTypes.add('contains');
    } else if (graphType === 'call') {
      allowedEdgeTypes.add('call');
    } else if (graphType === 'dependency') {
      allowedEdgeTypes.add('import'); allowedEdgeTypes.add('dependency');
    }

    const connectedNodeIds = new Set<string>();
    this.cy.batch(() => {
      this.cy.edges().forEach((edge) => {
        const edgeType = edge.data('type') as string;
        const visible = allowedEdgeTypes.has(edgeType);
        edge.data('typeFiltered', !visible);
        const connectionFiltered = edge.data('connectionFiltered') === true;
        edge.style('display', (!visible || connectionFiltered) ? 'none' : 'element');
        if (visible) {
          connectedNodeIds.add(edge.source().id());
          connectedNodeIds.add(edge.target().id());
        }
      });
      this.cy.nodes().forEach((node) => {
        const isFiltered = !connectedNodeIds.has(node.id());
        node.data('typeFiltered', isFiltered);
        const connectionFiltered = node.data('connectionFiltered') === true;
        node.style('display', (isFiltered || connectionFiltered) ? 'none' : 'element');
      });
    });
  }

  applyConnectionFilters(
    fanInThreshold: number,
    fanOutThreshold: number,
    visibleNodeTypes: Set<GraphNode['type']>,
    visibleEdgeTypes: Set<GraphEdge['type']>,
  ): void {
    const fanInCount = new Map<string, number>();
    const fanOutCount = new Map<string, number>();
    this.cy.edges().forEach((edge) => {
      const source = edge.source().id();
      const target = edge.target().id();
      fanOutCount.set(source, (fanOutCount.get(source) ?? 0) + 1);
      fanInCount.set(target, (fanInCount.get(target) ?? 0) + 1);
    });

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const isCluster = node.data('isCluster') === true;
        let hidden = false;

        if (!isCluster && fanInThreshold > 0) {
          const inCount = fanInCount.get(node.id()) ?? 0;
          if (inCount < fanInThreshold) hidden = true;
        }

        if (!isCluster && fanOutThreshold > 0) {
          const outCount = fanOutCount.get(node.id()) ?? 0;
          if (outCount < fanOutThreshold) hidden = true;
        }

        if (!isCluster && visibleNodeTypes.size > 0) {
          const nodeType = node.data('type') as GraphNode['type'];
          if (!visibleNodeTypes.has(nodeType)) hidden = true;
        }

        node.data('connectionFiltered', hidden);
        const typeFiltered = node.data('typeFiltered') === true;
        node.style('display', (hidden || typeFiltered) ? 'none' : 'element');
      });

      this.cy.edges().forEach((edge) => {
        let hidden = false;

        if (visibleEdgeTypes.size > 0) {
          const edgeType = edge.data('type') as GraphEdge['type'];
          if (!visibleEdgeTypes.has(edgeType)) hidden = true;
        }

        const sourceHidden = edge.source().data('connectionFiltered') === true;
        const targetHidden = edge.target().data('connectionFiltered') === true;
        if (sourceHidden || targetHidden) hidden = true;

        edge.data('connectionFiltered', hidden);
        const typeFiltered = edge.data('typeFiltered') === true;
        edge.style('display', (hidden || typeFiltered) ? 'none' : 'element');
      });
    });
  }

  destroy(): void {
    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        node.removeData('typeFiltered');
        node.removeData('connectionFiltered');
        node.style('display', 'element');
      });
      this.cy.edges().forEach((edge) => {
        edge.removeData('typeFiltered');
        edge.removeData('connectionFiltered');
        edge.style('display', 'element');
      });
    });
  }
}