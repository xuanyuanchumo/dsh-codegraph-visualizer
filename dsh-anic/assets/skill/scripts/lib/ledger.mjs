// ledger.mjs — 哈希链门禁账本核心（进化 iteration-1：从 gate-ledger.mjs 抽出，修 S-5 / S-6）
// 设计约束（兼容铁律）：
//   1. hash 计算 = sha256(JSON.stringify(entryData))，entryData 六字段键序
//      { gate, gateName, result, detail, timestamp, previousHash } —— 一个字符都不能动，
//      否则既有账本（如本仓库 56 条历史记录）全部 HASH_MISMATCH。
//   2. verify 用每条 entry 自身字段重算，因此新 entry 允许附加新字段，旧账本依然验证通过。
//   3. saveLedger 走原子写（修 S-6：原先裸 writeFileSync，中断留半写文件毁链）。
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteFileSync } from './fs-safe.mjs';

export const GATE_NAMES = {
  G0: '评估收敛门',
  G1: '任务收敛门',
  G2: '测试收敛门',
  G3: '构建收敛门',
};

export const VALID_GATES = Object.keys(GATE_NAMES);

export function ledgerPathFor(projectDir) {
  return join(projectDir, '.cycles', 'gates', 'ledger.json');
}

export function computeHash(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function loadLedger(projectDir) {
  const ledgerPath = ledgerPathFor(projectDir);
  if (!existsSync(ledgerPath)) return { entries: [], chainHead: null };
  return JSON.parse(readFileSync(ledgerPath, 'utf-8'));
}

export function saveLedger(projectDir, ledger) {
  const gatesDir = join(projectDir, '.cycles', 'gates');
  if (!existsSync(gatesDir)) mkdirSync(gatesDir, { recursive: true });
  atomicWriteFileSync(ledgerPathFor(projectDir), JSON.stringify(ledger, null, 2));
}

export function appendEntry(projectDir, gate, result, detail, extra = {}) {
  const ledger = loadLedger(projectDir);
  const timestamp = new Date().toISOString();
  const gateName = GATE_NAMES[gate] || gate;

  const entryData = JSON.stringify({
    gate,
    gateName,
    result: result.toUpperCase(),
    detail: detail || 'N/A',
    timestamp,
    previousHash: ledger.chainHead,
  });

  const hash = computeHash(entryData);

  // extra 只进入 entry 本体（不进入 entryData/hash）——哈希形状保持与历史账本逐字节一致
  const entry = {
    gate,
    gateName,
    result: result.toUpperCase(),
    detail: detail || 'N/A',
    timestamp,
    previousHash: ledger.chainHead,
    hash,
    ...extra,
  };

  ledger.entries.push(entry);
  ledger.chainHead = hash;
  saveLedger(projectDir, ledger);

  return entry;
}

export function verifyLedger(projectDir) {
  const ledger = loadLedger(projectDir);
  const issues = [];

  let expectedPrevHash = null;
  for (let i = 0; i < ledger.entries.length; i++) {
    const entry = ledger.entries[i];

    if (entry.previousHash !== expectedPrevHash) {
      issues.push({
        index: i,
        type: 'CHAIN_BREAK',
        message: `Entry ${i}: previousHash mismatch (expected ${expectedPrevHash}, got ${entry.previousHash})`,
      });
    }

    const entryData = JSON.stringify({
      gate: entry.gate,
      gateName: entry.gateName,
      result: entry.result,
      detail: entry.detail,
      timestamp: entry.timestamp,
      previousHash: entry.previousHash,
    });

    const computedHash = computeHash(entryData);
    if (computedHash !== entry.hash) {
      issues.push({
        index: i,
        type: 'HASH_MISMATCH',
        message: `Entry ${i}: hash mismatch (expected ${computedHash}, got ${entry.hash})`,
      });
    }

    expectedPrevHash = entry.hash;
  }

  if (ledger.chainHead !== expectedPrevHash && ledger.entries.length > 0) {
    issues.push({
      index: -1,
      type: 'HEAD_MISMATCH',
      message: `Chain head mismatch (expected ${expectedPrevHash}, got ${ledger.chainHead})`,
    });
  }

  return { valid: issues.length === 0, issues, totalEntries: ledger.entries.length };
}

export function listEntries(projectDir) {
  return loadLedger(projectDir).entries;
}
