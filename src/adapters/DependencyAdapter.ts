import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';

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
  scope: 'prod' | 'dev' | 'peer' | 'optional';
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export function parsePackageJson(content: string): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const seenIds = new Set<string>();
  try {
    const pkg = JSON.parse(content);
    const rootName = pkg.name || 'root';
    const rootId = `dep:${rootName}`;
    nodes.push({ id: rootId, name: rootName, version: pkg.version || '0.0.0', type: 'npm' });
    seenIds.add(rootId);

    const depSections: Array<{ key: string; scope: DependencyEdge['scope'] }> = [
      { key: 'dependencies', scope: 'prod' },
      { key: 'devDependencies', scope: 'dev' },
      { key: 'peerDependencies', scope: 'peer' },
      { key: 'optionalDependencies', scope: 'optional' },
    ];
    for (const { key, scope } of depSections) {
      const deps = pkg[key];
      if (!deps || typeof deps !== 'object') continue;
      for (const [name, version] of Object.entries(deps)) {
        const depId = `dep:${name}`;
        if (!seenIds.has(depId)) {
          seenIds.add(depId);
          nodes.push({ id: depId, name, version: String(version), type: 'npm' });
        }
        edges.push({ source: rootId, target: depId, type: 'depends', scope });
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
  const seenIds = new Set<string>();
  try {
    const lines = content.split('\n');
    let rootName = 'root';
    for (const line of lines) {
      const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
      if (nameMatch) { rootName = nameMatch[1]!; break; }
    }
    const rootId = `dep:${rootName}`;
    nodes.push({ id: rootId, name: rootName, version: '0.0.0', type: 'cargo' });
    seenIds.add(rootId);

    let inDepsSection = false;
    for (const line of lines) {
      if (line.match(/^\[dependencies\]/)) { inDepsSection = true; continue; }
      if (line.match(/^\[/)) { inDepsSection = false; continue; }
      if (!inDepsSection) continue;
      const simpleDepMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (simpleDepMatch) {
        const depName = simpleDepMatch[1]!;
        const depVersion = simpleDepMatch[2]!;
        const depId = `dep:${depName}`;
        if (!seenIds.has(depId)) {
          seenIds.add(depId);
          nodes.push({ id: depId, name: depName, version: depVersion, type: 'cargo' });
        }
        edges.push({ source: rootId, target: depId, type: 'depends', scope: 'prod' });
        continue;
      }
      const tableDepMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
      if (tableDepMatch) {
        const depName = tableDepMatch[1]!;
        const depVersion = tableDepMatch[2]!;
        const depId = `dep:${depName}`;
        if (!seenIds.has(depId)) {
          seenIds.add(depId);
          nodes.push({ id: depId, name: depName, version: depVersion, type: 'cargo' });
        }
        edges.push({ source: rootId, target: depId, type: 'depends', scope: 'prod' });
      }
    }
  } catch (e) {
    log.warn('parseCargoToml failed', e);
  }
  return { nodes, edges };
}

export function parseGoMod(content: string): DependencyGraph {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const seenIds = new Set<string>();
  try {
    const lines = content.split('\n');
    let moduleName = 'root';
    for (const line of lines) {
      const moduleMatch = line.match(/^module\s+(\S+)/);
      if (moduleMatch) { moduleName = moduleMatch[1]!; break; }
    }
    const rootId = `dep:${moduleName}`;
    nodes.push({ id: rootId, name: moduleName, version: '0.0.0', type: 'gomod' });
    seenIds.add(rootId);

    let inRequireBlock = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      const line = trimmed.replace(/\s*\/\/.*$/, '');
      if (line.match(/^require\s*\(/)) { inRequireBlock = true; continue; }
      if (line.match(/^\)/)) { inRequireBlock = false; continue; }
      if (!inRequireBlock) {
        const singleRequireMatch = line.match(/^require\s+(\S+)\s+(\S+)/);
        if (singleRequireMatch) {
          const depName = singleRequireMatch[1]!;
          const depVersion = singleRequireMatch[2]!;
          const depId = `dep:${depName}`;
          if (!seenIds.has(depId)) {
            seenIds.add(depId);
            nodes.push({ id: depId, name: depName, version: depVersion, type: 'gomod' });
          }
          edges.push({ source: rootId, target: depId, type: 'depends', scope: 'prod' });
          continue;
        }
        continue;
      }
      const depMatch = line.match(/^\s*(\S+)\s+(\S+)/);
      if (depMatch) {
        const depName = depMatch[1]!;
        const depVersion = depMatch[2]!;
        const depId = `dep:${depName}`;
        if (!seenIds.has(depId)) {
          seenIds.add(depId);
          nodes.push({ id: depId, name: depName, version: depVersion, type: 'gomod' });
        }
        edges.push({ source: rootId, target: depId, type: 'depends', scope: 'prod' });
      }
    }
  } catch (e) {
    log.warn('parseGoMod failed', e);
  }
  return { nodes, edges };
}

export function dependencyGraphToGraphData(depGraph: DependencyGraph): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const sourceIds = new Set(depGraph.edges.map((e) => e.source));
  const nodes: GraphNode[] = depGraph.nodes.map((n) => {
    let filePath = '';
    const isRoot = sourceIds.has(n.id);
    if (n.type === 'npm') {
      filePath = n.id === `dep:${n.name}` && isRoot ? 'package.json' : `node_modules/${n.name}`;
    } else if (n.type === 'cargo') {
      filePath = isRoot ? 'Cargo.toml' : `cargo/${n.name}`;
    } else if (n.type === 'gomod') {
      filePath = isRoot ? 'go.mod' : `go/${n.name}`;
    } else {
      filePath = n.name;
    }
    return {
      id: NodeId(n.id),
      label: n.name,
      type: 'module',
      filePath,
      lineNumber: 0,
      properties: { version: n.version, depType: n.type, isExternal: true },
    };
  });
  const edges: GraphEdge[] = depGraph.edges.map((e) => ({
    id: EdgeId(`${e.source}->${e.target}:dependency`),
    source: NodeId(e.source),
    target: NodeId(e.target),
    type: 'dependency',
    properties: { scope: e.scope },
  }));
  return { nodes, edges };
}