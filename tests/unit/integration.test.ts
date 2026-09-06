import { describe, it, expect } from 'vitest';
import {
  parsePackageJson,
  parseCargoToml,
  parseGoMod,
  dependencyGraphToGraphData,
} from '../../src/adapters/DependencyAdapter.ts';
import { computeGraphDiff, diffToGraphData } from '../../src/merger/DiffEngine.ts';
import { TreeSitterAdapter } from '../../src/adapters/TreeSitterAdapter.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('Integration: Dependency pipeline (FR-21)', () => {
  it('should parse package.json → convert to GraphData format', () => {
    const pkgContent = JSON.stringify({
      name: 'my-app',
      version: '1.0.0',
      dependencies: { react: '18.0.0', express: '4.18.0' },
      devDependencies: { vitest: '1.0.0' },
    });
    const depGraph = parsePackageJson(pkgContent);
    const { nodes, edges } = dependencyGraphToGraphData(depGraph);

    expect(nodes).toHaveLength(4);
    expect(nodes[0]!.type).toBe('module');
    expect(nodes[0]!.label).toBe('my-app');
    expect(nodes[0]!.properties.isExternal).toBe(true);
    expect(nodes[0]!.properties.depType).toBe('npm');
    expect(nodes[0]!.properties.version).toBe('1.0.0');

    const reactNode = nodes.find((n) => n.label === 'react');
    expect(reactNode).toBeDefined();
    expect(reactNode!.properties.version).toBe('18.0.0');

    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.type === 'dependency')).toBe(true);
  });

  it('should parse Cargo.toml → convert to GraphData format', () => {
    const cargoContent = `
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = "1.0"
`;
    const depGraph = parseCargoToml(cargoContent);
    const { nodes, edges } = dependencyGraphToGraphData(depGraph);

    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes[0]!.label).toBe('my-crate');
    expect(nodes[0]!.properties.depType).toBe('cargo');
    expect(nodes.some((n) => n.label === 'serde')).toBe(true);
    expect(nodes.some((n) => n.label === 'tokio')).toBe(true);
  });

  it('should parse go.mod → convert to GraphData format', () => {
    const goModContent = `
module github.com/example/myapp

require (
  github.com/gin-gonic/gin v1.9.0
  github.com/stretchr/testify v1.8.0
)
`;
    const depGraph = parseGoMod(goModContent);
    const { nodes, edges } = dependencyGraphToGraphData(depGraph);

    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes[0]!.label).toBe('github.com/example/myapp');
    expect(nodes[0]!.properties.depType).toBe('gomod');
    expect(nodes.some((n) => n.label === 'github.com/gin-gonic/gin')).toBe(true);
  });

  it('should handle mixed ecosystem dependencies', () => {
    const pkgGraph = parsePackageJson(JSON.stringify({
      name: 'fullstack-app',
      dependencies: { react: '18.0.0' },
    }));
    const cargoGraph = parseCargoToml(`
name = "backend"
[dependencies]
serde = "1.0"
`);
    const pkgData = dependencyGraphToGraphData(pkgGraph);
    const cargoData = dependencyGraphToGraphData(cargoGraph);

    const allNodes = [...pkgData.nodes, ...cargoData.nodes];
    const allEdges = [...pkgData.edges, ...cargoData.edges];

    expect(allNodes.length).toBeGreaterThanOrEqual(4);
    expect(allNodes.some((n) => n.properties.depType === 'npm')).toBe(true);
    expect(allNodes.some((n) => n.properties.depType === 'cargo')).toBe(true);
    expect(allEdges.every((e) => e.type === 'dependency')).toBe(true);
  });
});

describe('Integration: Diff pipeline (FR-24)', () => {
  it('should compute diff between two graph versions and produce visual graph data', () => {
    const beforeNodes = [
      makeNode('n1', 'oldFunc', 'function', 'a.ts', 1),
      makeNode('n2', 'RemovedClass', 'class', 'b.ts', 5),
      makeNode('n3', 'UnchangedVar', 'variable', 'c.ts', 10),
    ];
    const beforeEdges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'import'),
    ];
    const afterNodes = [
      makeNode('n1', 'newFunc', 'function', 'a.ts', 1),
      makeNode('n3', 'UnchangedVar', 'variable', 'c.ts', 10),
      makeNode('n4', 'AddedClass', 'class', 'd.ts', 20),
    ];
    const afterEdges = [
      makeEdge('e1', 'n1', 'n3', 'call'),
      makeEdge('e3', 'n4', 'n1', 'import'),
    ];

    const diff = computeGraphDiff(beforeNodes, beforeEdges, afterNodes, afterEdges);
    const { nodes, edges } = diffToGraphData(diff);

    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(3);

    const addedNodes = nodes.filter((n) => n.properties.diffStatus === 'added');
    const modifiedNodes = nodes.filter((n) => n.properties.diffStatus === 'modified');
    const removedNodes = nodes.filter((n) => n.properties.diffStatus === 'removed');
    expect(addedNodes).toHaveLength(1);
    expect(modifiedNodes).toHaveLength(1);
    expect(removedNodes).toHaveLength(1);

    expect(addedNodes[0]!.label).toBe('AddedClass');
    expect(modifiedNodes[0]!.label).toBe('newFunc');
    expect(removedNodes[0]!.label).toBe('RemovedClass');

    const addedEdges = edges.filter((e) => e.properties.diffStatus === 'added');
    const removedEdges = edges.filter((e) => e.properties.diffStatus === 'removed');
    const modifiedEdges = edges.filter((e) => e.properties.diffStatus === 'modified');
    expect(addedEdges).toHaveLength(1);
    expect(removedEdges).toHaveLength(1);
    expect(modifiedEdges).toHaveLength(1);
  });

  it('should produce empty diff for identical graphs', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const diff = computeGraphDiff(nodes, edges, nodes, edges);
    const result = diffToGraphData(diff);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

describe('Integration: TreeSitter parse pipeline (FR-20)', () => {
  it('should detect language and return error for unsupported file', async () => {
    const adapter = new TreeSitterAdapter();
    const result = await adapter.parseFile('foo.unknown', 'some content');
    expect(result.source).toBe('tree-sitter');
    expect(result.error).toBeDefined();
    adapter.destroy();
  });

  it('should return supported languages covering 6 ecosystems', () => {
    const adapter = new TreeSitterAdapter();
    const langs = adapter.getSupportedLanguages();
    expect(langs.length).toBe(6);
    expect(langs).toContain('typescript');
    expect(langs).toContain('javascript');
    expect(langs).toContain('python');
    expect(langs).toContain('java');
    expect(langs).toContain('rust');
    expect(langs).toContain('go');
    adapter.destroy();
  });
});