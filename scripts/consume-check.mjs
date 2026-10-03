/**
 * consume-check — verify that the published package can actually be consumed.
 *
 * The old `hygiene` script was `publint dist && node scripts/consume-check.mjs`, which meant two
 * independent reasons for the gate to be dead: `publint` was never a devDependency (so the command
 * failed instantly with "not recognized") and this file did not exist. A gate that cannot run is
 * worse than no gate, because the green CI signal is a lie. These checks need nothing but the
 * checkout, and every failure is a concrete, fixable statement about the shipped artefact.
 *
 * `publint` is still worth running when it is available, so it is invoked opportunistically.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (pkg.name !== 'dsh-codegraph-visualizer') {
  console.error(`[consume-check] refusing to run outside the plugin checkout (name: ${pkg.name})`);
  process.exit(1);
}

const failures = [];
const notes = [];

function check(name, fn) {
  try {
    const detail = fn();
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  FAIL  ${name} — ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function humans(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

console.log('[consume-check] export map');

// Every advertised subpath has to resolve to a file that exists — this is the check that would
// have caught `./client`.types pointing at a dist/client/index.d.ts the client build never emitted.
for (const [subpath, target] of Object.entries(pkg.exports)) {
  const value = typeof target === 'string' ? { default: target } : target;
  for (const [kind, pattern] of Object.entries(value)) {
    if (!pattern.includes('*')) {
      check(`exports["${subpath}"].${kind} -> ${pattern}`, () => {
        assert(existsSync(resolve(root, pattern)), `${pattern} does not exist; run \`pnpm run build\``);
      });
      continue;
    }
    check(`exports["${subpath}"].${kind} -> ${pattern}`, () => {
      const dir = resolve(root, dirname(pattern).split('*')[0]);
      const ext = pattern.slice(pattern.lastIndexOf('*') + 1);
      assert(existsSync(dir), `${dir} does not exist`);
      const matches = readdirSync(dir).filter((name) => name.endsWith(ext));
      assert(matches.length > 0, `no file matching ${pattern} (found: ${readdirSync(dir).join(', ') || 'nothing'})`);
      return `${matches.length} match(es)`;
    });
  }
}

check(`files allowlist covers every advertised subpath`, () => {
  const dirs = new Set();
  for (const target of Object.values(pkg.exports)) {
    const value = typeof target === 'string' ? { default: target } : target;
    for (const pattern of Object.values(value)) {
      if (pattern === './package.json' || pattern.includes('*')) {
        const first = pattern.split('*')[0];
        dirs.add(first.replace(/^\.\//, '').split('/')[0]);
        continue;
      }
      dirs.add(pattern.replace(/^\.\//, '').split('/')[0]);
    }
  }
  const missing = [...dirs].filter((dir) => dir !== 'package.json' && !pkg.files.includes(dir));
  assert(missing.length === 0, `published files omit: ${missing.join(', ')}`);
  return `${dirs.size} entr(ies)`;
});

console.log('[consume-check] shipped artefacts');

const hostBundle = join(root, 'dist/index.js');
check('dist/index.js is an ES module', () => {
  assert(existsSync(hostBundle), 'dist/index.js is missing; run `pnpm run build`');
  const source = readFileSync(hostBundle, 'utf8');
  assert(/^#!|(^|\n)\s*(import|export)\s/m.test(source), 'dist/index.js has no import/export statements');
  return humans(statSync(hostBundle).size);
});

const clientBundle = join(root, 'dist/client.js');
check('dist/client.js is a __ModuleLoader__ bundle', () => {
  assert(existsSync(clientBundle), 'dist/client.js is missing; run `pnpm run build`');
  const source = readFileSync(clientBundle, 'utf8');
  assert(source.includes('__ModuleLoader__'), 'no __ModuleLoader__ call found');
  assert(/\.load\(\s*\{/.test(source), 'no .load({...}) call found');
  assert(source.length > 100_000, `suspiciously small (${source.length} bytes)`);
  return humans(source.length);
});

const workerBundle = join(root, 'dist/client/worker/layoutWorker.js');
check('dist/client/worker/layoutWorker.js is one self-contained classic worker', () => {
  assert(existsSync(workerBundle), 'the layout worker was never built; run `pnpm run build`');
  const files = readdirSync(dirname(workerBundle));
  assert(files.length === 1, `expected exactly one worker file, found: ${files.join(', ')}`);
  const source = readFileSync(workerBundle, 'utf8');
  // A classic worker cannot resolve a sibling chunk, and the route serves this exact path only.
  assert(!/(^|[;\s({,])import\s*\(/.test(source), 'the worker contains a dynamic import() and needs sibling chunks');
  assert(!/\bfrom\s*["']\.\.?\//.test(source), 'the worker imports a relative module instead of being bundled');
  assert(source.includes('onmessage'), 'the worker never registers an onmessage handler');
  assert(statSync(workerBundle).size > 500_000, 'the worker is too small to contain cytoscape');
  return humans(statSync(workerBundle).size);
});

check('no stale hashed chunks are left in dist/', () => {
  // tsdown names role chunks after their entry plus a content hash. Nothing used to delete them, so
  // 59 orphans from earlier builds were published alongside the current 7. This ratchet fails when
  // the count grows, which means a build stopped cleaning up after itself.
  const chunks = readdirSync(join(root, 'dist')).filter((name) => /-[A-Za-z0-9_]{8}\.js$/.test(name));
  const limit = 12;
  assert(chunks.length <= limit, `${chunks.length} hashed chunks in dist/ (ratchet: ${limit}); run \`pnpm run clean\``);
  return `${chunks.length}/${limit}`;
});

check('no intermediate build output is published', () => {
  // dist/client-cjs holds the unwrapped CJS bundle the wrap step consumes. It used to stay behind,
  // so the tarball carried a second copy of the client that nothing could import.
  const stale = ['dist/client-cjs'].filter((dir) => existsSync(join(root, dir)));
  assert(stale.length === 0, `intermediate output still present: ${stale.join(', ')}`);
  return 'dist/client-cjs absent';
});

check('published payload size', () => {
  let bytes = 0;
  for (const entry of pkg.files) {
    const full = resolve(root, entry);
    if (!existsSync(full)) {
      notes.push(`${entry} is listed in files[] but does not exist`);
      continue;
    }
    const stat = statSync(full);
    bytes += stat.isDirectory() ? walk(full).reduce((sum, f) => sum + statSync(f).size, 0) : stat.size;
  }
  return humans(bytes);
});

console.log('[consume-check] publint (opportunistic)');
try {
  const publintEntry = require.resolve('publint/package.json');
  const bin = join(dirname(publintEntry), 'lib', 'cli.js');
  const result = execFileSync(process.execPath, [existsSync(bin) ? bin : join(dirname(publintEntry), 'dist', 'cli.js'), 'dist'], {
    cwd: root,
    encoding: 'utf8',
  });
  console.log(result.trim() || '  ok    publint reported no problems');
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error) {
    failures.push(`publint: ${String(error.stdout || error.message).trim()}`);
    console.error(`  FAIL  publint — ${String(error.stdout || '').trim()}`);
  } else {
    notes.push('publint is not installed; run `pnpm dlx publint dist` for the registry lint');
    console.log('  skip  publint is not installed (it is not a devDependency)');
  }
}

for (const note of notes) console.log(`  note  ${note}`);

if (failures.length > 0) {
  console.error(`\n[consume-check] ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\n[consume-check] the published surface is consumable.');
