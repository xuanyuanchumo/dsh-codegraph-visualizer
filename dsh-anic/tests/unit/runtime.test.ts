/**
 * M2-a 运行时模块测试：ledger + stateMachine + stackProbe + cycleRunner。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeHash, loadLedger, appendEntry, verifyLedger, isDuplicate } from '../../src/host/runtime/ledger.ts';
import { parseWorkflowGraph, initState, advance, checkStrict, type WorkflowGraph } from '../../src/host/runtime/stateMachine.ts';
import { probeStack, configToYaml } from '../../src/host/runtime/stackProbe.ts';
import { initCycle, advanceCycle, closeCycle, listCycles, nextCycleNumber } from '../../src/host/runtime/cycleRunner.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'anic-m2a-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ledger', () => {
  it('computes deterministic hash for canonical entry', () => {
    const entry = { gate: 'G0', gateName: '评估基线', result: 'PASS' as const, detail: 'baseline ok', timestamp: '2026-01-01T00:00:00Z', previousHash: null };
    const h1 = computeHash(entry);
    const h2 = computeHash(entry);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });

  it('appends entry with correct hash chain', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(join(cyclesDir, 'gates'), { recursive: true });

    const e1 = appendEntry(cyclesDir, { gate: 'G0', gateName: '评估基线', result: 'PASS', detail: 'first' });
    expect(e1.hash).toBeDefined();
    expect(e1.previousHash).toBeNull();

    const e2 = appendEntry(cyclesDir, { gate: 'G1', gateName: '任务清零', result: 'PASS', detail: 'second' });
    expect(e2.previousHash).toBe(e1.hash);

    const entries = loadLedger(cyclesDir);
    expect(entries).toHaveLength(2);
    expect(entries[1].previousHash).toBe(entries[0].hash);
  });

  it('verifies valid chain', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
    appendEntry(cyclesDir, { gate: 'G0', gateName: '评估基线', result: 'PASS', detail: 'a' });
    appendEntry(cyclesDir, { gate: 'G1', gateName: '任务清零', result: 'PASS', detail: 'b' });
    const v = verifyLedger(cyclesDir);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(2);
  });

  it('detects broken chain', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
    appendEntry(cyclesDir, { gate: 'G0', gateName: '评估基线', result: 'PASS', detail: 'a' });
    appendEntry(cyclesDir, { gate: 'G1', gateName: '任务清零', result: 'PASS', detail: 'b' });
    // 篡改第二条的 hash
    const entries = loadLedger(cyclesDir);
    entries[1].hash = 'tampered';
    writeFileSync(join(cyclesDir, 'gates/ledger.json'), JSON.stringify(entries, null, 2));
    const v = verifyLedger(cyclesDir);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it('detects duplicate (same gate + result as last)', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
    appendEntry(cyclesDir, { gate: 'G0', gateName: '评估基线', result: 'PASS', detail: 'a' });
    expect(isDuplicate(cyclesDir, 'G0', 'PASS')).toBe(true);
    expect(isDuplicate(cyclesDir, 'G0', 'FAIL')).toBe(false);
    expect(isDuplicate(cyclesDir, 'G1', 'PASS')).toBe(false);
  });

  it('returns empty for missing ledger', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    expect(loadLedger(cyclesDir)).toEqual([]);
    const v = verifyLedger(cyclesDir);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(0);
  });
});

describe('stateMachine', () => {
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'intent', type: 'Play' },
      { id: 'spec', type: 'Gate', gate: 'spec' },
      { id: 'code', type: 'Play' },
    ],
    edges: [
      { from: 'intent', to: 'spec' },
      { from: 'spec', to: 'code' },
    ],
  };

  it('inits all nodes to pending', () => {
    const state = initState(graph);
    expect(state.intent.status).toBe('pending');
    expect(state.spec.status).toBe('pending');
    expect(state.code.status).toBe('pending');
  });

  it('advances non-gate node after predecessor done', () => {
    let state = initState(graph);
    const r1 = advance(graph, state, 'intent');
    expect(r1.ok).toBe(true);
    expect(state.intent.status).toBe('done');
  });

  it('blocks gate without approval', () => {
    let state = initState(graph);
    advance(graph, state, 'intent');
    const r = advance(graph, state, 'spec');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('gateApproved');
  });

  it('advances gate with approval', () => {
    let state = initState(graph);
    advance(graph, state, 'intent');
    const r = advance(graph, state, 'spec', { gateApproved: true });
    expect(r.ok).toBe(true);
    expect(state.spec.status).toBe('done');
  });

  it('strict check fails on unapproved gate', () => {
    let state = initState(graph);
    advance(graph, state, 'intent');
    const check = checkStrict(graph, state);
    expect(check.ok).toBe(false);
  });

  it('parses workflow-graph.yaml text', () => {
    const yaml = `
nodes:
  - id: intent
    type: Play
  - id: spec
    type: Gate
    gate: spec
edges:
  - from: intent to: spec
`;
    const g = parseWorkflowGraph(yaml);
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes[1].type).toBe('Gate');
    expect(g.edges).toHaveLength(1);
  });
});

describe('stackProbe', () => {
  it('detects Node.js project', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{"scripts":{"build":"tsc","test":"vitest","lint":"oxlint"}}');
    const r = probeStack(tmpDir);
    expect(r.type).toBe('node');
    expect(r.detected).toContain('package.json');
    expect(r.config.test_cmd).toContain('test');
  });

  it('detects Cargo project', () => {
    writeFileSync(join(tmpDir, 'Cargo.toml'), '[package]');
    const r = probeStack(tmpDir);
    expect(r.type).toBe('cargo');
    expect(r.config.build_cmd).toBe('cargo build');
  });

  it('detects Python project', () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[project]');
    const r = probeStack(tmpDir);
    expect(r.type).toBe('python');
    expect(r.config.test_cmd).toBe('pytest');
  });

  it('detects Go project', () => {
    writeFileSync(join(tmpDir, 'go.mod'), 'module example');
    const r = probeStack(tmpDir);
    expect(r.type).toBe('go');
  });

  it('falls back to generic', () => {
    const r = probeStack(tmpDir);
    expect(r.type).toBe('generic');
    expect(r.config.autonomy_level).toBe('L1');
  });

  it('generates YAML from config', () => {
    const r = probeStack(tmpDir);
    const yaml = configToYaml(r.config);
    expect(yaml).toContain('build_cmd:');
    expect(yaml).toContain('test_cmd:');
    expect(yaml).toContain('autonomy_level:');
  });
});

describe('cycleRunner', () => {
  it('inits cycle with correct number', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(cyclesDir, { recursive: true });
    const info = initCycle(cyclesDir, 'test-project');
    expect(info.cycleNumber).toBe(1);
    const info2 = initCycle(cyclesDir, 'test-project');
    expect(info2.cycleNumber).toBe(2);
  });

  it('lists cycles in numeric order', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(cyclesDir, { recursive: true });
    initCycle(cyclesDir);
    initCycle(cyclesDir);
    initCycle(cyclesDir);
    const nums = listCycles(cyclesDir);
    expect(nums).toEqual([1, 2, 3]);
  });

  it('nextCycleNumber is max+1', () => {
    const cyclesDir = join(tmpDir, '.cycles');
    mkdirSync(cyclesDir, { recursive: true });
    initCycle(cyclesDir);
    initCycle(cyclesDir);
    expect(nextCycleNumber(cyclesDir)).toBe(3);
  });
});
