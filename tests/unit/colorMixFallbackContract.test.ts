/**
 * color-mix() ⇄ fallback 对齐契约（cycle-150）。
 *
 * CLAUDE.md 纪律：「color-mix() CSS function needs rgba fallback in a separate file —
 * every usage must have a corresponding fallback entry in color-mix-fallback.css」。
 * 但截至本轮，仓库内 69 处 color-mix() 用法里新增面板（runtime/keyword-query/
 * path-pattern/diff/registry 等）的用法没有 fallback 条目，而 tokensContract 只约束
 * 「颜色字面量只能出现在 tokens.css 与 fallback 文件」，并未约束「每处用法都有条目」
 * ——纪律存在于文档，不存在于门禁。本文件把纪律变成守卫。
 *
 * 匹配语义：每处用法取「包含该声明规则的选择器列表 + 属性名」，要求 fallback 文件
 * 存在同选择器 + 同属性的 @supports not (color: color-mix(...)) 条目（fallback 值
 * 是手工换算的 rgba，不要求字面量一致）。反向自检：合成违例必须命中、豁免样例
 * （helper 函数名改名/删除）必须让守卫失效——防正则失效永绿（R10 教训第三次复发预防）。
 *
 * 逐 token 匹配选择器：解析 CSS 规则块（嵌套深度 ≤2），对每条 color-mix 声明记录
 * (selector, property)；fallback 文件同样解析出 (selector, property) 集合。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const STYLES_DIR = join(ROOT, 'src', 'client', 'styles');
const FALLBACK_FILE = join(STYLES_DIR, 'color-mix-fallback.css');
const MIX_RE = /color-mix\(/;

interface Decl { selector: string; property: string; file: string; line: number; }

/** 剥离注释但保留换行（行号不漂移——需求分析 §59.34 教训）。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 浅层规则解析：返回 { selector, body } 列表（不处理嵌套 @media 内层规则展开，fallback 文件顶层即 @supports）。 */
function parseRules(css: string): Array<{ header: string; body: string; bodyStart: number }> {
  const out: Array<{ header: string; body: string; bodyStart: number }> = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    // header：从上一个 '}' 或文件头到这个 '{'
    const prevClose = css.lastIndexOf('}', open);
    const header = css.slice(prevClose + 1, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    out.push({ header, body: css.slice(open + 1, j - 1), bodyStart: open });
    i = j;
  }
  return out;
}

/** 从规则体里提取 (property) 声明（值含 color-mix 的那条）。 */
function extractMixDeclarations(body: string): string[] {
  const props: string[] = [];
  for (const m of body.matchAll(/([a-z-]+)\s*:\s*([^;{}]*color-mix\([^;{}]*)[;{}]/g)) {
    props.push(m[1] ?? '');
  }
  return props;
}

function lineOf(css: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < css.length; i += 1) if (css[i] === '\n') line += 1;
  return line;
}

function collectUsages(): Decl[] {
  const files = readdirSync(STYLES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.css') && e.name !== 'color-mix-fallback.css')
    .map((e) => e.name);
  const out: Decl[] = [];
  for (const name of files) {
    const raw = readFileSync(join(STYLES_DIR, name), 'utf8');
    const css = stripComments(raw);
    for (const rule of parseRules(css)) {
      for (const prop of extractMixDeclarations(rule.body)) {
        // 声明在规则体内的偏移 → 全文偏移 → 行号
        const declIdx = rule.body.indexOf(prop + ':');
        out.push({
          selector: rule.header,
          property: prop,
          file: name,
          line: lineOf(raw, rule.bodyStart + 1 + declIdx),
        });
      }
    }
  }
  return out;
}

function collectFallbackEntries(): Map<string, number> {
  const raw = readFileSync(FALLBACK_FILE, 'utf8');
  const css = stripComments(raw);
  const map = new Map<string, number>();
  for (const rule of parseRules(css)) {
    // @supports 外壳内层是普通规则：parseRules 已把 @supports 体作为 body，
    // 需要再对 body 解析一层内层规则。
    const isSupportsShell = rule.header.startsWith('@supports');
    if (isSupportsShell) {
      for (const inner of parseRules(rule.body)) {
        for (const prop of extractMixDeclarations(inner.body)) {
          const key = `${normalizeSelector(inner.header)}::${prop}`;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        // 内层规则也可能不带 color-mix（纯 rgba 兜底），这些不算条目；
        // 但 fallback 的设计就是同选择器同属性——所以内层凡声明属性与主文件
        // 用法同名的都算覆盖。这里只登记含 color-mix 或 rgba 的声明属性。
        const rgbaProps = [...inner.body.matchAll(/([a-z-]+)\s*:\s*[^;{}]*rgba?\(/g)].map((m) => m[1] ?? '');
        for (const prop of rgbaProps) {
          const key = `${normalizeSelector(inner.header)}::${prop}`;
          if (!map.has(key)) map.set(key, 0);
        }
      }
    } else {
      for (const prop of extractMixDeclarations(rule.body)) {
        const key = `${normalizeSelector(rule.header)}::${prop}`;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
  }
  return map;
}

/** 选择器归一化：压缩空白。 */
function normalizeSelector(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const usages = collectUsages();
const fallback = collectFallbackEntries();

describe('color-mix fallback coverage contract (cycle-150)', () => {
  it('scan is not vacuous: every stylesheet usage and the fallback file are both parsed', () => {
    expect(usages.length).toBeGreaterThan(0);
    expect(fallback.size).toBeGreaterThan(0);
  });

  it('every color-mix() usage has a matching fallback entry (selector + property)', () => {
    const missing = usages.filter((u) => {
      const key = `${normalizeSelector(u.selector)}::${u.property}`;
      return !fallback.has(key);
    });
    if (missing.length > 0) {
      const detail = missing.slice(0, 20).map((m) => `${m.file}:${m.line} [${m.selector}] ${m.property}`).join('\n');
      console.log(`MISSING_FALLBACK(${missing.length}):\n${detail}`);
    }
    expect(missing, `${missing.length} color-mix() usages lack a fallback entry (first 20 logged)`).toHaveLength(0);
  });

  // 反向自检：守卫的关键解析步骤失效时必须变红，防「正则失效永绿」。
  it('reverse self-check: guard fails when the usage scanner is fed a synthetic violation', () => {
    // 合成一条不含 color-mix 的规则体 → extractMixDeclarations 必须返回空。
    expect(extractMixDeclarations('background: rgba(1, 2, 3, 0.5);')).toEqual([]);
    // 合成一条含 color-mix 的规则体 → 必须识别出属性。
    expect(extractMixDeclarations('background: color-mix(in srgb, red, blue);')).toEqual(['background']);
    // stripComments 必须保留换行数（行号锚定）。
    const withComment = 'a {\n/* multi\nline */\nbackground: color-mix(in srgb, red, blue);\n}';
    expect(stripComments(withComment).split('\n')).toHaveLength(withComment.split('\n').length);
    expect(parseRules(withComment)).toHaveLength(1);
  });
});
