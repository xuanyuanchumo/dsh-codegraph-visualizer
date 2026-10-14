/**
 * 账本唯一实现（F2，M2-a）。
 *
 * 哈希链：每条 entry 的 hash = sha256(canonical(entry_without_hash) + previousHash)。
 * canonical = 固定六字段键序 {gate,gateName,result,detail,timestamp,previousHash}，
 * JSON.stringify 默认序列化（M0-③ 验证 56/56 既有条目全等）。
 *
 * INV-20（canonical 冻结）：键序不得变，否则既有链全部断。
 * 单写者：所有 append 经此模块，双通道（HTTP + tool）同一路径（F15）。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../../shared/fs-safe.ts';

/** 账本条目（v1 形态，与既有 .cycles/gates/ledger.json 兼容）。 */
export interface LedgerEntry {
  gate: string;
  gateName: string;
  result: 'PASS' | 'FAIL';
  detail: string;
  timestamp: string;
  previousHash: string | null;
  hash?: string;
}

/** 账本验证结果。 */
export interface VerifyResult {
  ok: boolean;
  total: number;
  brokenAt: number | null;
  reason: string | null;
}

const LEDGER_FILE = 'gates/ledger.json';

/** canonical 键序（M0-③ golden vector 3d77e40f…）。 */
function canonical(entry: Omit<LedgerEntry, 'hash'>): string {
  return JSON.stringify({
    gate: entry.gate,
    gateName: entry.gateName,
    result: entry.result,
    detail: entry.detail,
    timestamp: entry.timestamp,
    previousHash: entry.previousHash,
  });
}

/** 计算条目 hash。 */
export function computeHash(entry: Omit<LedgerEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(entry)).digest('hex');
}

/** 加载既有账本（数组形态）。 */
export function loadLedger(cyclesDir: string): LedgerEntry[] {
  const p = join(cyclesDir, LEDGER_FILE);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** 追加一条（单写者，原子写）。返回新条目（含 hash）。 */
export function appendEntry(
  cyclesDir: string,
  entry: Omit<LedgerEntry, 'hash' | 'previousHash' | 'timestamp'> & { timestamp?: string },
): LedgerEntry {
  const dir = join(cyclesDir, 'gates');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const existing = loadLedger(cyclesDir);
  const lastEntry = existing.length > 0 ? existing[existing.length - 1] : undefined;
  const previousHash = lastEntry?.hash ?? null;
  const ts = entry.timestamp ?? new Date().toISOString();

  const full: Omit<LedgerEntry, 'hash'> = {
    gate: entry.gate,
    gateName: entry.gateName,
    result: entry.result,
    detail: entry.detail,
    timestamp: ts,
    previousHash,
  };
  const hash = computeHash(full);
  const withHash: LedgerEntry = { ...full, hash };

  existing.push(withHash);
  atomicWriteFileSync(join(cyclesDir, LEDGER_FILE), JSON.stringify(existing, null, 2));
  return withHash;
}

/** 验证整链。 */
export function verifyLedger(cyclesDir: string): VerifyResult {
  const entries = loadLedger(cyclesDir);
  if (entries.length === 0) return { ok: true, total: 0, brokenAt: null, reason: null };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    // 链首 previousHash 可为 null（genesis）或非 null（历史形态）
    const prevEntry = i > 0 ? entries[i - 1] : undefined;
    const expectedPrev = prevEntry?.hash ?? null;
    if (i > 0 && e.previousHash !== expectedPrev) {
      return { ok: false, total: entries.length, brokenAt: i, reason: `previousHash mismatch at index ${i}` };
    }
    const { hash: _omit, ...rest } = e;
    const expectedHash = computeHash(rest);
    if (e.hash !== expectedHash) {
      return { ok: false, total: entries.length, brokenAt: i, reason: `hash mismatch at index ${i}` };
    }
  }
  return { ok: true, total: entries.length, brokenAt: null, reason: null };
}

/** 幂等查重：同 gate + 同 result 的最新条目已存在则不追加（F25 雏形）。 */
export function isDuplicate(cyclesDir: string, gate: string, result: string): boolean {
  const entries = loadLedger(cyclesDir);
  if (entries.length === 0) return false;
  const last = entries[entries.length - 1];
  return last !== undefined && last.gate === gate && last.result === result;
}
