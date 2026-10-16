/**
 * M2-a 运行时模块测试：ledger + stateMachine + stackProbe + cycleRunner。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeHash, loadLedger, appendEntry, verifyLedger, isDuplicate, type LedgerEntry } from '../../src/host/runtime/ledger.ts';
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

  // ── P0-LEDGER-SHAPE 回归：真实工作区账本是**包裹形态** `{entries:[…]}` ──
  // 契约来源：D:\Projects\TraeProjects\dsh-codegraph-visualizer\.cycles\gates\ledger.json
  // （63 条条目，顶层为对象且含 `entries` 键；snapshotCore.ts:74 / stepTrace.ts:62
  //   两个既有读者均按此形态解析）。下方 fixture 逐字段转录该文件首条条目。
  describe('wrapped ledger shape ({entries:[…]})', () => {
    /** 逐字段转录自真实 .cycles/gates/ledger.json 的 genesis 条目。 */
    const GENESIS: LedgerEntry = {
      gate: 'G0',
      gateName: '评估收敛门',
      result: 'PASS',
      detail: '评估报告与事实基座抽验通过（cycle-78）',
      timestamp: '2026-10-05T00:00:00.000Z',
      previousHash: 'c2e7c9e5eeaf7c18af4a35efed17169e8a5d516130864194c55f3e337ad66404',
      hash: 'c9d448ba8ed100ea7de8c2f4af31318d9b8210e09260d4c59dafeb3859379ddf',
    };

    function writeWrapped(cyclesDir: string, entries: LedgerEntry[], chainHead?: string): void {
      mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
      // 真实磁盘形态是 {entries, chainHead}（正典写入者 lib/ledger.mjs 的输出）；
      // 默认按文档化不变量 chainHead == 末条 hash 写入，可显式传错值构造 HEAD 断裂样本
      const head = chainHead ?? entries[entries.length - 1]?.hash ?? null;
      writeFileSync(join(cyclesDir, 'gates/ledger.json'), JSON.stringify({ entries, chainHead: head }, null, 2));
    }

    it('loadLedger reads the wrapped form (bare-array-only reader returned [])', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      const second: LedgerEntry = {
        gate: 'G1',
        gateName: '任务登记门',
        result: 'PASS',
        detail: '任务清单已登记',
        timestamp: '2026-10-05T00:00:00.000Z',
        previousHash: GENESIS.hash ?? null,
        hash: '988680351f5a1a9acbc9cf7b86e62f0079e9c815de71bf6c185c67afae70925a',
      };
      writeWrapped(cyclesDir, [GENESIS, second]);
      expect(loadLedger(cyclesDir)).toHaveLength(2);
      expect(loadLedger(cyclesDir)[0]?.gate).toBe('G0');
    });

    it('verifyLedger reports the REAL total on a wrapped ledger (not a false ok/0)', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      writeWrapped(cyclesDir, [GENESIS]);
      const v = verifyLedger(cyclesDir);
      // 单条 genesis：previousHash 非 null 是历史形态，链首豁免；hash 自洽
      expect(v.total).toBe(1);
      expect(v.ok).toBe(true);
    });

    it('verifyLedger detects a break in a WRAPPED ledger (was silently ok:true)', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      const tampered: LedgerEntry = { ...GENESIS, detail: 'tampered after hashing' };
      writeWrapped(cyclesDir, [tampered]);
      const v = verifyLedger(cyclesDir);
      expect(v.ok).toBe(false);
      expect(v.brokenAt).toBe(0);
      expect(v.reason).toContain('hash mismatch');
    });

    it('appendEntry PRESERVES all existing wrapped entries (was a full-file overwrite)', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      writeWrapped(cyclesDir, [GENESIS]);
      const appended = appendEntry(cyclesDir, { gate: 'G1', gateName: '任务登记门', result: 'PASS', detail: 'next' });

      // 1) 旧条目仍在（这正是原实现丢失的 63 条历史）
      const after = loadLedger(cyclesDir);
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual(GENESIS);
      // 2) 链正确接续到既有末条
      expect(appended.previousHash).toBe(GENESIS.hash);
      // 3) 形态往返：写回仍是包裹形态，既有读者 snapshotCore/stepTrace 才能继续解析
      const raw: unknown = JSON.parse(readFileSync(join(cyclesDir, 'gates/ledger.json'), 'utf-8'));
      expect(Array.isArray(raw)).toBe(false);
      expect((raw as { entries?: unknown[] }).entries).toHaveLength(2);
      // 4) chainHead 往返 + 推进（P1 残留回归）：正典写入者 lib/ledger.mjs 以顶层
      //    chainHead 作为下一条 previousHash；若本模块追加时丢掉该字段，技能脚本侧
      //    verify 立即报 HEAD_MISMATCH、下一次 append 以 undefined 接链
      expect((raw as { chainHead?: string }).chainHead).toBe(appended.hash);
    });

    it('appendEntry SELF-HEALS a wrapped file that lacked chainHead (never writes undefined)', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
      // 历史中间形态：有 entries 无 chainHead —— 读取自愈为末条 hash，追加后写回完整形态
      writeFileSync(join(cyclesDir, 'gates/ledger.json'), JSON.stringify({ entries: [GENESIS] }, null, 2));
      const appended = appendEntry(cyclesDir, { gate: 'G1', gateName: '任务登记门', result: 'PASS', detail: 'heal' });
      const raw = JSON.parse(readFileSync(join(cyclesDir, 'gates/ledger.json'), 'utf-8')) as {
        entries?: unknown[];
        chainHead?: unknown;
      };
      expect(raw.entries).toHaveLength(2);
      expect(raw.chainHead).toBe(appended.hash);
      expect(typeof raw.chainHead).toBe('string'); // 不是 undefined（undefined 会毒化正典写入者）
    });

    it('verifyLedger flags a WRONG chainHead (HEAD_MISMATCH, same verdict as the canonical writer)', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      // 传入一个与末条 hash 不一致的链头：正典写入者会报 HEAD_MISMATCH，本模块必须同判
      writeWrapped(cyclesDir, [GENESIS], 'deadbeef'.repeat(8));
      const v = verifyLedger(cyclesDir);
      expect(v.ok).toBe(false);
      expect(v.reason).toContain('chain head mismatch');
      expect(v.brokenAt).toBe(0);
    });

    it('appendEntry keeps the BARE-ARRAY shape when that is what it read', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
      writeFileSync(join(cyclesDir, 'gates/ledger.json'), JSON.stringify([GENESIS], null, 2));
      appendEntry(cyclesDir, { gate: 'G1', gateName: '任务登记门', result: 'PASS', detail: 'next' });
      const raw: unknown = JSON.parse(readFileSync(join(cyclesDir, 'gates/ledger.json'), 'utf-8'));
      // 形态必须随内容往返：读数组就写数组，不能中途改成包裹形态
      expect(Array.isArray(raw)).toBe(true);
      expect((raw as unknown[])).toHaveLength(2);
    });

    it('isDuplicate sees the wrapped ledger last entry (was always false)', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      writeWrapped(cyclesDir, [GENESIS]);
      expect(isDuplicate(cyclesDir, 'G0', 'PASS')).toBe(true);
      expect(isDuplicate(cyclesDir, 'G0', 'FAIL')).toBe(false);
    });

    it('a malformed wrapped file reads as empty but keeps the wrapped shape on append', () => {
      const cyclesDir = join(tmpDir, '.cycles');
      mkdirSync(join(cyclesDir, 'gates'), { recursive: true });
      writeFileSync(join(cyclesDir, 'gates/ledger.json'), '{not json');
      expect(loadLedger(cyclesDir)).toEqual([]);
      appendEntry(cyclesDir, { gate: 'G0', gateName: '评估收敛门', result: 'PASS', detail: 'recover' });
      const raw: unknown = JSON.parse(readFileSync(join(cyclesDir, 'gates/ledger.json'), 'utf-8'));
      expect((raw as { entries?: unknown[] }).entries).toHaveLength(1);
    });
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
