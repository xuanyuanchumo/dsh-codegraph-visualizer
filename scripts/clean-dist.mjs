/**
 * Remove build outputs before a build.
 *
 * `tsdown` writes role-named chunks next to its entry (`CodeGraphAdapter-<hash>.js` and friends)
 * and never removes the previous build's names. Without this step every build left another set of
 * orphaned chunks in `dist/` — 59 files and ~0.86 MB of dead weight that `files: ["dist"]` would
 * have published, because only the newest hash is referenced by `dist/index.js`.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const pkgPath = join(root, 'package.json');

if (!existsSync(pkgPath)) {
  console.error(`[clean-dist] refusing to run: no package.json in ${root}`);
  process.exit(1);
}

const { name } = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (name !== 'dsh-codegraph-visualizer') {
  console.error(`[clean-dist] refusing to run: ${root} is package "${name}", not dsh-codegraph-visualizer`);
  process.exit(1);
}

for (const dir of ['dist', 'dist-host']) {
  const target = resolve(root, dir);
  if (!target.startsWith(resolve(root))) {
    console.error(`[clean-dist] refusing to remove ${target}: outside ${root}`);
    process.exit(1);
  }
  if (!existsSync(target)) continue;
  const before = countFiles(target);
  rmSync(target, { recursive: true, force: true });
  console.log(`[clean-dist] removed ${dir}/ (${before} files)`);
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(join(dir, entry.name)) : statSync(join(dir, entry.name)).isFile() ? 1 : 0;
  }
  return total;
}
