import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Contract guards for Round 10's two fixes:
 *
 * 1. `POST /api/v1/codegraph/tree-sitter` rejected valid forward-slash relative paths on Windows
 *    while the sibling `/ast` route accepted them, because the old check compared `path.normalize()`
 *    output against the raw input (`normalize` rewrites `/` to `\` on win32). Both routes now share
 *    `isSafeRelativePath` from src/host/routes/shared.ts.
 * 2. Selecting a search result or a symbol only changed the detail panel. A node hidden by `hideNode`
 *    (or by an active filter) meant "click and nothing happens". `revealNode` un-hides and centres,
 *    and `revealNode` is now the single reveal path for both entry points.
 *
 * Behavioural coverage lives in routes.test.ts, CytoscapeRenderer.test.ts,
 * hooks/useSearchInteraction.test.ts and hooks/useSymbolSelectListener.test.ts; this file pins the
 * plumbing so a later refactor cannot silently unwire it again.
 */

const ROOT = path.resolve(__dirname, '../..');

/** Strip whole-line comments so prose that explains a removed workaround cannot satisfy a check. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');
}

function readSource(relative: string): string {
  return codeOnly(fs.readFileSync(path.join(ROOT, relative), 'utf-8'));
}

describe('host relative-path parity contract', () => {
  it('shares one shape guard between the tree-sitter and ast routes', () => {
    const shared = readSource('src/host/routes/shared.ts');
    expect(shared).toContain('export function isSafeRelativePath(');

    const analysis = readSource('src/host/routes/analysisRoutes.ts');
    expect(analysis).toContain('isSafeRelativePath(filePath, VALIDATION.MAX_FILEPATH_LENGTH)');
    // The win32-broken comparison must not come back: it rejected `src/App.tsx`.
    expect(analysis).not.toContain('normalizedPath !== filePath');
  });
});

describe('selection reveal contract', () => {
  it('declares revealNode on the renderer interface', () => {
    const irenderer = readSource('src/client/renderer/IRenderer.ts');
    expect(irenderer).toContain('revealNode(nodeId: string): boolean;');
    const renderer = readSource('src/client/renderer/CytoscapeRenderer.ts');
    expect(renderer).toContain('revealNode(nodeId: string): boolean {');
  });

  it('routes search-result selection through revealNode, wired from the panel', () => {
    const search = readSource('src/client/hooks/useSearchInteraction.ts');
    expect(search).toContain('revealNode: (id: string) => boolean;');
    expect(search).toContain('getDataRef.current?.revealNode(id)');

    const panel = readSource('src/client/GraphPanel.tsx');
    expect(panel).toContain('revealNode: (id: string) => renderer.rendererRef.current?.revealNode(id) ?? false,');
  });

  it('routes symbol selection through revealNode instead of a blind focus', () => {
    const hook = readSource('src/client/hooks/useSymbolSelectListener.ts');
    expect(hook).toContain('.revealNode(match.id)');
    // A plain focus would pan to an element that is still `display: none`.
    expect(hook).not.toContain('focusOnNode');
  });
});
