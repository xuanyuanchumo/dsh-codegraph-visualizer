import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, NodeId, EdgeId } from '../types/index.ts';

const log = scoped('dep-adapter');

export interface DependencyNode {
  id: string;
  name: string;
  version: string;
  type: 'npm' | 'cargo' | 'gomod' | 'pip';
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: 'depends';
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export function parsePackageJson(content: string): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  try {
    const pkg = JSON.parse(content);
    const rootName = pkg.name || 'root';
    const rootId = `dep:${rootName}`;
    nodes.push({ id: rootId, name: rootName, version: pkg.version || '0.0.0', type: 'npm' });

    const depSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const section of depSections) {
      const deps = pkg[section];
      if (!deps || typeof deps !== 'object') continue;
      for (const [name, version] of Object.entries(deps)) {
        const depId = `dep:${name}`;
        if (!nodes.find((n) => n.id === depId)) {
          nodes.push({ id: depId, name, version: String(version), type: 'npm' });
        }
        edges.push({ source: rootId, target: depId, type: 'depends' });
      }
    }
  } catch (e) {
    log.warn('parsePackageJson failed', e);
  }
  return { nodes, edges };
}

export function parseCargoToml(content: string): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  try {
    const lines = content.split('\n');
    let inDepsSection = false;
    let rootName = 'root';
    for (const line of lines) {
      const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
      if (nameMatch) rootName = nameMatch[1]!;
      if (line.match(/^\[dependencies\]/)) { inDepsSection = true; continue; }
      if (line.match(/^\[/)) { inDepsSection = false; continue; }
      if (!inDepsSection) continue;
      const depMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (depMatch) {
        const depName = depMatch[1]!;
        const depVersion = depMatch[2]!;
        const depId = `dep:${depName}`;
        if (!nodes.find((n) => n.id === depId)) {
          nodes.push({ id: depId, name: depName, version: depVersion, type: 'cargo' });
        }
        edges.push({ source: `dep:${rootName}`, target: depId, type: 'depends' });
      }
    }
    nodes.unshift({ id: `dep:${rootName}`, name: rootName, version: '0.0.0', type: 'cargo' });
  } catch (e) {
    log.warn('parseCargoToml failed', e);
  }
  return { nodes, edges };
}

export function parseGoMod(content: string): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  try {
    const lines = content.split('\n');
    let moduleName = 'root';
    let inRequireBlock = false;
    for (const line of lines) {
      const moduleMatch = line.match(/^module\s+(\S+)/);
      if (moduleMatch) moduleName = moduleMatch[1]!;
      if (line.match(/^require\s*\(/)) { inRequireBlock = true; continue; }
      if (line.match(/^\)/)) { inRequireBlock = false; continue; }
      const singleRequireMatch = line.match(/^require\s+(\S+)\s+(\S+)/);
      if (singleRequireMatch) {
        const depName = singleRequireMatch[1]!;
        const depVersion = singleRequireMatch[2]!;
        const depId = `dep:${depName}`;
        if (!nodes.find((n) => n.id === depId)) {
          nodes.push({ id: depId, name: depName, version: depVersion, type: 'gomod' });
        }
        edges.push({ source: `dep:${moduleName}`, target: depId, type: 'depends' });
        continue;
      }
      if (!inRequireBlock) continue;
      const depMatch = line.match(/^\s*(\S+)\s+(\S+)/);
      if (depMatch) {
        const depName = depMatch[1]!;
        const depVersion = depMatch[2]!;
        const depId = `dep:${depName}`;
        if (!nodes.find((n) => n.id === depId)) {
          nodes.push({ id: depId, name: depName, version: depVersion, type: 'gomod' });
        }
        edges.push({ source: `dep:${moduleName}`, target: depId, type: 'depends' });
      }
    }
    nodes.unshift({ id: `dep:${moduleName}`, name: moduleName, version: '0.0.0', type: 'gomod' });
  } catch (e) {
    log.warn('parseGoMod failed', e);
  }
  return { nodes, edges };
}

export function dependencyGraphToGraphData(depGraph: DependencyGraph): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = depGraph.nodes.map((n) => ({
    id: n.id as NodeId,
    label: n.name,
    type: 'module',
    filePath: '',
    lineNumber: 0,
    properties: { version: n.version, depType: n.type, isExternal: true },
  }));
  const edges: GraphEdge[] = depGraph.edges.map((e, i) => ({
    id: `depedge-${i}` as EdgeId,
    source: e.source as NodeId,
    target: e.target as NodeId,
    type: 'dependency',
    properties: {},
  }));
  return { nodes, edges };
}