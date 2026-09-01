import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const p = join(process.env.USERPROFILE, '.dsh/profiles/web/node_modules/dsh-codegraph/lib/index.js');
const s = readFileSync(p, 'utf8');

// Find executableHint and CLI command references
for (const kw of ['executableHint', '@colbymchenry/codegraph', 'graph --', 'export', "'graph'"]) {
  const idx = s.indexOf(kw);
  if (idx >= 0) {
    console.log(`=== '${kw}' @ ${idx} ===`);
    console.log(s.slice(Math.max(0, idx - 200), idx + 600));
    console.log('');
  }
}
