import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const versionPath = join(root, 'VERSION');
const pkgPath = join(root, 'package.json');
const generatedDir = join(root, 'src', 'generated');
const versionTsPath = join(generatedDir, 'version.ts');

const version = readFileSync(versionPath, 'utf8').trim();

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[sync-version] package.json version updated: ${version}`);
} else {
  console.log(`[sync-version] package.json version already ${version}`);
}

mkdirSync(generatedDir, { recursive: true });
const versionTsContent = `export const PLUGIN_VERSION = '${version}';\n`;
const existing = (() => { try { return readFileSync(versionTsPath, 'utf8'); } catch { return ''; } })();
if (existing !== versionTsContent) {
  writeFileSync(versionTsPath, versionTsContent);
  console.log(`[sync-version] src/generated/version.ts updated: ${version}`);
} else {
  console.log(`[sync-version] src/generated/version.ts already ${version}`);
}
