// 探针：量化「diff 里的文件有多少能在画布上被展开出来」。
// 目的：验证 DiffPanel 文案「展开更多目录可显示」是否成立。
import { DatabaseSync } from 'node:sqlite';

const base = 'http://127.0.0.1:3080/api/v1/codegraph';
const workspace = 'D:\\Projects\\TraeProjects\\dsh-codegraph-visualizer';

const res = await fetch(`${base}/diff`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ workspace, from: 'HEAD~1', to: 'HEAD' }),
});
const json = await res.json();
if (!json.metadata) {
  console.log('request failed', JSON.stringify(json));
  process.exit(1);
}
console.log('repoId from host:', JSON.stringify(json.metadata.repoId));
const diffPaths = (json.nodes ?? []).map((n) => String(n.id).replace(/^file:/, ''));
console.log('diff files total:', diffPaths.length);

const db = new DatabaseSync('.codegraph/codegraph.db', { readOnly: true });
const stmt = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE kind='file' AND file_path = ?");
let indexed = 0;
const missing = [];
for (const p of diffPaths) {
  if (stmt.get(p).c > 0) indexed += 1;
  else missing.push(p);
}
console.log('indexed in DB (reachable by expanding):', indexed);
console.log('NOT indexed (unreachable forever):', missing.length);
console.log('unreachable sample:', JSON.stringify(missing.slice(0, 15)));
db.close();
