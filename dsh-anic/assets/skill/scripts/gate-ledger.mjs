#!/usr/bin/env node
// gate-ledger.mjs — 哈希链门禁账本：tamper-evident hash-chained ledger
// 用法:
//   记录: node gate-ledger.mjs <project-dir> --gate G0 --result PASS [--detail "..."]
//   验证: node gate-ledger.mjs <project-dir> --verify
//   列表: node gate-ledger.mjs <project-dir> --list
//
// 进化 iteration-1：核心实现抽到 scripts/lib/ledger.mjs（单一事实来源，供
// multi-agent-gate.mjs 的 gatekeeper 复用真实验证，修 S-5）；saveLedger 改原子写（修 S-6）；
// 未知 --gate 由"静默接受"改为响亮失败（修 S-11，原 GATE_NAMES[gate] || gate 会把
// 任意字符串写进账本并假冒 GATE_NAMES）。CLI 输出与 v1.6 逐字节一致。

import { resolve } from 'node:path';
import { appendEntry, listEntries, VALID_GATES, verifyLedger } from './lib/ledger.mjs';

function parseArgs(argv) {
  const args = { _: [], gate: null, result: null, detail: '', verify: false, list: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--gate') args.gate = argv[++i];
    else if (argv[i] === '--result') args.result = argv[++i];
    else if (argv[i] === '--detail') args.detail = argv[++i];
    else if (argv[i] === '--verify') args.verify = true;
    else if (argv[i] === '--list') args.list = true;
    else args._.push(argv[i]);
  }
  return args;
}

const args = parseArgs(process.argv);

if (args._.length === 0) {
  console.error('Usage: node gate-ledger.mjs <project-dir> --gate G0|G1|G2|G3 --result PASS|FAIL [--detail "..."]');
  console.error('       node gate-ledger.mjs <project-dir> --verify');
  console.error('       node gate-ledger.mjs <project-dir> --list');
  process.exit(1);
}

const projectDir = resolve(args._[0]);

if (args.verify) {
  const result = verifyLedger(projectDir);
  console.log(`Gate Ledger Verification`);
  console.log(`  Total entries: ${result.totalEntries}`);
  console.log(`  Valid: ${result.valid ? 'YES' : 'NO'}`);
  if (result.totalEntries === 0 && result.valid) {
    // 修 N-9（v1.8.0）：空账本曾输出裸 "Valid: YES"，无法区分"没记录过"与"未被篡改"。
    console.log(`  Note: ledger is empty — no gate results recorded yet. "Valid" only means no tampering.`);
  }
  if (result.issues.length > 0) {
    console.log(`  Issues (${result.issues.length}):`);
    for (const issue of result.issues) {
      console.log(`    [${issue.type}] ${issue.message}`);
    }
    process.exit(1);
  } else {
    console.log(`  All entries verified. Hash chain intact.`);
  }
} else if (args.list) {
  const entries = listEntries(projectDir);
  if (entries.length === 0) {
    console.log('No gate entries recorded.');
  } else {
    console.log(`Gate Ledger (${entries.length} entries):`);
    for (const e of entries) {
      console.log(`  [${e.timestamp}] ${e.gate} ${e.gateName} — ${e.result}`);
      console.log(`    hash: ${e.hash.substring(0, 16)}...`);
      console.log(`    detail: ${e.detail.substring(0, 80)}`);
    }
  }
} else if (args.gate && args.result) {
  if (!VALID_GATES.includes(args.gate)) {
    console.error(`Unknown gate: ${args.gate}. Valid gates: ${VALID_GATES.join(', ')}`);
    process.exit(1);
  }
  const entry = appendEntry(projectDir, args.gate, args.result, args.detail);
  console.log(`Gate ${args.gate} ${entry.result} recorded.`);
  console.log(`  Hash: ${entry.hash.substring(0, 16)}...`);
  console.log(`  Previous: ${entry.previousHash ? entry.previousHash.substring(0, 16) + '...' : 'GENESIS'}`);
  console.log(`  Timestamp: ${entry.timestamp}`);

  if (entry.result === 'FAIL') {
    console.error(`Gate ${args.gate} FAILED. Must fix issues before proceeding.`);
  }
} else {
  console.error('Must specify --gate and --result, or --verify, or --list');
  process.exit(1);
}
