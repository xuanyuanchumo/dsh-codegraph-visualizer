/**
 * Form controls in the client are rendered from a dozen independent components, and nothing in
 * the type system connects "this `<select>` exists" to "this control has a stable identity and an
 * accessible name". `docs/需求分析.md` §50.3 (TODO-01) recorded seven controls without `id`/`name`;
 * the gap kept reappearing because each new panel was written from scratch.
 *
 * This suite is the ratchet: it walks every `.tsx` under `src/client`, extracts each opening
 * `<input>` / `<select>` / `<textarea>` tag with a brace- and quote-aware scanner (a plain
 * `/<input[^>]*>/` regex is wrong here — attributes contain arrow functions and ternaries), and
 * asserts that
 *   1. every control declares both `id` and `name`,
 *   2. every control has a real accessible-name source: `aria-label`, `aria-labelledby`, an
 *      `htmlFor` reference from a `<label>`, or an enclosing `<label>` wrapper,
 *   3. string-literal ids are unique across the whole client (duplicate ids silently break
 *      `label[for]`, `aria-labelledby` and autofill),
 *   4. the scanner actually found the controls (a regex that stops matching would otherwise make
 *      every assertion above vacuously true).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const CLIENT_DIR = join(process.cwd(), 'src', 'client');

interface ControlTag {
  file: string;
  line: number;
  tag: string;
}

/** Opening JSX tags for the given element names, bounded by `>` at brace depth 0 outside strings. */
function collectControlTags(source: string, file: string, names: string[]): ControlTag[] {
  const found: ControlTag[] = [];
  const opener = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g');
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let index = match.index + match[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; index < source.length; index += 1) {
      const char = source[index]!;
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (char === '>' && depth === 0) break;
    }
    found.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      tag: source.slice(match.index, index + 1),
    });
    opener.lastIndex = index + 1;
  }
  return found;
}

/** Character ranges of every `<label …>…</label>` block, nested labels included. */
function labelRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /<label(?=[\s>])|<\/label>/g;
  const stack: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match[0] === '</label>') {
      const start = stack.pop();
      if (start !== undefined) ranges.push([start, match.index + match[0].length]);
      continue;
    }
    stack.push(match.index);
  }
  return ranges;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function hasAttribute(tag: string, attribute: string): boolean {
  return new RegExp(`(?:^|\\s)${attribute}=`).test(tag);
}

function stringLiteralId(tag: string): string | null {
  const match = /(?:^|\s)id="([^"]*)"/.exec(tag);
  return match ? match[1]! : null;
}

const tsxFiles = readdirSync(CLIENT_DIR, { recursive: true })
  .map((entry) => String(entry))
  .filter((entry) => entry.endsWith('.tsx'))
  .map((entry) => join(CLIENT_DIR, entry));

const sources = new Map<string, string>();
for (const file of tsxFiles) sources.set(file, stripComments(readFileSync(file, 'utf8')));

const controls: ControlTag[] = [];
for (const [file, source] of sources) {
  controls.push(...collectControlTags(source, file, ['input', 'select', 'textarea']));
}

function displayPath(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

describe('client form semantics contract', () => {
  it('finds the client form controls (guards against a scanner that stopped matching)', () => {
    expect(tsxFiles.length).toBeGreaterThan(20);
    // Source-level count: FilterPanel renders its five node and six edge checkboxes from a map, so
    // the file holds 6 control tags while the DOM renders 15.
    expect(controls.length).toBeGreaterThanOrEqual(15);
    const perFile = new Map<string, number>();
    for (const control of controls) {
      const key = displayPath(control.file);
      perFile.set(key, (perFile.get(key) ?? 0) + 1);
    }
    expect(perFile.get('src/client/components/FilterPanel.tsx')).toBeGreaterThanOrEqual(6);
    expect(perFile.get('src/client/components/DeadCodePanel.tsx')).toBeGreaterThanOrEqual(2);
    expect(perFile.get('src/client/components/SearchBar.tsx')).toBeGreaterThanOrEqual(1);
  });

  it('gives every control an id and a name', () => {
    const missing = controls
      .filter((control) => !hasAttribute(control.tag, 'id') || !hasAttribute(control.tag, 'name'))
      .map((control) => `${displayPath(control.file)}:${control.line}`);
    expect(missing).toEqual([]);
  });

  it('gives every control an accessible-name source', () => {
    const unnamed: string[] = [];
    for (const control of controls) {
      const source = sources.get(control.file)!;
      if (hasAttribute(control.tag, 'aria-label') || hasAttribute(control.tag, 'aria-labelledby')) continue;
      const literalId = stringLiteralId(control.tag);
      if (literalId && new RegExp(`htmlFor="${literalId}"`).test(source)) continue;
      const index = source.indexOf(control.tag);
      const wrapped = labelRanges(source).some(([start, end]) => index > start && index < end);
      if (!wrapped) unnamed.push(`${displayPath(control.file)}:${control.line}`);
    }
    expect(unnamed).toEqual([]);
  });

  it('uses select/textarea with an explicit aria-label because a wrapper label is not enough', () => {
    // A `<label>` wrapper around a `<select>` does associate, but both of our selects sit in a
    // flex row with no text of their own, so the explicit label is the contract we hold.
    const offenders = controls
      .filter((control) => /^<(select|textarea)/.test(control.tag))
      .filter((control) => !hasAttribute(control.tag, 'aria-label') && !hasAttribute(control.tag, 'aria-labelledby'))
      .map((control) => `${displayPath(control.file)}:${control.line}`);
    expect(offenders).toEqual([]);
  });

  it('keeps string-literal ids unique across the client', () => {
    const seen = new Map<string, string[]>();
    for (const control of controls) {
      const id = stringLiteralId(control.tag);
      if (!id) continue;
      const where = `${displayPath(control.file)}:${control.line}`;
      const bucket = seen.get(id);
      if (bucket) bucket.push(where);
      else seen.set(id, [where]);
    }
    const duplicates = [...seen.entries()]
      .filter(([, places]) => places.length > 1)
      .map(([id, places]) => `${id} → ${places.join(', ')}`);
    expect(duplicates).toEqual([]);
  });

  it('namespaces the dynamic filter checkbox ids by node/edge type', () => {
    const filterPanel = sources.get(join(CLIENT_DIR, 'components', 'FilterPanel.tsx'))!;
    expect(filterPanel).toContain('id={`cg-filter-node-${type}`}');
    expect(filterPanel).toContain('id={`cg-filter-edge-${type}`}');
    expect(filterPanel).toContain('name={`cg-filter-node-${type}`}');
    expect(filterPanel).toContain('name={`cg-filter-edge-${type}`}');
  });
});
