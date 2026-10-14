import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initSegmentedLedger,
  appendToSegmented,
  loadSegmented,
  verifySegmented,
  isDuplicateSegmented,
  computeEntryHash,
  listSegmentFiles,
} from '../../src/host/runtime/segmentedLedger.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anic-seg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('segmentedLedger — M2-b 分段账本', () => {
  it('init 创建 head.json + seg-000000.jsonl', () => {
    const head = initSegmentedLedger(dir);
    expect(head.version).toBe(1);
    expect(head.entryCount).toBe(0);
    expect(head.segCount).toBe(1);
    expect(existsSync(join(dir, 'head.json'))).toBe(true);
    expect(existsSync(join(dir, 'seg-000000.jsonl'))).toBe(true);
  });

  it('init 幂等：已存在则返回当前 head', () => {
    const h1 = initSegmentedLedger(dir);
    const h2 = initSegmentedLedger(dir);
    expect(h2).toEqual(h1);
  });

  it('append 追加条目并更新 chainHead', () => {
    initSegmentedLedger(dir);
    const { entry, head } = appendToSegmented(dir, {
      gate: 'G0',
      gateName: '评估基线',
      result: 'PASS',
      detail: '基线建立',
      timestamp: '2024-01-01T00:00:00Z',
    });
    expect(entry.previousHash).toBe('');
    expect(head.entryCount).toBe(1);
    expect(head.chainHead).toBe(computeEntryHash(entry));
  });

  it('append 链式：第二条 previousHash = 第一条 hash', () => {
    initSegmentedLedger(dir);
    const r1 = appendToSegmented(dir, {
      gate: 'G0', gateName: '评估基线', result: 'PASS', detail: 'd1', timestamp: '2024-01-01T00:00:00Z',
    });
    const r2 = appendToSegmented(dir, {
      gate: 'G1', gateName: '任务清零', result: 'PASS', detail: 'd2', timestamp: '2024-01-01T00:01:00Z',
    });
    expect(r2.entry.previousHash).toBe(r1.head.chainHead);
    expect(r2.head.entryCount).toBe(2);
  });

  it('load 读取全量条目', () => {
    initSegmentedLedger(dir);
    appendToSegmented(dir, { gate: 'G0', gateName: 'a', result: 'PASS', detail: 'd1', timestamp: 't1' });
    appendToSegmented(dir, { gate: 'G1', gateName: 'b', result: 'PASS', detail: 'd2', timestamp: 't2' });
    const data = loadSegmented(dir);
    expect(data).not.toBeNull();
    expect(data!.entries).toHaveLength(2);
    expect(data!.head.entryCount).toBe(2);
  });

  it('verify 正常链 valid=true', () => {
    initSegmentedLedger(dir);
    appendToSegmented(dir, { gate: 'G0', gateName: 'a', result: 'PASS', detail: 'd1', timestamp: 't1' });
    appendToSegmented(dir, { gate: 'G1', gateName: 'b', result: 'PASS', detail: 'd2', timestamp: 't2' });
    const v = verifySegmented(dir);
    expect(v.valid).toBe(true);
    expect(v.entryCount).toBe(2);
    expect(v.breakAt).toBeNull();
  });

  it('verify 断链 valid=false', () => {
    initSegmentedLedger(dir);
    appendToSegmented(dir, { gate: 'G0', gateName: 'a', result: 'PASS', detail: 'd1', timestamp: 't1' });
    // 手动篡改 seg 文件（模拟攻击）
    const segFile = join(dir, 'seg-000000.jsonl');
    const content = readFileSync(segFile, 'utf-8');
    const tampered = content.replace('"result":"PASS"', '"result":"FAIL"');
    require('node:fs').writeFileSync(segFile, tampered);
    const v = verifySegmented(dir);
    expect(v.valid).toBe(false);
  });

  it('isDuplicate 检测重复条目', () => {
    initSegmentedLedger(dir);
    appendToSegmented(dir, { gate: 'G0', gateName: 'a', result: 'PASS', detail: 'd1', timestamp: 't1' });
    expect(isDuplicateSegmented(dir, { gate: 'G0', gateName: 'a', result: 'PASS', detail: 'd1' })).toBe(true);
    expect(isDuplicateSegmented(dir, { gate: 'G0', gateName: 'a', result: 'FAIL', detail: 'd1' })).toBe(false);
  });

  it('listSegmentFiles 返回排序的 seg 文件名', () => {
    initSegmentedLedger(dir);
    const files = listSegmentFiles(dir);
    expect(files).toEqual(['seg-000000.jsonl']);
  });

  it('head.json 是 canonical JSON（可解析）', () => {
    initSegmentedLedger(dir);
    const raw = readFileSync(join(dir, 'head.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.segMaxEntries).toBe(1000);
  });
});
