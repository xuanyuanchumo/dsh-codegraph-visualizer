import { describe, it, expect } from 'vitest';
import { FileSystemAdapter } from '../../src/adapters/FileSystemAdapter.ts';
import type { FileSystemApi } from '../../src/adapters/FileSystemAdapter.ts';

function createMockFs(structure: Record<string, string | string[]>): FileSystemApi {
  const dirs = new Set<string>();
  const files = new Map<string, string>();

  for (const [path, content] of Object.entries(structure)) {
    if (typeof content === 'string') {
      files.set(path, content);
    } else {
      dirs.add(path);
    }
  }

  return {
    readdir(path: string): string[] {
      const result: string[] = [];
      const prefix = path.endsWith('/') ? path : path + '/';
      const seen = new Set<string>();
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length);
          const firstSegment = rest.split('/')[0]!;
          if (!seen.has(firstSegment)) {
            seen.add(firstSegment);
            result.push(firstSegment);
          }
        }
      }
      for (const dirPath of dirs) {
        if (dirPath.startsWith(prefix)) {
          const rest = dirPath.slice(prefix.length);
          const firstSegment = rest.split('/')[0]!;
          if (!seen.has(firstSegment)) {
            seen.add(firstSegment);
            result.push(firstSegment);
          }
        }
      }
      return result;
    },
    readFile(path: string): string {
      return files.get(path) ?? '';
    },
    stat(path: string): { isDirectory: boolean } {
      if (dirs.has(path)) return { isDirectory: true };
      if (files.has(path)) return { isDirectory: false };
      for (const dirPath of dirs) {
        if (path.startsWith(dirPath + '/')) return { isDirectory: true };
      }
      return { isDirectory: false };
    },
  };
}

describe('FileSystemAdapter', () => {
  it('returns empty result when no filesystem set', async () => {
    const adapter = new FileSystemAdapter();
    const result = await adapter.fetchData('/repo');
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('scans directory structure and creates nodes', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts', '/repo/src/utils.ts'],
      '/repo/src/main.ts': 'export function main() {}',
      '/repo/src/utils.ts': 'export function util() {}',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchData('/repo');
    expect(result.nodes.length).toBeGreaterThan(0);
    const fileNodes = result.nodes.filter(n => n.filePath.endsWith('.ts'));
    expect(fileNodes.length).toBeGreaterThanOrEqual(2);
  });

  it('creates contains edges between directories and files', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts'],
      '/repo/src/main.ts': 'export function main() {}',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchData('/repo');
    const containsEdges = result.edges.filter(e => e.type === 'contains');
    expect(containsEdges.length).toBeGreaterThan(0);
  });

  it('ignores node_modules and other excluded directories', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts'],
      '/repo/node_modules': ['/repo/node_modules/pkg/index.js'],
      '/repo/src/main.ts': 'export function main() {}',
      '/repo/node_modules/pkg/index.js': 'module.exports = {}',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchData('/repo');
    const nodeModulesNodes = result.nodes.filter(n => n.filePath.includes('node_modules'));
    expect(nodeModulesNodes).toHaveLength(0);
  });

  it('only includes supported file extensions', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts', '/repo/src/readme.md', '/repo/src/data.csv'],
      '/repo/src/main.ts': 'export function main() {}',
      '/repo/src/readme.md': '# README',
      '/repo/src/data.csv': 'a,b,c',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchData('/repo');
    const fileNodes = result.nodes.filter(n => n.properties.extension);
    const extensions = fileNodes.map(n => n.properties.extension);
    expect(extensions).not.toContain('.md');
    expect(extensions).not.toContain('.csv');
    expect(extensions).toContain('.ts');
  });

  it('respects MAX_FILES limit', async () => {
    const structure: Record<string, string | string[]> = {};
    const srcFiles: string[] = [];
    for (let i = 0; i < 600; i++) {
      const filePath = `/repo/src/file${i}.ts`;
      structure[filePath] = `export function f${i}() {}`;
      srcFiles.push(filePath);
    }
    structure['/repo/src'] = srcFiles;
    const fs = createMockFs(structure);
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchData('/repo');
    const fileNodes = result.nodes.filter(n => n.type === 'module' && n.properties.extension === '.ts');
    expect(fileNodes.length).toBeLessThanOrEqual(500);
  });

  it('assigns correct language from extension', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts', '/repo/src/app.py', '/repo/src/lib.rs'],
      '/repo/src/main.ts': 'export function main() {}',
      '/repo/src/app.py': 'def main(): pass',
      '/repo/src/lib.rs': 'fn main() {}',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchData('/repo');
    const tsNode = result.nodes.find(n => n.filePath.endsWith('.ts'));
    const pyNode = result.nodes.find(n => n.filePath.endsWith('.py'));
    const rsNode = result.nodes.find(n => n.filePath.endsWith('.rs'));
    expect(tsNode?.properties.language).toBe('typescript');
    expect(pyNode?.properties.language).toBe('python');
    expect(rsNode?.properties.language).toBe('rust');
  });

  it('setTreeSitterAdapter stores the adapter reference', async () => {
    const adapter = new FileSystemAdapter();
    const { TreeSitterAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const tsAdapter = new TreeSitterAdapter();
    adapter.setTreeSitterAdapter(tsAdapter);
  });

  it('fetchDataWithSymbols returns empty when no filesystem', async () => {
    const adapter = new FileSystemAdapter();
    const result = await adapter.fetchDataWithSymbols('/repo');
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('fetchDataWithSymbols returns structure-only when no tree-sitter adapter', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts'],
      '/repo/src/main.ts': 'export function main() {}',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const result = await adapter.fetchDataWithSymbols('/repo');
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('fetchDataWithSymbols merges structure and symbol nodes', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts'],
      '/repo/src/main.ts': 'function bar() { return 1; }',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const { TreeSitterAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const tsAdapter = new TreeSitterAdapter();
    await tsAdapter.init();
    adapter.setTreeSitterAdapter(tsAdapter);
    const result = await adapter.fetchDataWithSymbols('/repo');
    expect(result.nodes.length).toBeGreaterThan(0);
    const symbolNodes = result.nodes.filter(n => n.properties.source === 'tree-sitter');
    expect(symbolNodes.length).toBeGreaterThan(0);
  });

  it('fetchDataWithSymbols adds contains edges from file to symbols', async () => {
    const fs = createMockFs({
      '/repo/src': ['/repo/src/main.ts'],
      '/repo/src/main.ts': 'function bar() { return 1; }',
    });
    const adapter = new FileSystemAdapter();
    adapter.setFileSystem(fs);
    const { TreeSitterAdapter } = await import('../../src/adapters/TreeSitterAdapter.ts');
    const tsAdapter = new TreeSitterAdapter();
    await tsAdapter.init();
    adapter.setTreeSitterAdapter(tsAdapter);
    const result = await adapter.fetchDataWithSymbols('/repo');
    const symContainsEdges = result.edges.filter(e => e.id.startsWith('symcontains:'));
    expect(symContainsEdges.length).toBeGreaterThan(0);
  });
});