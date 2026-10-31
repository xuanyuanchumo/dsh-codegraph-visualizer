/**
 * 继承数据增强器契约（cycle-123，研究报告 Phase 1 P0 数据质量缺口）。
 *
 * 量化缺口（本仓实测）：上游索引对 interface extends 检出 0——源码 17 处
 * extends 只出 9 条 class→class。enhanceInheritanceData 是数据增补面：
 * AST 提取（TreeSitterAdapter heritage）→ label 解析 → 语义键去重。
 *
 * 断言矩阵：
 * A. label 解析（唯一命中 / 重名歧义丢弃 / 未知目标 unresolved / type_alias 目标）
 * B. 语义键去重（(type,source,target) 已存在 ⇒ duplicates，不注重复边）
 * C. 宁缺勿造（treeSitter=null ⇒ applied:false 原图不动；异常不冒泡）
 * D. 可观测（返回值全字段；注入后 metadata.inheritance 由调用方写入——本文件测返回值）
 */
import { describe, it, expect } from 'vitest';
import { enhanceInheritanceData, type InheritanceEnhancement } from '../../src/host/inheritanceEnhancer.ts';
import type { TreeSitterAdapterLike } from '../../src/host/inheritanceEnhancer.ts';
import type { GraphData, GraphEdge, GraphNode } from '../../src/types/index.ts';
import { NodeId, EdgeId, RepoId } from '../../src/types/index.ts';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** 构造最小合并图（class:<hash> 形态对齐上游 id 约定）。 */
function makeMerged(specs: Array<{ kind: string; name: string; file?: string }>): { merged: GraphData; cleanup: () => void; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'cg-inh-'));
  const nodes: GraphNode[] = specs.map((s, i) => ({
    id: NodeId(`${s.kind}:${String(i).padStart(4, '0')}`),
    label: s.name,
    type: 'class',
    filePath: s.file ?? join(root, `${s.name}.ts`),
    lineNumber: 1,
    properties: {},
  }));
  const merged: GraphData = {
    nodes,
    edges: [],
    metadata: { repoId: RepoId(root), timestamp: 1, nodeCount: nodes.length, edgeCount: 0 },
  };
  return { merged, cleanup: () => rmSync(root, { recursive: true, force: true }), root };
}

/** TreeSitterAdapterLike 的桩：返回预置 AST 边（增强器的唯一消费面）。 */
function stubAdapter(edges: Array<{ type: string; source: string; target: string; properties?: Record<string, unknown> }>): TreeSitterAdapterLike {
  return {
    isAvailable: () => true,
    batchScan: async () => ({
      nodes: [] as unknown[],
      edges: edges.map((e) => ({
        id: EdgeId(`tsedge:${e.source}->${e.target}`),
        source: NodeId(e.source),
        target: NodeId(e.target),
        type: e.type as GraphEdge['type'],
        properties: { edgeOrigin: 'ast', ...(e.properties ?? {}) },
      })),
      source: 'tree-sitter' as const,
      timestamp: Date.now(),
    }),
  };
}

/** 在临时仓库写一个含 interface extends 的源文件（供真实扫描）。 */
function writeSource(root: string, rel: string, content: string): void {
  writeFileSync(join(root, rel), content);
}

describe('enhanceInheritanceData', () => {
  it('A1 label 唯一命中：AST extends → 上游 class/interface 节点 id 注入', async () => {
    const { merged, cleanup, root } = makeMerged([
      { kind: 'interface', name: 'A' },
      { kind: 'interface', name: 'B' },
    ]);
    writeSource(root, 'types.ts', 'export interface B extends A {}\n');
    const adapter = stubAdapter([
      { type: 'extend', source: 'types.ts:B:0', target: 'types.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const r: InheritanceEnhancement = await enhanceInheritanceData(merged, root, adapter as never);
    expect(r.applied).toBe(true);
    expect(r.added).toBe(1);
    const added = merged.edges.at(-1)!;
    expect(added.type).toBe('extend');
    expect(added.source).toBe(merged.nodes[1]!.id); // B
    expect(added.target).toBe(merged.nodes[0]!.id); // A
    expect(merged.metadata.edgeCount).toBe(1);
    cleanup();
  });

  it('A2 重名歧义 ⇒ 确定性取第一候选（同输入同答案，不猜目录）', async () => {
    // 设计裁决：resolveAmbiguous 取第一候选（上游节点表按 id 排序 ⇒ 同输入同答案），
    // 而非丢弃——「取第一个」的错配率 ≈ 重名占比（本仓 13/342 ≈ 4%）且被
    // ambiguous 计数暴露；丢弃会让 interface extends 增补在重名仓库整体失效。
    // 测试钉住「确定性 + 可观测」这对契约，改动取舍必须显式。
    const { merged, cleanup, root } = makeMerged([
      { kind: 'interface', name: 'A' },
      { kind: 'interface', name: 'A' }, // 重名
      { kind: 'interface', name: 'B' },
    ]);
    writeSource(root, 't.ts', 'export interface B extends A {}\n');
    const adapter = stubAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const r = await enhanceInheritanceData(merged, root, adapter as never);
    expect(r.added).toBe(1);
    // 第一候选 = 排序在前的那条（id 0000）
    expect(merged.edges[0]!.target).toBe(merged.nodes[0]!.id);
    cleanup();
  });

  it('A3 目标 label 不在节点表 ⇒ unresolved（不造悬空节点）', async () => {
    const { merged, cleanup, root } = makeMerged([
      { kind: 'interface', name: 'B' },
    ]);
    writeSource(root, 't.ts', 'export interface B extends Missing {}\n');
    const adapter = stubAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:Missing', properties: { targetName: 'Missing' } },
    ]);
    const r = await enhanceInheritanceData(merged, root, adapter as never);
    expect(r.unresolved).toBe(1);
    expect(r.added).toBe(0);
    cleanup();
  });

  it('B1 语义键 (type,source,target) 已存在 ⇒ duplicates 计数不注入', async () => {
    const { merged, cleanup, root } = makeMerged([
      { kind: 'class', name: 'A' },
      { kind: 'class', name: 'B' },
    ]);
    // 上游已有同语义边（不同 id——正是 merger 按 id 合并会产生并存的双线场景）
    const upstream: GraphEdge = {
      id: EdgeId('999'),
      source: merged.nodes[1]!.id,
      target: merged.nodes[0]!.id,
      type: 'extend',
      properties: { edgeOrigin: 'db' },
    };
    merged.edges = [upstream];
    writeSource(root, 't.ts', 'export class B extends A {}\n');
    const adapter = stubAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const r = await enhanceInheritanceData(merged, root, adapter as never);
    expect(r.duplicates).toBe(1);
    expect(r.added).toBe(0);
    expect(merged.edges).toHaveLength(1); // 不注重复边
    cleanup();
  });

  it('C1 treeSitter=null（AST 通道不可用）⇒ applied:false 原图不动', async () => {
    const { merged, cleanup, root } = makeMerged([{ kind: 'class', name: 'A' }]);
    const r = await enhanceInheritanceData(merged, root, null);
    expect(r.applied).toBe(false);
    expect(merged.edges).toHaveLength(0);
    cleanup();
  });

  it('C2 非绝对路径 workspace ⇒ 直接返回未应用（不猜 cwd）', async () => {
    const { merged, cleanup } = makeMerged([{ kind: 'class', name: 'A' }]);
    const r = await enhanceInheritanceData(merged, '.', null);
    expect(r.applied).toBe(false);
    cleanup();
  });

  it('C3 扫描抛错（适配器内部失败）⇒ 不冒泡，返回未应用', async () => {
    const { merged, cleanup, root } = makeMerged([{ kind: 'class', name: 'A' }]);
    const boom = {
      isAvailable: () => true,
      batchScan: async () => { throw new Error('wasm gone'); },
    } as unknown as TreeSitterAdapterLike;
    const r = await enhanceInheritanceData(merged, root, boom);
    expect(r.applied).toBe(false);
    expect(merged.edges).toHaveLength(0);
    cleanup();
  });

  it('D1 返回值全字段可观测（量化纪律）', async () => {
    const { merged, cleanup, root } = makeMerged([
      { kind: 'interface', name: 'A' },
      { kind: 'interface', name: 'B' },
    ]);
    writeSource(root, 't.ts', 'export interface B extends A {}\n');
    const adapter = stubAdapter([
      { type: 'extend', source: 't.ts:B:0', target: 't.ts:<type>:A', properties: { targetName: 'A' } },
    ]);
    const r = await enhanceInheritanceData(merged, root, adapter as never);
    for (const key of ['applied', 'extracted', 'added', 'ambiguous', 'unresolved', 'duplicates', 'filesScanned', 'durationMs'] as const) {
      expect(r).toHaveProperty(key);
    }
    expect(r.filesScanned).toBeGreaterThan(0);
    expect(typeof r.durationMs).toBe('number');
    cleanup();
  });
});
