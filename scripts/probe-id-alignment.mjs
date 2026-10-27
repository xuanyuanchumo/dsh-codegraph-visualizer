/**
 * 探针：验证「tree-sitter 符号 id」与「codegraph DB 节点」能否用复合键对齐。
 *
 * 目的：P0-D 修复后 `/diff` 的节点来自 tree-sitter（id = `${filePath}:${label}:${row}`，row 0-based），
 * 而画布上的节点来自 codegraph DB（id = `n.id`）。两者 id 命名空间不同，`applyDiffMarkers`
 * 按 id 匹配会全部落空（markStats.missing = 全部）。本探针量化「按 (filePath, label, lineNumber)
 * 复合键匹配」的真实命中率，再决定是否值得在客户端加回退键。
 *
 * 只读，不写任何文件。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ws = process.argv[2] ?? process.cwd();
const dbPath = path.join(ws, '.codegraph', 'codegraph.db');
if (!fs.existsSync(dbPath)) {
  console.log(JSON.stringify({ error: 'db missing', dbPath }));
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(
  `SELECT id, kind, name, file_path, start_line FROM nodes WHERE file_path IS NOT NULL ORDER BY file_path, start_line LIMIT 400`,
).all();
db.close();

const byFile = new Map();
for (const r of rows) {
  const key = r.file_path;
  if (!byFile.has(key)) byFile.set(key, []);
  byFile.get(key).push(r);
}

// 用与 TreeSitterAdapter 完全相同的 id 方案对每个文件做符号提取的近似：
// 这里不加载 wasm 语法，而是用正则粗估「label 在多少行出现」不可靠 —— 因此改为：
// 只统计 DB 侧同一 (file_path, name, start_line) 三元组的唯一性，以及文件是否可读。
let fileReadable = 0;
let fileMissing = 0;
const sample = [];
let dupTriples = 0;
const seen = new Set();

for (const [filePath, nodes] of byFile) {
  const abs = path.join(ws, filePath);
  if (fs.existsSync(abs)) fileReadable += 1;
  else { fileMissing += 1; continue; }
  for (const n of nodes) {
    const triple = `${filePath}|${n.name}|${n.start_line}`;
    if (seen.has(triple)) dupTriples += 1;
    else seen.add(triple);
    if (sample.length < 8) sample.push({ id: n.id, kind: n.kind, name: n.name, file: filePath, line: n.start_line, triple });
  }
}

console.log(JSON.stringify({
  dbPath,
  totalRows: rows.length,
  distinctFiles: byFile.size,
  fileReadable,
  fileMissing,
  duplicateTriples: dupTriples,
  distinctTriples: seen.size,
  sample,
}, null, 2));
