import { computeFileClusters } from '../../src/client/store/cluster/fileCluster.ts';
import { makeNode } from '../helpers.ts';

describe('fileCluster ID uniqueness', () => {
  it('should not produce duplicate cluster IDs for module dir and non-module file', () => {
    // Simulate the scenario that caused the bug:
    // A module node with filePath "crates/xuanread-core/src/lib.rs"
    // parentDir = "crates/xuanread-core/src"
    // A non-module node with parentId "crates/xuanread-core/src"
    // These should NOT produce the same cluster ID
    
    const moduleNode = makeNode('m1', 'lib.rs', 'module', 'crates/xuanread-core/src/lib.rs', 0);
    const nonModuleNode = makeNode('fn1', 'foo', 'function', 'crates/xuanread-core/src/lib.rs', 1, {}, 'crates/xuanread-core/src');
    
    const result = computeFileClusters([moduleNode, nonModuleNode], [], new Set());
    
    // Check for duplicate IDs in visible nodes
    const ids = result.nodes.map(n => n.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
    
    // The module should be clustered by dir, non-module by file
    const clusterNodes = result.nodes.filter(n => 'isCluster' in n && n.isCluster);
    for (const cn of clusterNodes) {
      const cluster = cn as { id: string; isCluster: true };
      // Dir cluster should have 'dir' prefix, file cluster should have 'file' prefix
      if (cluster.id.startsWith('filecluster__dir__')) {
        expect(cluster.id).toBe('filecluster__dir__crates__xuanread-core__src');
      }
      if (cluster.id.startsWith('filecluster__file__')) {
        expect(cluster.id).toBe('filecluster__file__crates__xuanread-core__src');
      }
    }
  });

  it('should not produce duplicate IDs when multiple modules share the same parent dir', () => {
    const m1 = makeNode('m1', 'a.ts', 'module', 'src/mod/a.ts', 0);
    const m2 = makeNode('m2', 'b.ts', 'module', 'src/mod/b.ts', 0);
    const fn1 = makeNode('fn1', 'foo', 'function', 'src/mod/a.ts', 1, {}, 'm1');
    const fn2 = makeNode('fn2', 'bar', 'function', 'src/mod/b.ts', 1, {}, 'm2');
    
    const result = computeFileClusters([m1, m2, fn1, fn2], [], new Set());
    
    const ids = result.nodes.map(n => n.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('should not produce duplicate IDs for root-level files', () => {
    const m1 = makeNode('m1', 'vite.config.ts', 'module', 'vite.config.ts', 0);
    const fn1 = makeNode('fn1', 'foo', 'function', 'vite.config.ts', 1, {}, 'm1');
    
    const result = computeFileClusters([m1, fn1], [], new Set());
    
    const ids = result.nodes.map(n => n.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});