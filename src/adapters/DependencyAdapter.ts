import { scoped } from '../shared/Logger.ts';
import type { GraphNode, GraphEdge, AdapterResult, DataSourceType } from '../types/index.ts';
import { NodeId, EdgeId } from '../types/index.ts';
import type { IDataAdapter } from './IAdapter.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
    let pendingTableDep: { name: string; fields: string[] } | null = null;
    for (const line of lines) {
      if (line.match(/^\[dependencies\]/)) { inDepsSection = true; continue; }
      if (line.match(/^\[/)) { inDepsSection = false; continue; }
      if (!inDepsSection) continue;

      if (pendingTableDep) {
        const trimmed = line.trim();
        if (trimmed === '}') {
          const versionField = pendingTableDep.fields.find((f) => f.match(/^version\s*=\s*"/));
          if (versionField) {
            const versionMatch = versionField.match(/^version\s*=\s*"([^"]+)"/);
            if (versionMatch) {
              const depName = pendingTableDep.name;
              const depVersion = versionMatch[1]!;
              const depId = `dep:${depName}`;
              if (!seenIds.has(depId)) {
                seenIds.add(depId);
                nodes.push({ id: depId, name: depName, version: depVersion, type: 'cargo' });
              }
              edges.push({ source: rootId, target: depId, type: 'depends', scope: 'prod' });
            }
          }
          pendingTableDep = null;
          continue;
        }
        pendingTableDep.fields.push(line.trim());
        continue;
      }

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
      const tableDepStartMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{(.*)$/);
      if (tableDepStartMatch) {
        const depName = tableDepStartMatch[1]!;
        const rest = tableDepStartMatch[2]!;
        if (rest.includes('}')) {
          const inlineMatch = rest.match(/^([^}]*)\}/);
          if (inlineMatch) {
            const tableContent = inlineMatch[1]!;
            const versionMatch = tableContent.match(/version\s*=\s*"([^"]+)"/);
            if (versionMatch) {
              const depVersion = versionMatch[1]!;
              const depId = `dep:${depName}`;
              if (!seenIds.has(depId)) {
                seenIds.add(depId);
                nodes.push({ id: depId, name: depName, version: depVersion, type: 'cargo' });
              }
              edges.push({ source: rootId, target: depId, type: 'depends', scope: 'prod' });
            }
            continue;
          }
        }
        pendingTableDep = { name: depName, fields: [rest] };
        continue;
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
export class DependencyDataAdapter implements IDataAdapter {
  readonly source: DataSourceType = 'dependency';

  async fetchData(repoId: string): Promise<AdapterResult> {
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];

    const files: Array<{ name: string; parse: (content: string) => DependencyGraph }> = [
      { name: 'package.json', parse: parsePackageJson },
      { name: 'Cargo.toml', parse: parseCargoToml },
      { name: 'go.mod', parse: parseGoMod },
    ];

    for (const { name, parse } of files) {
      try {
        const content = await readFile(join(repoId, name), 'utf-8');
        const depGraph = parse(content);
        const converted = dependencyGraphToGraphData(depGraph);
        allNodes.push(...converted.nodes);
        allEdges.push(...converted.edges);
      } catch { /* file not found */ }
    }

    const dedupNodes = new Map<string, GraphNode>();
    for (const n of allNodes) dedupNodes.set(n.id, n);
    const dedupEdges = new Map<string, GraphEdge>();
    for (const e of allEdges) {
      if (e.source !== e.target) dedupEdges.set(e.id, e);
    }

    return {
      nodes: [...dedupNodes.values()],
      edges: [...dedupEdges.values()],
      source: this.source,
      timestamp: Date.now(),
    };
  }
}