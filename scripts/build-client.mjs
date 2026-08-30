/**
 * build:client orchestrator — produces two client bundle formats:
 *
 * 1. dist/client/index.esm.js  — ESM (for the dev server's dynamic import)
 * 2. dist/client/index.js      — CJS wrapped in __ModuleLoader__.load (for DSH web)
 *
 * DSH web loads /plugins/<name>/client.js via a classic <script> tag and
 * expects the __ModuleLoader__.load({ id, factory: (require) => {... } })
 * signature. The dev server uses ESM dynamic import() so it needs the
 * plain ESM build.
 */
import { renameSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const root = process.cwd();

async function run(cmd) {
  console.log(`  $ ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { cwd: root });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

async function main() {
  console.log('[build-client] Step 1: ESM build -> dist/client/index.esm.js');
  await run('npx tsdown src/client/index.ts --format esm --outDir dist/client --platform browser --external react --external react-dom --external @deepseek-ai/cordis --external @deepseek-ai/dsh-client-runtime');

  // tsdown outputs index.js; rename to index.esm.js
  if (existsSync('dist/client/index.js')) {
    renameSync('dist/client/index.js', 'dist/client/index.esm.js');
    console.log('  renamed dist/client/index.js -> dist/client/index.esm.js');
  }

  console.log('[build-client] Step 2: CJS build -> dist/client-cjs/index.cjs');
  await run('npx tsdown src/client/index.ts --format cjs --outDir dist/client-cjs --platform browser --external react --external react-dom --external @deepseek-ai/cordis --external @deepseek-ai/dsh-client-runtime');

  console.log('[build-client] Step 3: wrap CJS in __ModuleLoader__.load -> dist/client/index.js');
  await run('node scripts/wrap-client-bundle.mjs dist/client-cjs/index.cjs dist/client/index.js dsh-codegraph-visualizer');

  console.log('[build-client] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});