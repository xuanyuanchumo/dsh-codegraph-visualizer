/**
 * M2-b 分段账本：head.json + seg-NNNNNN.jsonl 只追加。
 *
 * 解决单文件 ledger.json 的 O(n²) 重写问题：
 * - append 只向当前 seg 文件追加一行（O(1)），不重写历史
 * - head.json 只存元数据（entryCount/segCount/chainHead），小且低频更新
 * - verify 顺序读所有 seg 文件，不加载全量到内存
 *
 * INV-13 确定性：canonical 六字段键序 + JSON.stringify 默认序列化
 * INV-7 原子写：head.json 用 atomicWriteFileSync
 * INV-15 只追加：seg 文件只 append，永不重写
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../../shared/fs-safe.ts';

// ── 类型 ────────────────────────────────────────────────

export interface LedgerEntry {
  gate: string;
  gateName: string;
  result: string;
  detail: string;
  timestamp: string;
  previousHash: string;
}

export interface HeadMeta {
  version: 1;
  entryCount: number;
  segCount: number;
  segMaxEntries: number;
  chainHead: string;
  createdAt: string;
  lastAppendedAt: string;
}

export interface SegmentedLedger {
  head: HeadMeta;
  entries: LedgerEntry[];
}

const SEG_MAX_ENTRIES = 1000;
const HEAD_FILENAME = 'head.json';
const SEG_PATTERN = /^seg-(\d{6})\.jsonl$/;

// ── canonical hash ──────────────────────────────────────

const FIELD_ORDER = ['gate', 'gateName', 'result', 'detail', 'timestamp', 'previousHash'] as const;

export function computeEntryHash(entry: LedgerEntry): string {
  const canonical: Record<string, string> = {};
  for (const key of FIELD_ORDER) {
    canonical[key] = entry[key];
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// ── head 管理 ───────────────────────────────────────────

function headPath(dir: string): string {
  return join(dir, HEAD_FILENAME);
}

function segPath(dir: string, segIndex: number): string {
  return join(dir, `seg-${String(segIndex).padStart(6, '0')}.jsonl`);
}

function loadHead(dir: string): HeadMeta | null {
  const hp = headPath(dir);
  if (!existsSync(hp)) return null;
  const raw = readFileSync(hp, 'utf-8');
  try {
    return JSON.parse(raw) as HeadMeta;
  } catch {
    return null;
  }
}

function saveHead(dir: string, head: HeadMeta): void {
  atomicWriteFileSync(headPath(dir), JSON.stringify(head, null, 2) + '\n');
}

// ── 公开 API ────────────────────────────────────────────

/** 初始化分段账本（幂等：已存在则返回当前 head） */
export function initSegmentedLedger(dir: string): HeadMeta {
  const existing = loadHead(dir);
  if (existing !== null) return existing;

  const now = new Date().toISOString();
  const head: HeadMeta = {
    version: 1,
    entryCount: 0,
    segCount: 1,
    segMaxEntries: SEG_MAX_ENTRIES,
    chainHead: '',
    createdAt: now,
    lastAppendedAt: now,
  };
  saveHead(dir, head);
  // 创建空 seg 文件
  appendFileSync(segPath(dir, 0), '');
  return head;
}

/** 向分段账本追加一条记录（O(1) append + 小 head 更新） */
export function appendToSegmented(
  dir: string,
  partial: Omit<LedgerEntry, 'previousHash'>,
): { entry: LedgerEntry; head: HeadMeta } {
  let head = loadHead(dir);
  if (head === null) {
    head = initSegmentedLedger(dir);
  }

  // 确定当前 seg 是否已满
  const currentSegIndex = head.segCount - 1;
  const currentSegFile = segPath(dir, currentSegIndex);
  const segContent = existsSync(currentSegFile) ? readFileSync(currentSegFile, 'utf-8') : '';
  const segLineCount = segContent.trim() === '' ? 0 : segContent.trim().split('\n').length;

  let targetSegIndex = currentSegIndex;
  if (segLineCount >= head.segMaxEntries) {
    // 滚到新 seg
    targetSegIndex = currentSegIndex + 1;
    head.segCount = targetSegIndex + 1;
    appendFileSync(segPath(dir, targetSegIndex), '');
  }

  // 构建 entry（链：previousHash = 当前 chainHead）
  const entry: LedgerEntry = {
    ...partial,
    previousHash: head.chainHead,
  };
  const entryHash = computeEntryHash(entry);

  // 追加到 seg 文件（只追加，不重写）
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(segPath(dir, targetSegIndex), line);

  // 更新 head（小文件原子写）
  head.entryCount += 1;
  head.chainHead = entryHash;
  head.lastAppendedAt = new Date().toISOString();
  saveHead(dir, head);

  return { entry, head };
}

/** 读取全部分段账本条目（用于展示） */
export function loadSegmented(dir: string): SegmentedLedger | null {
  const head = loadHead(dir);
  if (head === null) return null;

  const entries: LedgerEntry[] = [];
  for (let i = 0; i < head.segCount; i++) {
    const sp = segPath(dir, i);
    if (!existsSync(sp)) continue;
    const content = readFileSync(sp, 'utf-8').trim();
    if (content === '') continue;
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue;
      try {
        entries.push(JSON.parse(line) as LedgerEntry);
      } catch {
        // 跳过损坏行（INV-15 只追加不重写，不修复）
      }
    }
  }

  return { head, entries };
}

/** 验证分段账本哈希链 */
export function verifySegmented(dir: string): { valid: boolean; entryCount: number; breakAt: number | null } {
  const head = loadHead(dir);
  if (head === null) return { valid: false, entryCount: 0, breakAt: null };

  let prevHash = '';
  let count = 0;
  let breakAt: number | null = null;

  for (let i = 0; i < head.segCount; i++) {
    const sp = segPath(dir, i);
    if (!existsSync(sp)) continue;
    const content = readFileSync(sp, 'utf-8').trim();
    if (content === '') continue;
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue;
      let entry: LedgerEntry;
      try {
        entry = JSON.parse(line) as LedgerEntry;
      } catch {
        breakAt = count;
        break;
      }
      if (entry.previousHash !== prevHash) {
        breakAt = count;
        break;
      }
      const expectedHash = computeEntryHash(entry);
      prevHash = expectedHash;
      count++;
    }
    if (breakAt !== null) break;
  }

  const valid = breakAt === null && count === head.entryCount && prevHash === head.chainHead;
  return { valid, entryCount: count, breakAt };
}

/** 幂等查重（检查 gate + result + detail 组合是否已存在） */
export function isDuplicateSegmented(dir: string, partial: Omit<LedgerEntry, 'previousHash' | 'timestamp'>): boolean {
  const data = loadSegmented(dir);
  if (data === null) return false;
  return data.entries.some(
    (e) => e.gate === partial.gate && e.result === partial.result && e.detail === partial.detail,
  );
}

/** 列出所有 seg 文件名（用于诊断） */
export function listSegmentFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => SEG_PATTERN.test(f))
    .sort();
}
