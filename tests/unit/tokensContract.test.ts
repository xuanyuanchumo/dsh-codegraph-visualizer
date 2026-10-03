/**
 * Design tokens are this plugin's single colour vocabulary, but nothing in the type system
 * or the bundler connects the five places a token can be declared, referenced or shadowed:
 *
 *   1. `src/client/styles/tokens.css`                      — the source (`:root` + `body[data-ds-dark-theme]`)
 *   2. `src/client/styles/*.css`                           — `var(--cg-x)` references
 *   3. `src/**\/*.ts(x)`                                   — `'--cg-x'` strings and `readCssVar('--cg-x', literal)`
 *   4. `src/client/renderer/styles/styleUtils.ts`          — the `readCssVarCached` whitelist
 *   5. every other TS file                                 — colour literals outside `readCssVar`
 *
 * A rename on one side of any of those pairs fails *silently*: the declaration simply goes
 * dead, and the browser drops the rule (no `var()` fallback) or keeps using a stale literal
 * (a `readCssVar` fallback that drifted). The J0 audit that produced this file found all of
 * these live at once — six tokens referenced but never defined, a token defined twice in the
 * same block, four dead-code node tokens whose names did not match their CSS half, and two
 * tokens missing from the `readCssVarCached` whitelist so their theme values never applied.
 *
 * Same technique as `manifest.test.ts` (pins `package.json` against code) and
 * `responsiveContract.test.ts` (pins the JS breakpoints against the stylesheets).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const STYLES_DIR = join(ROOT, 'src', 'client', 'styles');

/** Files allowed to hold colour literals: the token source and the hand-written mirror of
 *  `color-mix()` for engines without it (`@supports not (color: color-mix(...))`). */
const COLOUR_SOURCE_FILES = new Set(['tokens.css', 'color-mix-fallback.css']);

const COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(ROOT, file).replace(/\\/g, '/');

/** The whole `{…}` block that follows `header`, nested blocks included. */
function blockBody(css: string, header: string): string {
  const start = css.indexOf(header);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return '';
}

const tokensCss = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf8');
const lightCss = tokensCss.slice(0, tokensCss.indexOf('body[data-ds-dark-theme]'));

/** The repo enables `noUncheckedIndexedAccess`, so capture groups come back as
 *  `string | undefined`. These two helpers are the single place that knows the patterns above
 *  require their groups, and hand the rest of the file plain strings. */
function firstGroups(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

function pairs(pattern: RegExp, text: string): [string, string][] {
  return [...text.matchAll(pattern)].map((match) => [match[1] ?? '', match[2] ?? '']);
}

function declarationList(block: string): string[] {
  return firstGroups(/(--cg-[a-z0-9-]+)\s*:\s*([^;]+);/g, block);
}

function declarationMap(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [token, value] of pairs(/(--cg-[a-z0-9-]+)\s*:\s*([^;]+);/g, block)) {
    if (token && !map.has(token)) map.set(token, value.trim());
  }
  return map;
}

const lightTokens = declarationMap(blockBody(lightCss, ':root'));
const darkTokens = declarationMap(blockBody(tokensCss, 'body[data-ds-dark-theme]'));
const allTokens = new Set([...lightTokens.keys(), ...darkTokens.keys()]);

/** Token names referenced from the stylesheets (`var(--cg-x)` and `var(--cg-x, …)`). */
function cssReferences(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of readdirSync(STYLES_DIR).filter((name) => name.endsWith('.css'))) {
    const css = readFileSync(join(STYLES_DIR, file), 'utf8');
    for (const token of firstGroups(/var\(\s*(--cg-[a-z0-9-]+)/g, css)) {
      if (!token) continue;
      const list = refs.get(token) ?? [];
      list.push(`src/client/styles/${file}`);
      refs.set(token, list);
    }
  }
  return refs;
}

/** Token names referenced from TypeScript as plain strings (`'--cg-x'`). */
function tsReferences(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of walk(join(ROOT, 'src')).filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(file, 'utf8');
    for (const token of firstGroups(/'(--cg-[a-z0-9-]+)'/g, source)) {
      if (!token) continue;
      const list = refs.get(token) ?? [];
      list.push(rel(file));
      refs.set(token, list);
    }
  }
  return refs;
}

const references = (() => {
  const merged = cssReferences();
  for (const [token, files] of tsReferences()) {
    merged.set(token, [...(merged.get(token) ?? []), ...files]);
  }
  return merged;
})();

/** Colour values arrive in three shapes: raw literals, `COLORS.X` constants and
 *  `var(--dsw-x, literal)` pass-throughs. Normalise all three to one comparable string. */
const colorConstants = (() => {
  const map = new Map<string, string>();
  const source = readFileSync(join(ROOT, 'src', 'shared', 'constants.ts'), 'utf8');
  for (const [name, value] of pairs(/([A-Z_0-9]+)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g, source)) {
    if (name && value) map.set(name, value);
  }
  return map;
})();

function normalise(value: string): string {
  let text = value.trim().replace(/^['"]|['"]$/g, '').replace(/^COLORS\./, '');
  if (colorConstants.has(text)) text = colorConstants.get(text) as string;
  text = text.replace(/\s+/g, '').toLowerCase();
  return text.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3');
}

/** `var(--dsw-x, LITERAL)` → `LITERAL` — the token file delegates to the host theme first. */
function unwrapVar(value: string | undefined): string {
  if (!value) return '';
  const match = value.match(/^var\([^,]+,\s*(.+)\)$/);
  return (match?.[1] ?? value).trim();
}

const READ_CALL_RE = /readCssVar(?:Cached)?\(\s*'(--cg-[a-z0-9-]+)'\s*,\s*([^;]+?)\)\s*[,;)]/g;

interface ReadCall {
  file: string;
  token: string;
  darkLiteral: string | null;
  lightLiteral: string;
}

function readCssVarCalls(): ReadCall[] {
  const calls: ReadCall[] = [];
  for (const file of walk(join(ROOT, 'src')).filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(file, 'utf8');
    for (const [token, rawExpression] of pairs(READ_CALL_RE, source)) {
      if (!token) continue;
      const expression = rawExpression.trim();
      const ternary = expression.match(/^isDark\s*\?\s*(.+?)\s*:\s*(.+)$/);
      calls.push({
        file: rel(file),
        token,
        darkLiteral: ternary ? (ternary[1] ?? '').trim() : null,
        lightLiteral: ternary ? (ternary[2] ?? '').trim() : expression,
      });
    }
  }
  return calls;
}

/** Character ranges of every `readCssVar*(…)` call, so literals *inside* one are not
 *  mistaken for a stray hard-coded colour. */
function readCssVarSpans(source: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const match of source.matchAll(/readCssVar(?:Cached)?\s*\(/g)) {
    let index = (match.index ?? 0) + match[0].length;
    let depth = 1;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === "'" || char === '"' || char === '`') {
        index += 1;
        while (index < source.length && source[index] !== char) {
          if (source[index] === '\\') index += 1;
          index += 1;
        }
      }
      index += 1;
    }
    spans.push([match.index ?? 0, index]);
  }
  return spans;
}

/**
 * TypeScript files allowed to hold colour literals outside a `readCssVar` call, with the
 * count they held when this contract was written. The counts are a ratchet: they may go
 * down but never up, and a new file is not allowed to join the list silently.
 */
const TS_LITERAL_ALLOWANCE: Record<string, { limit: number; why: string }> = {
  'src/host/cli.ts': {
    limit: 8,
    why: 'renders a standalone HTML report with an inline <style>; the page is not inside the plugin theme',
  },
  'src/shared/constants.ts': {
    limit: 10,
    why: 'COLORS — the one palette the TypeScript half may own (heatmap, roles, package node)',
  },
  'src/shared/layerUtils.ts': {
    limit: 32,
    why: 'LAYER_COLORS — per-layer border colours consumed by ThemeStylesheet, not yet token-backed (follow-up)',
  },
  'src/client/renderer/styles/ThemeStylesheet.ts': {
    limit: 48,
    why: 'CLUSTER_HUE_FALLBACKS — fallback table for the dynamically built --cg-cluster-hue-N-* reads',
  },
};

function rawColoursOutsideReadCssVar(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(join(ROOT, 'src')).filter((name) => /\.tsx?$/.test(name))) {
    const source = readFileSync(file, 'utf8');
    const spans = readCssVarSpans(source);
    let count = 0;
    for (const match of source.matchAll(COLOUR_RE)) {
      const index = match.index ?? 0;
      if (spans.some(([start, end]) => index >= start && index < end)) continue;
      count += 1;
    }
    if (count > 0) found.set(rel(file), count);
  }
  return found;
}

const cachedWhitelist = (() => {
  const source = readFileSync(join(ROOT, 'src', 'client', 'renderer', 'styles', 'styleUtils.ts'), 'utf8');
  const start = source.indexOf('const vars = [');
  const end = source.indexOf('];', start);
  const names = [...source.slice(start, end).matchAll(/'(--cg-[a-z0-9-]+)'/g)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === 'string');
  return new Set(names);
})();

describe('design token contract', () => {
  it('declares every token once per theme block and only overrides known tokens in the dark block', () => {
    const duplicatedInLight = declarationList(blockBody(lightCss, ':root')).filter(
      (token, index, list) => list.indexOf(token) !== index,
    );
    const duplicatedInDark = declarationList(blockBody(tokensCss, 'body[data-ds-dark-theme]')).filter(
      (token, index, list) => list.indexOf(token) !== index,
    );
    // A token declared twice in one block silently wins with the *last* value; that is how
    // `--cg-cycle-highlight` ended up carrying two different shades in the dark block.
    expect([...new Set(duplicatedInLight)]).toEqual([]);
    expect([...new Set(duplicatedInDark)]).toEqual([]);

    // A dark-only token is undefined in the light theme, which shows up as a dropped rule.
    const darkOnly = [...darkTokens.keys()].filter((token) => !lightTokens.has(token));
    expect(darkOnly).toEqual([]);
  });

  it('defines every token that the stylesheets and the TypeScript reference', () => {
    const undefinedTokens = [...references.keys()].filter((token) => !allTokens.has(token)).sort();
    // Without the guard the whole file passes silently when the walker breaks.
    expect(references.size).toBeGreaterThan(100);
    expect(undefinedTokens.map((token) => `${token} ← ${[...new Set(references.get(token))].slice(0, 2).join(', ')}`)).toEqual(
      [],
    );
  });

  it('keeps no token that nothing references', () => {
    // `--cg-cluster-hue-N-bg` / `-border` are read through a template literal, so a static
    // scan cannot see the reference; the family prefix is allowed explicitly.
    const dynamicFamilies = ['--cg-cluster-hue-'];
    const dead = [...allTokens]
      .filter((token) => !references.has(token))
      .filter((token) => !dynamicFamilies.some((prefix) => token.startsWith(prefix)))
      .sort();
    expect(dead).toEqual([]);
  });

  it('keeps raw colour literals inside the token source and the color-mix mirror', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(STYLES_DIR).filter((name) => name.endsWith('.css'))) {
      if (COLOUR_SOURCE_FILES.has(file)) continue;
      const css = readFileSync(join(STYLES_DIR, file), 'utf8');
      const matches = css.match(COLOUR_RE) ?? [];
      for (const literal of matches) offenders.push(`${file}: ${literal}`);
    }
    // The allowlist must stay exactly these two files: growing it is how the drift returns.
    expect([...COLOUR_SOURCE_FILES].sort()).toEqual(['color-mix-fallback.css', 'tokens.css']);
    expect(offenders).toEqual([]);
  });

  it('keeps a fallback literal out of every colour var() in the stylesheets', () => {
    // `var(--cg-text-muted)` with no fallback silently dropped whole declarations when the
    // token did not exist; a *colour* fallback is the opposite failure — it hides the typo,
    // freezes the light shade into the dark theme, and survives the rename.
    const offenders: string[] = [];
    for (const file of readdirSync(STYLES_DIR).filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(join(STYLES_DIR, file), 'utf8');
      for (const [token, rawFallback] of pairs(/var\(\s*(--cg-[a-z0-9-]+)\s*,([^)]*)\)/g, css)) {
        const fallback = rawFallback.trim();
        if (COLOUR_RE.test(fallback)) offenders.push(`${file}: var(${token}, ${fallback})`);
        COLOUR_RE.lastIndex = 0;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every readCssVar fallback literal in sync with tokens.css', () => {
    const calls = readCssVarCalls();
    const problems: string[] = [];
    for (const call of calls) {
      const token = call.token;
      if (!allTokens.has(token)) {
        problems.push(`${call.file}: ${token} is not defined in tokens.css`);
        continue;
      }
      const expectedLight = unwrapVar(lightTokens.get(token));
      if (normalise(call.lightLiteral) !== normalise(expectedLight)) {
        problems.push(`${call.file}: ${token} light literal ${call.lightLiteral} ≠ tokens.css ${expectedLight}`);
      }
      if (call.darkLiteral !== null) {
        const expectedDark = unwrapVar(darkTokens.get(token));
        if (normalise(call.darkLiteral) !== normalise(expectedDark)) {
          problems.push(`${call.file}: ${token} dark literal ${call.darkLiteral} ≠ tokens.css ${expectedDark}`);
        }
      }
    }
    // The fallback only matters when the var is missing, so a drift here is invisible until
    // something clobbers the stylesheet — which is exactly why it needs pinning.
    expect(calls.length).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });

  it('reads every cached token through a whitelist that contains it', () => {
    // `readCssVarCached` resolves from a pre-filled map and returns the fallback for any name
    // missing from it, so a token absent from the list *never* picks up its theme value.
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src')).filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(file, 'utf8');
      for (const [quoted, templated] of pairs(/readCssVarCached\(\s*(?:'([^']+)'|`([^`]+)`)/g, source)) {
        const token = quoted || templated;
        if (!token.startsWith('--cg-')) continue;
        if (token.includes('${')) {
          // Dynamic family: the concrete members must all be listed.
          const prefix = token.slice(0, token.indexOf('${'));
          if (![...cachedWhitelist].some((name) => name.startsWith(prefix))) {
            offenders.push(`${rel(file)}: no whitelist entry matches ${token}`);
          }
          continue;
        }
        if (!cachedWhitelist.has(token)) offenders.push(`${rel(file)}: ${token} missing from the readCssVarCached list`);
      }
    }
    expect(offenders).toEqual([]);
    const undefinedInWhitelist = [...cachedWhitelist].filter((token) => !allTokens.has(token));
    expect(undefinedInWhitelist).toEqual([]);
  });

  it('keeps the TypeScript literal-colour allowlist closed and ratcheted', () => {
    const found = rawColoursOutsideReadCssVar();
    const problems: string[] = [];
    for (const [file, count] of found) {
      const allowance = TS_LITERAL_ALLOWANCE[file];
      if (!allowance) {
        problems.push(`${file} holds ${count} colour literals outside readCssVar and is not on the allowlist`);
        continue;
      }
      if (count > allowance.limit) {
        problems.push(`${file} grew from ${allowance.limit} to ${count} colour literals (${allowance.why})`);
      }
    }
    for (const [file, allowance] of Object.entries(TS_LITERAL_ALLOWANCE)) {
      if (!found.has(file)) problems.push(`${file} no longer needs its allowance of ${allowance.limit} — remove the entry`);
    }
    expect(problems).toEqual([]);
  });
});
