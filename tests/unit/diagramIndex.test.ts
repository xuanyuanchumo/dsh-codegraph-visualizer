import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assembleDiagram,
  assembleMicroDiagram,
  assembleCFG,
  assembleFlowchart,
  assembleSequence,
  registerMacroAssembler,
  registerMicroAssembler,
  getLayerDefinitions,
  getLayerData,
} from '../../src/client/diagram/index.ts';
import { InheritanceAssembler } from '../../src/client/diagram/InheritanceAssembler.ts';
import { CallGraphAssembler } from '../../src/client/diagram/CallGraphAssembler.ts';
import { PackageAssembler } from '../../src/client/diagram/PackageAssembler.ts';
import { ClassAssembler } from '../../src/client/diagram/ClassAssembler.ts';
import { DependencyAssembler } from '../../src/client/diagram/DependencyAssembler.ts';
import { CFGAssembler } from '../../src/client/diagram/CFGAssembler.ts';
import { FlowchartAssembler } from '../../src/client/diagram/FlowchartAssembler.ts';
import { SequenceAssembler } from '../../src/client/diagram/SequenceAssembler.ts';
import type { GraphNode, GraphEdge, ViewMode } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { ASTNode } from '../../src/shared/CFGTypes.ts';
import type { AssembledDiagram, DiagramAssembler } from '../../src/client/diagram/DiagramAssembler.ts';

// ── Test helpers ──────────────────────────────────────────────────────

function makeNode(
  id: string,
  type: GraphNode['type'],
  label: string,
  filePath = `src/${id}.ts`,
  lineNumber = 1,
  properties: Record<string, unknown> = {},
): GraphNode {
  return { id: NodeId(id), label, type, filePath, lineNumber, properties };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  type: GraphEdge['type'],
  properties: Record<string, unknown> = {},
): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties };
}

function makeAstNode(
  type: string,
  text: string,
  children: ASTNode[] = [],
  row = 0,
): ASTNode {
  return {
    type,
    text,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

function makeMockFetchResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

// ── Sample data builders ──────────────────────────────────────────────

function makeInheritanceData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [
    makeNode('A', 'class', 'ClassA', 'src/A.ts', 1),
    makeNode('B', 'class', 'ClassB', 'src/B.ts', 1),
    makeNode('C', 'class', 'ClassC', 'src/C.ts', 1),
  ];
  const edges = [
    makeEdge('e1', 'B', 'A', 'extend'),
    makeEdge('e2', 'C', 'B', 'extend'),
  ];
  return { nodes, edges };
}

function makeCallGraphData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [
    makeNode('main', 'function', 'main', 'src/main.ts', 1, { isExported: true }),
    makeNode('helper', 'function', 'helper', 'src/helper.ts', 1),
    makeNode('util', 'function', 'util', 'src/util.ts', 1),
  ];
  const edges = [
    makeEdge('e1', 'main', 'helper', 'call'),
    makeEdge('e2', 'helper', 'util', 'call'),
  ];
  return { nodes, edges };
}

function makePackageData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [
    makeNode('mod1', 'module', 'mod1', 'src/utils/mod1.ts', 1),
    makeNode('mod2', 'module', 'mod2', 'src/services/mod2.ts', 1),
    makeNode('func1', 'function', 'func1', 'src/utils/mod1.ts', 5),
  ];
  const edges = [
    makeEdge('e1', 'mod1', 'mod2', 'import'),
  ];
  return { nodes, edges };
}

function makeClassData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [
    makeNode('Base', 'class', 'Base', 'src/Base.ts', 1),
    makeNode('Derived', 'class', 'Derived', 'src/Derived.ts', 1),
    makeNode('IFace', 'interface', 'IFace', 'src/IFace.ts', 1),
  ];
  const edges = [
    makeEdge('e1', 'Derived', 'Base', 'extend'),
    makeEdge('e2', 'Derived', 'IFace', 'implement'),
  ];
  return { nodes, edges };
}

function makeDependencyData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [
    makeNode('a', 'function', 'funcA', 'src/utils/a.ts', 1),
    makeNode('b', 'function', 'funcB', 'src/services/b.ts', 1),
  ];
  const edges = [
    makeEdge('e1', 'a', 'b', 'import'),
  ];
  return { nodes, edges };
}

// ── assembleDiagram ───────────────────────────────────────────────────

describe('assembleDiagram', () => {
  describe('inheritance view mode', () => {
    it('assembles inheritance diagram with layered structure', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.viewMode).toBe('inheritance');
      expect(result!.layers).toHaveLength(3);
      expect(result!.currentLayer).toBe(0);
      expect(result!.expandedNodes).toBeInstanceOf(Set);
      expect(result!.metadata.nodeCount).toBe(3);
      expect(result!.metadata.edgeCount).toBe(2);
    });

    it('tags nodes and edges with diagramType property', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      for (const node of result!.allNodes) {
        expect(node.properties.diagramType).toBe('inheritance');
      }
      for (const edge of result!.allEdges) {
        expect(edge.properties.diagramType).toBe('inheritance');
      }
    });

    it('filters nodes by depth in layer 0', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      const layer0 = result!.layers[0];
      expect(layer0).toBeDefined();
      // Layer 0: depth <= 1, so root (depth=0) and direct children (depth=1)
      const layer0Depths = layer0!.nodes.map((n) => n.properties.depth);
      for (const depth of layer0Depths) {
        expect(depth as number).toBeLessThanOrEqual(1);
      }
    });

    it('includes all nodes in layer 2', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      const layer2 = result!.layers[2];
      expect(layer2!.nodes).toHaveLength(3);
    });
  });

  describe('callgraph view mode', () => {
    it('assembles callgraph diagram with layered structure', () => {
      const { nodes, edges } = makeCallGraphData();
      const result = assembleDiagram('callgraph', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.viewMode).toBe('callgraph');
      expect(result!.layers).toHaveLength(3);
      expect(result!.metadata.nodeCount).toBe(3);
      expect(result!.metadata.edgeCount).toBe(2);
    });

    it('tags nodes with diagramType=callgraph', () => {
      const { nodes, edges } = makeCallGraphData();
      const result = assembleDiagram('callgraph', nodes, edges);

      expect(result).not.toBeNull();
      for (const node of result!.allNodes) {
        expect(node.properties.diagramType).toBe('callgraph');
      }
    });

    it('includes entry nodes in layer 0', () => {
      const { nodes, edges } = makeCallGraphData();
      const result = assembleDiagram('callgraph', nodes, edges);

      expect(result).not.toBeNull();
      const layer0 = result!.layers[0];
      // Layer 0: isEntry=true or depth<=1
      const hasEntry = layer0!.nodes.some((n) => n.properties.isEntry === true);
      expect(hasEntry).toBe(true);
    });
  });

  describe('package view mode', () => {
    it('assembles package diagram with layered structure', () => {
      const { nodes, edges } = makePackageData();
      const result = assembleDiagram('package', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.viewMode).toBe('package');
      expect(result!.layers).toHaveLength(3);
      expect(result!.metadata.nodeCount).toBeGreaterThan(0);
    });

    it('tags nodes with diagramType=package', () => {
      const { nodes, edges } = makePackageData();
      const result = assembleDiagram('package', nodes, edges);

      expect(result).not.toBeNull();
      for (const node of result!.allNodes) {
        expect(node.properties.diagramType).toBe('package');
      }
    });
  });

  describe('class view mode', () => {
    it('assembles class diagram with layered structure', () => {
      const { nodes, edges } = makeClassData();
      const result = assembleDiagram('class', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.viewMode).toBe('class');
      expect(result!.layers).toHaveLength(3);
      expect(result!.metadata.nodeCount).toBe(3);
      expect(result!.metadata.edgeCount).toBe(2);
    });

    it('tags nodes with diagramType=class', () => {
      const { nodes, edges } = makeClassData();
      const result = assembleDiagram('class', nodes, edges);

      expect(result).not.toBeNull();
      for (const node of result!.allNodes) {
        expect(node.properties.diagramType).toBe('class');
      }
    });
  });

  describe('dependencies view mode', () => {
    it('assembles dependency diagram with layered structure', () => {
      const { nodes, edges } = makeDependencyData();
      const result = assembleDiagram('dependencies', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.viewMode).toBe('dependencies');
      expect(result!.layers).toHaveLength(3);
      expect(result!.metadata.nodeCount).toBeGreaterThan(0);
    });

    it('tags nodes with diagramType=dependencies', () => {
      const { nodes, edges } = makeDependencyData();
      const result = assembleDiagram('dependencies', nodes, edges);

      expect(result).not.toBeNull();
      for (const node of result!.allNodes) {
        expect(node.properties.diagramType).toBe('dependencies');
      }
    });
  });

  describe('invalid view modes', () => {
    it('returns null for code view mode (no macro assembler registered)', () => {
      const result = assembleDiagram('code', [], []);
      expect(result).toBeNull();
    });

    it('returns null for cfg view mode (no macro assembler registered)', () => {
      const result = assembleDiagram('cfg', [], []);
      expect(result).toBeNull();
    });

    it('returns null for flowchart view mode (no macro assembler registered)', () => {
      const result = assembleDiagram('flowchart', [], []);
      expect(result).toBeNull();
    });

    it('returns null for sequence view mode (no macro assembler registered)', () => {
      const result = assembleDiagram('sequence', [], []);
      expect(result).toBeNull();
    });
  });

  describe('empty data input', () => {
    it('handles empty nodes and edges for inheritance', () => {
      const result = assembleDiagram('inheritance', [], []);
      expect(result).not.toBeNull();
      expect(result!.allNodes).toHaveLength(0);
      expect(result!.allEdges).toHaveLength(0);
      expect(result!.metadata.nodeCount).toBe(0);
      expect(result!.metadata.edgeCount).toBe(0);
    });

    it('handles empty nodes and edges for callgraph', () => {
      const result = assembleDiagram('callgraph', [], []);
      expect(result).not.toBeNull();
      expect(result!.allNodes).toHaveLength(0);
    });

    it('handles empty nodes and edges for package', () => {
      const result = assembleDiagram('package', [], []);
      expect(result).not.toBeNull();
      expect(result!.allNodes).toHaveLength(0);
    });

    it('handles empty nodes and edges for class', () => {
      const result = assembleDiagram('class', [], []);
      expect(result).not.toBeNull();
      expect(result!.allNodes).toHaveLength(0);
    });

    it('handles empty nodes and edges for dependencies', () => {
      const result = assembleDiagram('dependencies', [], []);
      expect(result).not.toBeNull();
      expect(result!.allNodes).toHaveLength(0);
    });
  });

  describe('layer filtering', () => {
    it('filters edges to only include edges between nodes in the layer', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      for (const layer of result!.layers) {
        const nodeIds = new Set(layer.nodes.map((n) => n.id));
        for (const edge of layer.edges) {
          expect(nodeIds.has(edge.source)).toBe(true);
          expect(nodeIds.has(edge.target)).toBe(true);
        }
      }
    });

    it('sets correct layer names', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.layers[0]!.name).toBe('layer.inheritance.0');
      expect(result!.layers[1]!.name).toBe('layer.inheritance.1');
      expect(result!.layers[2]!.name).toBe('layer.inheritance.2');
    });

    it('sets correct layer levels', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      expect(result!.layers[0]!.level).toBe(0);
      expect(result!.layers[1]!.level).toBe(1);
      expect(result!.layers[2]!.level).toBe(2);
    });

    it('populates nodeIds and edgeIds sets in each layer', () => {
      const { nodes, edges } = makeInheritanceData();
      const result = assembleDiagram('inheritance', nodes, edges);

      expect(result).not.toBeNull();
      for (const layer of result!.layers) {
        expect(layer.nodeIds).toBeInstanceOf(Set);
        expect(layer.edgeIds).toBeInstanceOf(Set);
        expect(layer.nodeIds.size).toBe(layer.nodes.length);
        expect(layer.edgeIds.size).toBe(layer.edges.length);
      }
    });
  });

  describe('buildLayeredDiagram fallback (no layer definitions)', () => {
    it('creates single layer when view mode has no layer definitions', () => {
      // Register a custom assembler for 'cfg' view mode which has no LAYER_DEFINITIONS
      const customAssembler: DiagramAssembler = {
        assemble: vi.fn(() => ({
          nodes: [makeNode('n1', 'function', 'func1', 'src/test.ts', 1)],
          edges: [],
          metadata: { rootIds: ['n1'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
        })),
      };
      registerMacroAssembler('cfg', customAssembler);
      try {
        const result = assembleDiagram('cfg', [], []);
        expect(result).not.toBeNull();
        expect(result!.layers).toHaveLength(1);
        expect(result!.layers[0]!.name).toBe('全部');
        expect(result!.layers[0]!.level).toBe(0);
        expect(result!.layers[0]!.nodes).toHaveLength(1);
      } finally {
        // Restore: remove custom assembler by re-registering nothing
        // cfg is not in macro registry by default, so we just overwrite with a dummy
        registerMacroAssembler('cfg', customAssembler);
      }
    });
  });
});

// ── assembleMicroDiagram ──────────────────────────────────────────────

describe('assembleMicroDiagram', () => {
  const validAst: ASTNode = makeAstNode('function_declaration', 'function foo() { return 1; }', [
    makeAstNode('return_statement', 'return 1', [], 1),
  ]);

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('throws when filePath is empty', async () => {
      await expect(assembleMicroDiagram('cfg', '', 'funcName')).rejects.toThrow(
        'filePath is empty',
      );
    });

    it('throws when functionName is empty', async () => {
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', '')).rejects.toThrow(
        'functionName is empty',
      );
    });
  });

  describe('network errors', () => {
    it('throws network error when fetch rejects', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network failure'));
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'Network error: unable to reach AST endpoint',
      );
    });
  });

  describe('HTTP error responses', () => {
    it('throws bad request error on HTTP 400', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse({}, false, 400));
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'Bad request: filePath "src/test.ts" is invalid or workspace not configured',
      );
    });

    it('throws access denied error on HTTP 403', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse({}, false, 403));
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'Access denied: filePath "src/test.ts" is outside workspace',
      );
    });

    it('throws file too large error on HTTP 413', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse({}, false, 413));
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'File too large for AST parsing: src/test.ts',
      );
    });

    it('throws server error with JSON error body on HTTP 500', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeMockFetchResponse({ error: 'Parse failed' }, false, 500),
      );
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'Parse failed',
      );
    });

    it('throws server error with plain text body on HTTP 500', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeMockFetchResponse('Some server error', false, 500),
      );
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'Some server error',
      );
    });

    it('throws generic server error on HTTP 500 with empty body', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeMockFetchResponse('', false, 500),
      );
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'AST parsing failed for "src/test.ts"',
      );
    });

    it('throws generic error for other HTTP error codes', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse({}, false, 404));
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'AST request failed (HTTP 404)',
      );
    });
  });

  describe('empty AST response', () => {
    it('throws when AST root is null', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse(null, true, 200));
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'AST is empty for "src/test.ts"',
      );
    });

    it('throws when AST root has no children', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeMockFetchResponse({ type: 'root', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, children: [] }, true, 200),
      );
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'AST is empty for "src/test.ts"',
      );
    });

    it('throws when AST root children is empty array', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        makeMockFetchResponse(
          { type: 'program', text: '', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, children: [] },
          true, 200,
        ),
      );
      await expect(assembleMicroDiagram('cfg', 'src/test.ts', 'funcName')).rejects.toThrow(
        'AST is empty for "src/test.ts" — parsing produced no nodes',
      );
    });
  });

  describe('successful assembly', () => {
    it('assembles cfg diagram from valid AST', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse(validAst, true, 200));
      const result = await assembleMicroDiagram('cfg', 'src/test.ts', 'foo');
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
    });

    it('assembles flowchart diagram from valid AST', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse(validAst, true, 200));
      const result = await assembleMicroDiagram('flowchart', 'src/test.ts', 'foo');
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
    });

    it('assembles sequence diagram from valid AST', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse(validAst, true, 200));
      const result = await assembleMicroDiagram('sequence', 'src/test.ts', 'foo');
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.metadata).toBeDefined();
    });

    it('sends POST request with correct body', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse(validAst, true, 200));
      await assembleMicroDiagram('cfg', 'src/test.ts', 'foo');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      expect(callArgs![0]).toBe('/api/v1/codegraph/ast');
      const init = callArgs![1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body as string)).toEqual({ filePath: 'src/test.ts' });
    });
  });
});

// ── assembleCFG ───────────────────────────────────────────────────────

describe('assembleCFG', () => {
  it('assembles CFG from a valid AST node', () => {
    const astRoot = makeAstNode('function_declaration', 'function foo() { return 1; }', [
      makeAstNode('return_statement', 'return 1', [], 1),
    ]);
    const result = assembleCFG(astRoot, 'src/foo.ts', 'foo');
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.edges).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it('produces entry and exit nodes', () => {
    const astRoot = makeAstNode('function_declaration', 'function foo() {}', []);
    const result = assembleCFG(astRoot, 'src/foo.ts', 'foo');
    const entryNode = result.nodes.find((n) => n.properties.isEntry === true);
    const exitNode = result.nodes.find((n) => n.properties.isExit === true);
    expect(entryNode).toBeDefined();
    expect(exitNode).toBeDefined();
  });
});

// ── assembleFlowchart ─────────────────────────────────────────────────

describe('assembleFlowchart', () => {
  it('assembles flowchart from a valid AST node', () => {
    const astRoot = makeAstNode('function_declaration', 'function foo() { return 1; }', [
      makeAstNode('return_statement', 'return 1', [], 1),
    ]);
    const result = assembleFlowchart(astRoot, 'src/foo.ts', 'foo');
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.edges).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it('produces start and end nodes', () => {
    const astRoot = makeAstNode('function_declaration', 'function foo() {}', []);
    const result = assembleFlowchart(astRoot, 'src/foo.ts', 'foo');
    const startNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'start');
    const endNode = result.nodes.find((n) => n.properties.flowchartNodeType === 'end');
    expect(startNode).toBeDefined();
    expect(endNode).toBeDefined();
  });
});

// ── assembleSequence ──────────────────────────────────────────────────

describe('assembleSequence', () => {
  it('assembles sequence diagram from a valid AST node', () => {
    const astRoot = makeAstNode('function_declaration', 'function foo() { return 1; }', [
      makeAstNode('return_statement', 'return 1', [], 1),
    ]);
    const result = assembleSequence(astRoot, 'src/foo.ts', 'foo');
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.edges).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it('produces a self participant node', () => {
    const astRoot = makeAstNode('function_declaration', 'function foo() {}', []);
    const result = assembleSequence(astRoot, 'src/foo.ts', 'foo');
    const selfNode = result.nodes.find((n) => n.properties.participantType === 'self');
    expect(selfNode).toBeDefined();
  });
});

// ── registerMacroAssembler ────────────────────────────────────────────

describe('registerMacroAssembler', () => {
  const originalInheritance = new InheritanceAssembler();

  afterEach(() => {
    // Restore original assembler
    registerMacroAssembler('inheritance', originalInheritance);
  });

  it('registers a custom macro assembler that is used by assembleDiagram', () => {
    const customAssembler: DiagramAssembler = {
      assemble: vi.fn((): AssembledDiagram => ({
        nodes: [makeNode('custom1', 'class', 'Custom1', 'src/custom.ts', 1)],
        edges: [],
        metadata: { rootIds: ['custom1'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
      })),
    };
    registerMacroAssembler('inheritance', customAssembler);

    const result = assembleDiagram('inheritance', [], []);
    expect(result).not.toBeNull();
    expect(customAssembler.assemble).toHaveBeenCalledTimes(1);
    expect(result!.allNodes).toHaveLength(1);
    expect(result!.allNodes[0]!.id).toBe('custom1');
  });

  it('overwrites existing assembler when registering same view mode', () => {
    const customAssembler1: DiagramAssembler = {
      assemble: vi.fn((): AssembledDiagram => ({
        nodes: [makeNode('first', 'class', 'First', 'src/first.ts', 1)],
        edges: [],
        metadata: { rootIds: ['first'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
      })),
    };
    const customAssembler2: DiagramAssembler = {
      assemble: vi.fn((): AssembledDiagram => ({
        nodes: [makeNode('second', 'class', 'Second', 'src/second.ts', 1)],
        edges: [],
        metadata: { rootIds: ['second'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
      })),
    };

    registerMacroAssembler('inheritance', customAssembler1);
    const result1 = assembleDiagram('inheritance', [], []);
    expect(result1!.allNodes[0]!.id).toBe('first');

    registerMacroAssembler('inheritance', customAssembler2);
    const result2 = assembleDiagram('inheritance', [], []);
    expect(result2!.allNodes[0]!.id).toBe('second');
  });
});

// ── registerMicroAssembler ────────────────────────────────────────────

describe('registerMicroAssembler', () => {
  const originalCfg = new CFGAssembler();

  afterEach(() => {
    registerMicroAssembler('cfg', originalCfg);
  });

  it('registers a custom micro assembler that is used by assembleCFG', () => {
    const customAssembler = {
      assemble: vi.fn((): AssembledDiagram => ({
        nodes: [makeNode('customCfg', 'function', 'customCfg', 'src/custom.ts', 1)],
        edges: [],
        metadata: { rootIds: ['customCfg'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
      })),
    };
    registerMicroAssembler('cfg', customAssembler);

    const astRoot = makeAstNode('function_declaration', 'function f() {}', []);
    const result = assembleCFG(astRoot, 'src/test.ts', 'f');
    expect(customAssembler.assemble).toHaveBeenCalledTimes(1);
    expect(result.nodes[0]!.id).toBe('customCfg');
  });

  it('overwrites existing micro assembler when registering same view mode', () => {
    const custom1 = {
      assemble: vi.fn((): AssembledDiagram => ({
        nodes: [makeNode('v1', 'function', 'v1', 'src/v1.ts', 1)],
        edges: [],
        metadata: { rootIds: ['v1'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
      })),
    };
    const custom2 = {
      assemble: vi.fn((): AssembledDiagram => ({
        nodes: [makeNode('v2', 'function', 'v2', 'src/v2.ts', 1)],
        edges: [],
        metadata: { rootIds: ['v2'], maxDepth: 0, nodeCount: 1, edgeCount: 0 },
      })),
    };

    registerMicroAssembler('cfg', custom1);
    const astRoot = makeAstNode('function_declaration', 'function f() {}', []);
    const result1 = assembleCFG(astRoot, 'src/test.ts', 'f');
    expect(result1.nodes[0]!.id).toBe('v1');

    registerMicroAssembler('cfg', custom2);
    const result2 = assembleCFG(astRoot, 'src/test.ts', 'f');
    expect(result2.nodes[0]!.id).toBe('v2');
  });
});

// ── getLayerDefinitions ───────────────────────────────────────────────

describe('getLayerDefinitions', () => {
  it('returns layer definitions for inheritance', () => {
    const defs = getLayerDefinitions('inheritance');
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(3);
    expect(defs![0]!.level).toBe(0);
    expect(defs![1]!.level).toBe(1);
    expect(defs![2]!.level).toBe(2);
  });

  it('returns layer definitions for callgraph', () => {
    const defs = getLayerDefinitions('callgraph');
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(3);
  });

  it('returns layer definitions for package', () => {
    const defs = getLayerDefinitions('package');
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(3);
  });

  it('returns layer definitions for class', () => {
    const defs = getLayerDefinitions('class');
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(3);
  });

  it('returns layer definitions for code', () => {
    const defs = getLayerDefinitions('code');
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(3);
    // Code view mode: all layers include all nodes
    for (const def of defs!) {
      expect(def.nodeFilter(makeNode('any', 'function', 'any'), [], [])).toBe(true);
    }
  });

  it('returns layer definitions for dependencies', () => {
    const defs = getLayerDefinitions('dependencies');
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(3);
  });

  it('returns null for cfg view mode (no layer definitions)', () => {
    const defs = getLayerDefinitions('cfg');
    expect(defs).toBeNull();
  });

  it('returns null for flowchart view mode (no layer definitions)', () => {
    const defs = getLayerDefinitions('flowchart');
    expect(defs).toBeNull();
  });

  it('returns null for sequence view mode (no layer definitions)', () => {
    const defs = getLayerDefinitions('sequence');
    expect(defs).toBeNull();
  });
});

// ── getLayerData ──────────────────────────────────────────────────────

describe('getLayerData', () => {
  function makeLayered() {
    const { nodes, edges } = makeInheritanceData();
    return assembleDiagram('inheritance', nodes, edges)!;
  }

  it('returns layer data for valid layer index', () => {
    const layered = makeLayered();
    const layer0 = getLayerData(layered, 0);
    expect(layer0).not.toBeNull();
    expect(layer0!.level).toBe(0);
    expect(layer0!.name).toBe('layer.inheritance.0');
  });

  it('returns layer data for layer index 1', () => {
    const layered = makeLayered();
    const layer1 = getLayerData(layered, 1);
    expect(layer1).not.toBeNull();
    expect(layer1!.level).toBe(1);
  });

  it('returns layer data for layer index 2', () => {
    const layered = makeLayered();
    const layer2 = getLayerData(layered, 2);
    expect(layer2).not.toBeNull();
    expect(layer2!.level).toBe(2);
  });

  it('returns null for negative layer index', () => {
    const layered = makeLayered();
    const result = getLayerData(layered, -1);
    expect(result).toBeNull();
  });

  it('returns null for layer index out of range', () => {
    const layered = makeLayered();
    const result = getLayerData(layered, 99);
    expect(result).toBeNull();
  });

  it('returns null for layer index equal to layers length', () => {
    const layered = makeLayered();
    const result = getLayerData(layered, layered.layers.length);
    expect(result).toBeNull();
  });
});
// ── assembleDiagram: assembler returns falsy result ───────────────────

describe('assembleDiagram with falsy assembler result', () => {
  const originalInheritance = new InheritanceAssembler();

  afterEach(() => {
    registerMacroAssembler('inheritance', originalInheritance);
  });

  it('returns null when assembler.assemble returns null', () => {
    const nullAssembler: DiagramAssembler = {
      assemble: vi.fn(() => null as unknown as AssembledDiagram),
    };
    registerMacroAssembler('inheritance', nullAssembler);

    const result = assembleDiagram('inheritance', [], []);
    expect(result).toBeNull();
  });
});

// ── assembleMicroDiagram: unsupported view mode ───────────────────────

describe('assembleMicroDiagram with unsupported view mode', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws unsupported view mode error for unknown view mode', async () => {
    // AST must have non-empty children to pass the empty-AST check and reach the view mode check
    const validAst: ASTNode = makeAstNode('program', 'root', [
      makeAstNode('function_declaration', 'function foo() {}', []),
    ]);
    vi.mocked(global.fetch).mockResolvedValueOnce(makeMockFetchResponse(validAst, true, 200));

    await expect(
      assembleMicroDiagram('unknown' as 'cfg', 'src/test.ts', 'funcName'),
    ).rejects.toThrow('Unsupported view mode: unknown');
  });
});