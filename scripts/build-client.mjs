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
import { renameSync, existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
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

  console.log('[build-client] Step 4: copy tree-sitter WASM files -> dist/client/');
  const wasmSourceDir = join(root, 'node_modules', 'tree-sitter-wasm', 'out');
  const wasmDestDir = join(root, 'dist', 'client');
  const neededLanguages = ['typescript', 'javascript', 'python', 'java', 'rust', 'go'];
  if (existsSync(wasmSourceDir)) {
    for (const lang of neededLanguages) {
      const srcFile = join(wasmSourceDir, lang, `tree-sitter-${lang}.wasm`);
      if (existsSync(srcFile)) {
        copyFileSync(srcFile, join(wasmDestDir, `tree-sitter-${lang}.wasm`));
        console.log(`  copied tree-sitter-${lang}.wasm`);
      }
    }
  } else {
    console.warn('  WARNING: tree-sitter-wasm/out not found, skipping WASM copy');
  }

  console.log('[build-client] Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});