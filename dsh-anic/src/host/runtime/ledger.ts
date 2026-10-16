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

/**
 * 磁盘形态（P0-LEDGER-SHAPE）。
 *
 * 真实工作区 `.cycles/gates/ledger.json` 是 **对象包裹形态** `{ "entries": [...] }`
 * （63 条历史条目，快照/步骤投影/治理三处读者都按此形态解析），
 * 而本模块早期只认**裸数组形态**。后果是三重的：
 *   1. `loadLedger` 对真实账本恒返回 `[]`；
 *   2. `verifyLedger` 因此返回 `{ok:true,total:0}` —— 对一条真实断链谎报"校验通过"；
 *   3. `appendEntry` 把读到的 `[]` 追加一条后**整文件覆盖**，63 条历史一次性销毁。
 *
 * 修法：读时**兼容两种形态**，写时**回写读到的同一种形态**（新文件默认包裹形态，
 * 与全生态读者一致）。形态必须随内容一起往返，否则"读一种、写另一种"仍会丢数据。
 */
type LedgerShape = 'wrapped' | 'array';

interface LedgerFile {
  entries: LedgerEntry[];
  shape: LedgerShape;
  /**
   * 包裹形态的顶层 `chainHead` 字段（== 末条 hash，docs/anic/08 §54 形态）。
   * 技能脚本 lib/ledger.mjs 是本工件的**正典写入者**：它以 `ledger.chainHead` 作为
   * 下一条的 previousHash，并把 HEAD_MISMATCH 列为校验问题。若本模块追加时把该字段
   * 丢掉（只写 `{entries}`），技能脚本侧会立刻：verify 报 HEAD_MISMATCH、
   * 下一次 append 以 undefined 为 previousHash —— 两个写入者必须输出同一形态。
   */
  chainHead: string | null;
}

/** 读账本文件：兼容 `{entries:[…], chainHead}` 与裸数组，返回条目 + 原形态 + 链头。 */
function readLedgerFile(cyclesDir: string): LedgerFile {
  const p = join(cyclesDir, LEDGER_FILE);
  if (!existsSync(p)) return { entries: [], shape: 'wrapped', chainHead: null };
  try {
    const raw: unknown = JSON.parse(readFileSync(p, 'utf-8'));
    if (Array.isArray(raw)) return { entries: raw as LedgerEntry[], shape: 'array', chainHead: null };
    const wrapped = raw as { entries?: unknown; chainHead?: unknown };
    const entries = Array.isArray(wrapped.entries) ? (wrapped.entries as LedgerEntry[]) : [];
    // chainHead 缺失时以末条 hash 自愈（文档化不变量 chainHead == 末条 hash），而非写回 undefined
    const head =
      typeof wrapped.chainHead === 'string'
        ? wrapped.chainHead
        : entries.length > 0
          ? (entries[entries.length - 1]?.hash ?? null)
          : null;
    return { entries, shape: 'wrapped', chainHead: head };
  } catch {
    // 结构损坏按空账本处理，但**保持包裹形态**：否则一次畸形读会让后续 append 写坏形态
    return { entries: [], shape: 'wrapped', chainHead: null };
  }
}

/**
 * 按指定形态序列化（包裹形态保留 `entries` + `chainHead` 键，与正典写入者契约一致）。
 * 裸数组形态无法携带链头字段，保持纯数组（该形态本就没有 chainHead 概念）。
 */
function serializeLedger(entries: LedgerEntry[], shape: LedgerShape, chainHead: string | null): string {
  return shape === 'array'
    ? JSON.stringify(entries, null, 2)
    : JSON.stringify({ entries, chainHead }, null, 2);
}

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

/**
 * 加载既有账本（兼容包裹形态 `{entries:[…]}` 与裸数组形态）。
 *
 * 既有契约：损坏/缺失一律按空账本处理（不 throw）。
 */
export function loadLedger(cyclesDir: string): LedgerEntry[] {
  return readLedgerFile(cyclesDir).entries;
}

/**
 * 追加一条（单写者，原子写）。返回新条目（含 hash）。
 *
 * 回写形态 = 读到的形态（P0-LEDGER-SHAPE）：真实工作区是包裹形态，
 * 若在此写回裸数组，63 条历史会被一次性覆盖丢失。
 */
export function appendEntry(
  cyclesDir: string,
  entry: Omit<LedgerEntry, 'hash' | 'previousHash' | 'timestamp'> & { timestamp?: string },
): LedgerEntry {
  const dir = join(cyclesDir, 'gates');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const file = readLedgerFile(cyclesDir);
  const existing = file.entries;
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
  // 与正典写入者 lib/ledger.mjs:71 一致：追加后链头推进为新条目 hash
  const chainHead = withHash.hash;
  atomicWriteFileSync(join(cyclesDir, LEDGER_FILE), serializeLedger(existing, file.shape, chainHead));
  return withHash;
}

/** 验证整链（含包裹形态的 chainHead 一致性检查）。 */
export function verifyLedger(cyclesDir: string): VerifyResult {
  const file = readLedgerFile(cyclesDir);
  const entries = file.entries;
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
  // HEAD_MISMATCH（与 lib/ledger.mjs:114-120 同一判据）：包裹形态的 chainHead 必须等于末条 hash。
  // 否则插件说"链有效"而正典写入者说"链头断裂"——两个校验器必须给出同一个答案。
  const lastHash = entries[entries.length - 1]?.hash ?? null;
  if (file.shape === 'wrapped' && file.chainHead !== null && file.chainHead !== lastHash) {
    return {
      ok: false,
      total: entries.length,
      brokenAt: entries.length - 1,
      reason: `chain head mismatch (expected ${lastHash}, got ${file.chainHead})`,
    };
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
