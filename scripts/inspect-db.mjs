import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const dbPath = join(process.cwd(), '.codegraph/codegraph.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('TABLES:', tables.map((t) => t.name).join(', '));

for (const t of tables) {
  if (t.name.startsWith('sqlite_') || t.name.startsWith('fts_')) continue;
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get();
  console.log(`\n=== ${t.name} (${count.c} rows) ===`);
  console.log(cols.map((c) => `${c.name}:${c.type}`).join(', '));
  const sample = db.prepare(`SELECT * FROM ${t.name} LIMIT 2`).all();
  console.log('SAMPLE:', JSON.stringify(sample, null, 1).slice(0, 800));
}
db.close();