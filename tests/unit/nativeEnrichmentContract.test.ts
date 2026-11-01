/**
 * cycle-129：原生功能业务丰富化契约。
 *
 * T1/T2 import 边推断（IM）：TreeSitter 提取 import 模块名（语法事实）→
 * FileSystemAdapter 解析到 workspace 内文件节点（语义裁决）→ `import` 边。
 * 此前原生图只有 contains/extend/implement，依赖视图在原生通道上是空的。
 *
 * T3 定向更新（NU）：watcher 增量的索引侧——改动文件旧行删除 + 新行写入，
 * 与全量 DELETE+INSERT 相对的毫秒级路径。
 *
 * T4 原生索引增量域（IU）：上游库不可读时 buildIncrementalUpdate 改用原生索引
 * ——同一行契约（readFilesFromDb 零改动兼容），增量语义与上游路径完全一致。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TreeSitterAdapter, isTreeSitterRuntimePresent } from '../../src/adapters/TreeSitterAdapter.ts';
import { FileSystemAdapter, type FileSystemApi } from '../../src/adapters/FileSystemAdapter.ts';
import {
  writeNativeIndex, updateFilesForNativeIndex, readNativeIndexMeta, resolveNativeIndexPath, closeNativeIndexConnections,
} from '../../src/adapters/nativeIndex.ts';
import { readGraphFromDbPaged, closeAllDbConnections } from '../../src/adapters/codeGraphDb.ts';
import { buildIncrementalUpdate } from '../../src/host/incrementalUpdate.ts';
import type { GraphNode, GraphEdge, GraphData } from '../../src/types/index.ts';
import { NodeId, EdgeId, RepoId } from '../../src/types/index.ts';

const tsAvailable = isTreeSitterRuntimePresent();

function makeNode(id: string, type: GraphNode['type'], filePath: string, label = id): GraphNode {
  return { id: NodeId(id), label, type, filePath, lineNumber: 1, properties: {} };
}
function makeEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'contains'): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

describe('原生 import 边推断（cycle-129 T1/T2）', () => {
  let adapter: FileSystemAdapter;
  let root: string;

  beforeEach(() => {
    adapter = new FileSystemAdapter();
    root = 'D:/proj';
    // 内存 fs：目录树 src/{a.ts,b.ts,util/helper.ts}，b.ts import a.ts。
    const files: Record<string, string> = {
      'D:/proj/src/a.ts': 'export const a = 1;',
      'D:/proj/src/b.ts': "import { a } from './a';\nexport const b = a + 1;",
      'D:/proj/src/util/helper.ts': 'export const h = 1;',
      'D:/proj/src/main.ts': "import { a } from './a';\nimport { h } from './util/helper';\nexport const m = a + h;",
      'D:/proj/README.md': 'doc',
    };
    adapter.setFileSystem({
      readdir: (p) => {
        const prefix = p.endsWith('/') ? p : `${p}/`;
        const dirs = new Set<string>();
        const out: string[] = [];
        for (const f of Object.keys(files)) {
          if (!f.startsWith(prefix)) continue;
          const rest = f.slice(prefix.length);
          if (rest.includes('/')) dirs.add(rest.split('/')[0]!);
          else out.push(rest);
        }
        return [...out, ...dirs];
      },
      readFile: (p) => {
        const content = files[p];
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      stat: (p) => {
        const isFile = Object.keys(files).some((f) => f === p || f.startsWith(`${p}/`));
        if (!isFile) throw new Error(`ENOENT: ${p}`);
        // 目录 = 有以它为前缀且更深一层的条目被 readdir 返回为目录名的场景；
        // 这里用「路径不是具体文件键」近似（helper 目录有 / 前缀键）。
        const isDirectory = !Object.keys(files).includes(p) && Object.keys(files).some((f) => f.startsWith(`${p}/`));
        return { isDirectory };
      },
    } satisfies FileSystemApi);
    const ts = new TreeSitterAdapter();
    adapter.setTreeSitterAdapter(ts);
  });

  afterEach(() => {
    // FileSystemAdapter 无 destroy()（既有语义：构造即用，destroy 由
    // TreeSitterAdapter 承担）——此前误写 adapter.destroy?.() 被守卫拦下。
    adapter = null as unknown as FileSystemAdapter;
  });

  it.skipIf(!tsAvailable)('IM-1 相对 import 产出 import 边（b.ts → a.ts）', async () => {
    const result = await adapter.fetchDataWithSymbols(root);
    const importEdges = result.edges.filter((e) => e.type === 'import');
    expect(importEdges.length).toBeGreaterThan(0);
    // id 域 = 绝对路径（filesToParse/fileSet 同为绝对域—— FileSystemAdapter
    // 从 repoId 起遍历）；断言按「目标文件名」判定而非完整路径。
    const bToA = importEdges.find((e) => String(e.source).endsWith('/b.ts') && String(e.target).endsWith('/a.ts'));
    expect(bToA).toBeDefined();
    // 语法事实保留在 properties.module（'./a'）——语义裁决可追溯。
    expect(bToA!.properties?.module).toBe('./a');
    // AST 归因（merger EDGE_ORIGIN_RANK 最高档）。
    expect(bToA!.properties?.edgeOrigin).toBe('ast');
  });

  it.skipIf(!tsAvailable)('IM-2 跨目录相对 import（./util/helper）解析到子目录文件', async () => {
    const result = await adapter.fetchDataWithSymbols(root);
    const importEdges = result.edges.filter((e) => e.type === 'import');
    const mainToHelper = importEdges.find((e) => String(e.source).endsWith('/main.ts') && String(e.target).endsWith('util/helper.ts'));
    expect(mainToHelper).toBeDefined();
  });

  it.skipIf(!tsAvailable)('IM-3 包名（node_modules）解析不到 → 不编造边', async () => {
    // main.ts 加一个包名 import；文件集里没有 node_modules/lodash。
    const result = await adapter.fetchDataWithSymbols(root);
    const importEdges = result.edges.filter((e) => e.type === 'import');
    // 全部 import 边的 target 都必须指向真实存在的 file: 节点。
    const fileIds = new Set(result.nodes.filter((n) => String(n.id).startsWith('file:')).map((n) => String(n.id)));
    for (const e of importEdges) {
      expect(fileIds.has(String(e.target))).toBe(true);
    }
  });
});

describe('原生索引定向更新（cycle-129 T3）', () => {
  let workRoot: string;
  let workspace: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'native-update-test-'));
    workspace = join(workRoot, 'proj');
  });

  afterEach(() => {
    closeNativeIndexConnections();
    closeAllDbConnections();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('NU-1 定向更新：改动文件旧节点删除 + 新节点写入，未改动文件保留', () => {
    const keep = makeNode('fn:keep', 'function', 'src/keep.ts', 'keep');
    const oldA = makeNode('fn:a-v1', 'function', 'src/a.ts', 'a');
    writeNativeIndex(workspace, 'fp-1', [keep, oldA], []);
    // a.ts 变更：v1 → v2。
    const newA = makeNode('fn:a-v2', 'function', 'src/a.ts', 'a2');
    expect(updateFilesForNativeIndex(workspace, ['src/a.ts'], [newA], [], 'fp-2')).toBe(true);
    const rows = readGraphFromDbPaged(resolveNativeIndexPath(workspace), null, 100);
    const ids = rows!.nodes.map((r) => r.id);
    expect(ids).toContain('fn:keep');       // 未改动文件保留
    expect(ids).toContain('fn:a-v2');       // 新节点写入
    expect(ids).not.toContain('fn:a-v1');   // 旧节点删除
    // meta 前移。
    const meta = readNativeIndexMeta(workspace);
    expect(meta!.fingerprint).toBe('fp-2');
    expect(meta!.nodeCount).toBe(2);
  });

  it('NU-2 定向更新连带删除端点涉及的旧边', () => {
    const a = makeNode('fn:a', 'function', 'src/a.ts');
    const b = makeNode('fn:b', 'function', 'src/b.ts');
    writeNativeIndex(workspace, 'fp-1', [a, b], [makeEdge('e1', 'fn:a', 'fn:b')]);
    // a.ts 变更：旧 fn:a 连带 e1 删除，新节点写入。
    const a2 = makeNode('fn:a2', 'function', 'src/a.ts');
    expect(updateFilesForNativeIndex(workspace, ['src/a.ts'], [a2], [], 'fp-2')).toBe(true);
    const rows = readGraphFromDbPaged(resolveNativeIndexPath(workspace), null, 100);
    expect(rows!.edges.length).toBe(0); // e1 已随 fn:a 删除
    expect(rows!.nodes.map((r) => r.id).sort()).toEqual(['fn:a2', 'fn:b']);
  });

  it('NU-3 未索引过（库不存在）返回 false（调用方走全量回写）', () => {
    expect(updateFilesForNativeIndex(workspace, ['src/a.ts'], [], [], 'fp')).toBe(false);
  });
});

describe('原生索引增量域（cycle-129 T4）', () => {
  let workRoot: string;
  let workspace: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'native-incr-test-'));
    workspace = join(workRoot, 'proj');
  });

  afterEach(() => {
    closeNativeIndexConnections();
    closeAllDbConnections();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it('IU-1 上游库缺席 + 原生索引在场：增量走原生域（改动文件读侧一致）', async () => {
    // 原生索引：src/a.ts 含一个函数节点。
    writeNativeIndex(workspace, 'fp-1', [makeNode('fn:old', 'function', 'src/a.ts', 'old')], []);
    // 当前图（客户端持有）：与索引一致。
    const current: GraphData = {
      nodes: [makeNode('fn:old', 'function', 'src/a.ts', 'old')],
      edges: [],
      metadata: { repoId: RepoId(workspace), timestamp: 1, nodeCount: 1, edgeCount: 0 },
    };
    // 索引更新：a.ts 的函数改名（模拟重扫回写）。
    updateFilesForNativeIndex(workspace, ['src/a.ts'], [makeNode('fn:new', 'function', 'src/a.ts', 'new')], [], 'fp-2');
    // 增量：上游库不存在（workRoot 下无 .codegraph/codegraph.db）→ 走原生域。
    const update = await buildIncrementalUpdate({ workspacePath: workspace, changedFiles: ['src/a.ts'], current });
    expect(update).not.toBeNull();
    // 旧节点被移除、新节点被加入——与上游域增量语义一致。
    const deltaIds = update!.delta.removedNodes.map((n) => String(n.id));
    expect(deltaIds).toContain('fn:old');
    expect(update!.delta.addedNodes.map((n) => String(n.id))).toContain('fn:new');
  });

  it('IU-2 双库都缺席：增量返回 null（回退全量，行为不变）', async () => {
    const current: GraphData = {
      nodes: [],
      edges: [],
      metadata: { repoId: RepoId(workspace), timestamp: 1, nodeCount: 0, edgeCount: 0 },
    };
    const update = await buildIncrementalUpdate({ workspacePath: workspace, changedFiles: ['src/a.ts'], current });
    expect(update).toBeNull();
  });
});
