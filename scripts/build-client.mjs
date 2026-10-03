/**
 * build:client orchestrator — produces the browser artefacts of the plugin:
 *
 * 1. dist/client/index.esm.js  — ESM (for the dev server's dynamic import)
 * 2. dist/client/index.d.ts    — declarations for the `./client` export subpath
 * 3. dist/client.js            — CJS wrapped in __ModuleLoader__.load (what DSH web loads)
 * 4. dist/client/worker/layoutWorker.js — the classic Worker that runs graph layout off-thread
 *
 * No tree-sitter WASM is emitted here: the adapter that parses with tree-sitter runs in the host
 * process only and resolves grammars next to the `tree-sitter-wasm` package, so copies under
 * dist/client had no reader (4.05 MB of pure publish weight). Languages are added to that package,
 * not to this build.
 *
 * DSH web pulls the plugin client bundle through its own `/plugins/??...` entry list and expects
 * the __ModuleLoader__.load({ id, factory: (require) => {... } }) signature, so the wrapped CJS
 * build is the shipping artefact. DSH serves no asset route for plugin files, so the layout worker
 * is fetched from this plugin's own HTTP surface (see src/host/routes/workerRoutes.ts) and must
 * therefore stay a single self-contained file.
 */
import { renameSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execAsync = promisify(exec);
const root = process.cwd();

async function run(cmd) {
  console.log(`  $ ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { cwd: root });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

async function main() {
  console.log('[build-client] Step 0: clean dist/client and dist/client-cjs');
  for (const dir of ['dist/client', 'dist/client-cjs']) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`  cleaned ${dir}`);
    }
  }
  mkdirSync('dist/client', { recursive: true });

  console.log('[build-client] Step 1: ESM build + declarations -> dist/client/index.esm.js');
  // `--dts` is what makes the `./client` export subpath honest: package.json advertises
  // dist/client/index.d.ts, so the build has to produce it.
  await run('npx tsdown src/client/index.ts --format esm --dts --outDir dist/client --platform browser --external react --external react-dom --external @deepseek-ai/cordis --external @deepseek-ai/dsh-client-runtime');

  // tsdown outputs index.js; rename to index.esm.js (the .d.ts keeps its own name)
  if (existsSync('dist/client/index.js')) {
    renameSync('dist/client/index.js', 'dist/client/index.esm.js');
    console.log('  renamed dist/client/index.js -> dist/client/index.esm.js');
  }
  if (!existsSync('dist/client/index.d.ts')) {
    throw new Error('client build produced no dist/client/index.d.ts, but package.json exports it as the ./client types entry');
  }

  console.log('[build-client] Step 2: CJS build -> dist/client-cjs/index.cjs');
  await run('npx tsdown src/client/index.ts --format cjs --outDir dist/client-cjs --platform browser --external react --external react-dom --external @deepseek-ai/cordis --external @deepseek-ai/dsh-client-runtime');

  console.log('[build-client] Step 3: wrap CJS in __ModuleLoader__.load -> dist/client.js');
  await run('node scripts/wrap-client-bundle.mjs dist/client-cjs/index.cjs dist/client.js dsh-codegraph-visualizer');

  // The CJS build is an intermediate: the wrap step consumed it (including its inlined CSS), and
  // `files: ["dist"]` would otherwise publish 2.3 MB of duplicate bundle nothing can import.
  if (existsSync('dist/client-cjs')) {
    rmSync('dist/client-cjs', { recursive: true, force: true });
    console.log('  removed intermediate dist/client-cjs');
  }

  console.log('[build-client] Step 4: layout worker -> dist/client/worker/layoutWorker.js');
  // IIFE on purpose: a classic worker is one self-contained file, so no shared chunk can be
  // requested from a sibling URL that the exact-path route would not serve. The worker imports
  // cytoscape/dagre/fcose, which bundling pulls in.
  mkdirSync(join('dist', 'client', 'worker'), { recursive: true });
  await run('npx tsdown src/client/worker/layoutWorker.ts --format iife --outDir dist/client/worker --platform browser');
  for (const produced of ['layoutWorker.global.js', 'layoutWorker.iife.js']) {
    if (existsSync(join('dist', 'client', 'worker', produced))) {
      renameSync(join('dist', 'client', 'worker', produced), join('dist', 'client', 'worker', 'layoutWorker.js'));
      console.log(`  renamed ${produced} -> layoutWorker.js`);
    }
  }
  const workerFiles = readdirSync('dist/client/worker');
  if (!workerFiles.includes('layoutWorker.js')) {
    throw new Error(`layout worker build produced no layoutWorker.js (got: ${workerFiles.join(', ') || 'nothing'})`);
  }
  if (workerFiles.length > 1) {
    throw new Error(
      `layout worker must stay a single self-contained file, but the build emitted: ${workerFiles.join(', ')}`,
    );
  }
  console.log(`  layout worker bytes: ${statSync(join('dist', 'client', 'worker', 'layoutWorker.js')).size}`);

  console.log('[build-client] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});