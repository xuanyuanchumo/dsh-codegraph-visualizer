/**
 * Round 6 removed the layout worker's "somebody else's asset route will serve my file" assumption.
 * Round 7 found the same class of defect twice more in the tree-sitter chain:
 *
 *  1. `src/adapters/TreeSitterAdapter.ts` resolved its grammars through browser-style candidates
 *     (`plugins/dsh-codegraph-visualizer/…`, `node_modules/web-tree-sitter/dist/…`, and
 *     `document.baseURI`). DSH serves no asset route for plugin files, so none of them could ever
 *     resolve; the adapter runs in the host process, where `tree-sitter-wasm` ships the grammars
 *     next to its own module.
 *  2. `scripts/build-client.mjs` copied 6 grammars (4.05 MB) into `dist/client` for a browser-side
 *     parser that does not exist — `src/client` imports neither the adapter nor `web-tree-sitter`.
 *     Types cannot see either half of that contract, so this test pins the source-level invariants
 *     and the build/hygiene ratchets that replaced them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Code only: these files *describe* the refuted candidate paths in their comments (which is where
 * the reasoning belongs), so `not.toContain` has to look past whole-line comments.
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');
}

describe('tree-sitter delivery contract', () => {
  const adapter = read('src/adapters/TreeSitterAdapter.ts');
  const buildClient = read('scripts/build-client.mjs');
  const consumeCheck = read('scripts/consume-check.mjs');

  it('resolves grammars only through tree-sitter-wasm, not through browser URL candidates', () => {
    const code = codeOnly(adapter);
    expect(code).toContain('getWasmPath');
    // Every one of these could only have worked if DSH served plugin files as assets.
    expect(code).not.toContain('document.baseURI');
    expect(code).not.toContain('plugins/dsh-codegraph-visualizer');
    expect(code).not.toContain('node_modules/web-tree-sitter');
  });

  it('keeps tree-sitter host-side, which is what makes a client-side WASM copy useless', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src', 'client'))
      .filter((file) => /TreeSitterAdapter|web-tree-sitter/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(process.cwd().length + 1));
    expect(offenders).toEqual([]);
  });

  it('does not copy WASM into the client bundle', () => {
    const code = codeOnly(buildClient);
    expect(code).not.toMatch(/\.wasm/);
    expect(code).not.toContain('copyFileSync');
    // The shipping artefacts the build must still produce.
    expect(code).toContain('dist/client/index.esm.js');
    expect(code).toContain('dist/client.js');
    expect(code).toContain('dist/client/worker/layoutWorker.js');
  });

  it('keeps the hygiene gate able to catch a WASM copy and an unread artefact', () => {
    // Deleting the gate would silently restore 4 MB of publish weight, so the gate is part of the
    // contract: one check for the artefact class, one for the general "has a reader" rule.
    expect(consumeCheck).toContain('no tree-sitter grammar is shipped with the client bundle');
    expect(consumeCheck).toContain('every published artefact is reachable from a declared reader');
  });
});
