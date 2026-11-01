/**
 * 指纹键缓存层契约（cycle-125：增强下沉到 fetchMergedGraph 单一合并点）。
 *
 * 断言矩阵：
 * A. 指纹命中跳过扫描（batchScan 只调一次，边仍注入）
 * B. 指纹变化重扫（文件/索引变了就重增强）
 * C. 无 class 节点守卫（lens-only 路径省扫描）
 * D. resetInheritanceCache 清理
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  enhanceInheritanceDataCached,
  resetInheritanceCache,
} from '../../src/host/inheritanceEnhancer.ts';
import { computeGraphFingerprint } from '../../src/shared/graphFingerprint.ts';
import type { GraphData } from '../../src/types/index.ts';
import { NodeId, RepoId } from '../../src/types/index.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let root: string;
let scanCalls: number;

/** 桩适配器：真实走 enhanceInheritanceData 的 batchScan 路径，但可计数。 */
function countingAdapter(
  edges: Array<{ type: string; source: string; target: string; properties?: Record<string, unknown> }>,
) {
  scanCalls = 0;
  return {
    isAvailable: () => true,
    batchScan: async () => {
      scanCalls += 1;
      return {
        nodes: [] as unknown[],
        edges: edges.map((e) => ({
          id: `tsedge:${e.source}->${e.target}`,
          source: NodeId(e.source),
          target: NodeId(e.target),
          type: e.type as 'extend' | 'implement',
          properties: { edgeOrigin: 'ast', targetName: e.target, ...(e.properties ?? {}) },
        })),
        source: 'tree-sitter' as const,
        timestamp: Date.now(),
      };
    },
  };
}

function makeMerged(specs: Array<{ kind: string; name: string }>): GraphData {
  const nodes = specs.map((s, i) => ({
    id: NodeId(`${s.kind}:${String(i).padStart(4, '0')}`),
    label: s.name,
    type: 'class' as const,
    filePath: join(root, `${s.name}.ts`),
    lineNumber: 1,
    properties: {},
  }));
  return {
    nodes,
    edges: [],
    metadata: { repoId: RepoId(root), timestamp: 1, nodeCount: nodes.length, edgeCount: 0 },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cg-cached-'));
  resetInheritanceCache();
  writeFileSync(join(root, 'types.ts'), 'export interface B extends A {}\n');
});

afterEach(() => {
  resetInheritanceCache();
  rmSync(root, { recursive: true, force: true });
});

describe('enhanceInheritanceDataCached — 指纹键缓存', () => {
  it('A1 首调扫描并注入（batchScan 1 次）', async () => {
    const adapter = countingAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const merged = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    const r = await enhanceInheritanceDataCached(merged, root, adapter as never);
    expect(r.applied).toBe(true);
    expect(r.added).toBe(1);
    expect(scanCalls).toBe(1);
    expect(merged.edges).toHaveLength(1);
  });

  it('A2 同指纹二调命中缓存：batchScan 仍 1 次，边重新注入（新 merged 对象）', async () => {
    const adapter = countingAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    // 两次调用用**内容相同但对象不同**的 merged（模拟 fetchMergedGraph 每次新建）
    const merged1 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    await enhanceInheritanceDataCached(merged1, root, adapter as never);
    const merged2 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    const r2 = await enhanceInheritanceDataCached(merged2, root, adapter as never);
    expect(scanCalls).toBe(1); // 缓存命中，未重扫
    expect(r2.added).toBe(1);  // 边仍注入（缓存的 edge 集合重放）
    expect(merged2.edges).toHaveLength(1);
  });

  it('B1 指纹变化（新增节点）⇒ 重扫（batchScan 2 次）', async () => {
    const adapter = countingAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const merged1 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    await enhanceInheritanceDataCached(merged1, root, adapter as never);
    // 指纹变化：节点数不同
    const merged2 = makeMerged([
      { kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }, { kind: 'class', name: 'C' },
    ]);
    await enhanceInheritanceDataCached(merged2, root, adapter as never);
    expect(scanCalls).toBe(2);
  });

  it('C1 无 class/interface 节点 ⇒ 跳过扫描（lens-only 路径省 4.6s）', async () => {
    const adapter = countingAdapter([]);
    const merged: GraphData = {
      nodes: [{ id: NodeId('module:0000'), label: 'index.ts', type: 'module', filePath: join(root, 'i.ts'), lineNumber: 1, properties: {} }],
      edges: [],
      metadata: { repoId: RepoId(root), timestamp: 1, nodeCount: 1, edgeCount: 0 },
    };
    const r = await enhanceInheritanceDataCached(merged, root, adapter as never);
    expect(r.applied).toBe(false);
    expect(scanCalls).toBe(0); // 守卫 0 拦截，未进 batchScan
  });

  it('D1 resetInheritanceCache 后重扫（宿主销毁语义）', async () => {
    const adapter = countingAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const merged1 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    await enhanceInheritanceDataCached(merged1, root, adapter as never);
    resetInheritanceCache();
    const merged2 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    await enhanceInheritanceDataCached(merged2, root, adapter as never);
    expect(scanCalls).toBe(2);
  });

  it('A3 指纹键基于注入前的合并图（注入边不计入键——防自指漂移）', async () => {
    // 第一次调用的 merged1 注入后 edges 变了；若指纹键把注入边也算进去，
    // 同内容第二次调用会 miss。用「内容相同的两次独立 merged」验证不 miss。
    const adapter = countingAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const m1 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    const fpBefore = computeGraphFingerprint(m1);
    await enhanceInheritanceDataCached(m1, root, adapter as never);
    const fpAfter = computeGraphFingerprint(m1); // 注入后指纹确实变了
    expect(fpAfter).not.toBe(fpBefore);
    // 但缓存键存的是注入前的指纹 ⇒ 同内容二调仍命中
    const m2 = makeMerged([{ kind: 'interface', name: 'A' }, { kind: 'interface', name: 'B' }]);
    expect(computeGraphFingerprint(m2)).toBe(fpBefore);
    await enhanceInheritanceDataCached(m2, root, adapter as never);
    expect(scanCalls).toBe(1);
  });
});
