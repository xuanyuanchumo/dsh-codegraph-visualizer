/**
 * snapshotCore 单元测试 —— 纯函数层，无需宿主、无需真实 .cycles/。
 *
 * 夹具承载的是历史上真实踩过的缺陷类（每条断言都对应一个教训）：
 *   - cycle-9 vs cycle-10 数值序（字典序 .sort() 是 gate-check/eval-runner 老缺陷家族）
 *   - autonomy_level 带引号（org-status 正则改写缺陷家族：引号写法不得破坏解析）
 *   - gate 事件 → 宏图门节点 evidences 映射（小写 id 约定）
 *   - 任一数据源缺失 → 安全降级不 throw（宿主路由对未 init 项目必须可用）
 *   - 确定性（同输入同输出；generatedAt 显式注入）
 *   - INV-21：节点/边只携带结构化字段，绝不从 detail 自由文本解析身份
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkflowSnapshot, parseWorkflowGraph } from '../../src/shared/snapshotCore.ts';

const CLEANUPS: string[] = [];
function makeCyclesDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'anic-snap-'));
  const cycles = join(root, '.cycles');
  mkdirSync(cycles, { recursive: true });
  CLEANUPS.push(root);
  return cycles;
}
afterEach((): void => {
  while (CLEANUPS.length > 0) {
    const dir = CLEANUPS.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const WORKFLOW_GRAPH = [
  '# workflow graph',
  'nodes:',
  '  - id: intent',
  '    type: play',
  '    label: "意图捕获" # comment',
  '  - id: gate-g0',
  '    type: gate',
  '    label: "G0 评估基线"',
  '  - id: spec',
  '    type: artifact',
  '    label: "规格"',
  'edges:',
  '  - { from: intent, to: spec, type: "flow" }',
  '  - { from: spec, to: gate-g0, type: "flow" }',
  '',
].join('\n');

const LEDGER = JSON.stringify({
  entries: [
    { gate: 'G0', gateName: '评估收敛门', result: 'PASS', detail: '…', timestamp: '2026-10-13T00:00:00.000Z', previousHash: null, hash: 'h0' },
    { gate: 'G2', gateName: '测试收敛门', result: 'PASS', detail: '…', timestamp: '2026-10-13T01:00:00.000Z', previousHash: 'h0', hash: 'h1' },
  ],
  chainHead: 'h1',
});

function writeFullFixture(): string {
  const cycles = makeCyclesDir();
  writeFileSync(join(cycles, 'workflow-graph.yaml'), WORKFLOW_GRAPH);
  for (const n of ['cycle-9', 'cycle-10']) {
    mkdirSync(join(cycles, 'cycles', n), { recursive: true });
    writeFileSync(join(cycles, 'cycles', n, '任务清单.md'), '- [x] P0 完成');
  }
  mkdirSync(join(cycles, 'gates'), { recursive: true });
  writeFileSync(join(cycles, 'gates', 'ledger.json'), LEDGER);
  mkdirSync(join(cycles, 'incidents'), { recursive: true });
  writeFileSync(join(cycles, 'incidents', 'incident-a.md'), 'x');
  writeFileSync(join(cycles, 'incidents', 'incident-b.md'), 'y');
  writeFileSync(join(cycles, 'config.yml'), 'autonomy_level: "L3"\n');
  return cycles;
}

describe('buildWorkflowSnapshot（完整夹具）', () => {
  const snap = buildWorkflowSnapshot(writeFullFixture(), '2026-01-01T00:00:00.000Z');

  it('宏图节点/边按 workflow-graph.yaml 构建', () => {
    expect(snap.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['wf:intent', 'wf:gate-g0', 'wf:spec']));
    expect(snap.edges).toContainEqual({ from: 'wf:intent', to: 'wf:spec', type: 'flow' });
  });

  it('gate 类型节点映射为 gate 组（唯一不可跳过的人类门）', () => {
    const gate = snap.nodes.find((n) => n.id === 'wf:gate-g0');
    expect(gate?.type).toBe('gate');
  });

  it('账本事件逐条成节点并链接 event-seq 链', () => {
    expect(snap.counts.ledgerEntries).toBe(2);
    expect(snap.nodes.find((n) => n.id === 'evt:0')?.label).toContain('G0 PASS');
    expect(snap.edges).toContainEqual({ from: 'evt:0', to: 'evt:1', type: 'event-seq' });
  });

  it('evidences 边只在宏图存在同名（小写）门节点时出现', () => {
    expect(snap.edges).toContainEqual({ from: 'evt:0', to: 'wf:gate-g0', type: 'evidences' });
    expect(snap.edges.some((e) => e.from === 'evt:1' && e.type === 'evidences')).toBe(false);
  });

  it('cycle 目录用数值序（cycle-9 先于 cycle-10），cycle-seq 方向正确', () => {
    const ids = snap.nodes.map((n) => n.id);
    expect(ids.indexOf('cycle:cycle-9')).toBeLessThan(ids.indexOf('cycle:cycle-10'));
    expect(snap.edges).toContainEqual({ from: 'cycle:cycle-9', to: 'cycle:cycle-10', type: 'cycle-seq' });
  });

  it('带引号的 autonomy_level 正确解析（引号容错回归）', () => {
    expect(snap.autonomy).toBe('L3');
  });

  it('incidents 以文件名计数并入 aux 组', () => {
    expect(snap.counts.incidents).toBe(2);
    expect(snap.nodes.find((n) => n.id === 'inc:incident-a.md')).toBeTruthy();
    expect(snap.nodes.find((n) => n.id === 'aux:auto')?.label).toContain('autonomy L3');
  });

  it('确定：同输入两次构建深相等（generatedAt 注入）', () => {
    const again = buildWorkflowSnapshot(writeFullFixture(), '2026-01-01T00:00:00.000Z');
    expect(again).toEqual(snap);
  });

  it('INV-21：节点/边只携带结构化字段', () => {
    for (const n of snap.nodes) {
      expect(Object.keys(n).every((k) => ['id', 'type', 'label', 'x', 'y', 'result'].includes(k))).toBe(true);
    }
    for (const e of snap.edges) {
      expect(Object.keys(e).every((k) => ['from', 'to', 'type'].includes(k))).toBe(true);
    }
  });
});

describe('buildWorkflowSnapshot（缺源降级）', () => {
  it('空 .cycles 不 throw，返回可用空图与 L? 兜底', () => {
    const cycles = makeCyclesDir();
    const snap = buildWorkflowSnapshot(cycles, '2026-01-01T00:00:00.000Z');
    expect(snap.counts).toEqual({ nodes: 1, edges: 0, cycles: 0, ledgerEntries: 0, incidents: 0 });
    expect(snap.autonomy).toBe('L?');
    expect(snap.nodes.map((n) => n.id)).toEqual(['aux:auto']);
  });

  it('畸形 ledger.json 不 throw（结构损坏按 0 条处理）', () => {
    const cycles = makeCyclesDir();
    mkdirSync(join(cycles, 'gates'), { recursive: true });
    writeFileSync(join(cycles, 'gates', 'ledger.json'), '{not json');
    const snap = buildWorkflowSnapshot(cycles, '2026-01-01T00:00:00.000Z');
    expect(snap.counts.ledgerEntries).toBe(0);
  });
});

describe('parseWorkflowGraph', () => {
  it('解析节点 id/type/label 并剥离行尾注释', () => {
    const { nodes, edges } = parseWorkflowGraph(WORKFLOW_GRAPH);
    expect(nodes).toEqual([
      { id: 'intent', type: 'play', label: '意图捕获' },
      { id: 'gate-g0', type: 'gate', label: 'G0 评估基线' },
      { id: 'spec', type: 'artifact', label: '规格' },
    ]);
    expect(edges).toEqual([
      { from: 'intent', to: 'spec', type: 'flow' },
      { from: 'spec', to: 'gate-g0', type: 'flow' },
    ]);
  });

  it('缺 type 的节点兜底 phase、缺 type 的边兜底 flow', () => {
    const { nodes, edges } = parseWorkflowGraph('nodes:\n  - id: solo\nedges:\n  - { from: a, to: b }\n');
    expect(nodes[0]?.type).toBe('phase');
    expect(edges[0]?.type).toBe('flow');
  });
});
