/**
 * 探针：验证 codegraph DB 里「文件节点」的 id 约定是否为 `file:<相对路径>`。
 *
 * 这是 P0-D 修复的关键前提：若该约定可复现，`/diff` 就能用 git 给出的变更文件列表
 * 生成**与画布同一命名空间**的节点 id，从而让 `applyDiffMarkers` 真正命中。
 *
 * 只读，不写任何文件。
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const ws = process.argv[2] ?? process.cwd();
const dbPath = path.join(ws, '.codegraph', 'codegraph.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const rows = db.prepare(`SELECT id, name, file_path, start_line FROM nodes WHERE kind = 'file' LIMIT 500`).all();
const total = db.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE kind = 'file'`).get();
const allKinds = db.prepare(`SELECT kind, COUNT(*) AS c FROM nodes GROUP BY kind ORDER BY c DESC`).all();
db.close();

let matches = 0;
const mismatches = [];
for (const r of rows) {
  const expected = `file:${String(r.file_path).split(path.sep).join('/')}`;
  if (r.id === expected) matches += 1;
  else if (mismatches.length < 10) mismatches.push({ id: r.id, expected, name: r.name, file_path: r.file_path, line: r.start_line });
}

console.log(JSON.stringify({
  fileNodeTotal: total.c,
  sampled: rows.length,
  exactMatches: matches,
  mismatches,
  kinds: allKinds,
}, null, 2));
