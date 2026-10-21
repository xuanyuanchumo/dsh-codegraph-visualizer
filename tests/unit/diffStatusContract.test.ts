// 旅程覆盖：J19（FR-24 版本对比——diff 标记的样式/渲染双向契约）。
/**
 * diff 标记的**双向**源码契约（cycle-104，研究报告 §六 #13）。
 *
 * 这个功能有一条会静默失效的接缝：写入侧（`HighlightController.applyDiffMarkers`）加的是
 * cytoscape class，样式侧（`ThemeStylesheet`）按 class 名出规则。两侧用同一个字符串常量
 * 就安全，但只要有人把任意一侧写成裸字面量，改名后另一边就永远不会命中——
 * 元素照常渲染、没有任何错误、也没有任何行为断言会变红（本仓库已经因为同族缺陷死过
 * 24 条样式规则，见 `tests/unit/styleSelectorContract.test.ts` 的头部说明）。
 *
 * 因此本文件守四件事：
 *   1. 样式侧的 diff 选择器**由常量拼出**，且样式文件里不得出现 `diff-added` 之类的裸字面量；
 *   2. 渲染器只通过 `DIFF_STATUS_CLASS` 取类名，不得自己拼字符串；
 *   3. `DiffStatus` 的三个值与宿主 `DiffEngine` 写入的三个值一致（跨边界词汇表）；
 *   4. 清除路径覆盖全部三个 class（否则状态迁移后会残留）。
 *
 * 每条断言都带**反向自检**：把违规样本喂给扫描函数，必须真的报出来。没有反向自检的
 * 源码守卫一旦正则写坏就永久变绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIFF_STATUSES, DIFF_STATUS_CLASS, DIFF_STATUS_CLASSES,
} from '../../src/shared/diffStatus.ts';

const ROOT = join(__dirname, '..', '..');
const STYLE_DIR = join(ROOT, 'src', 'client', 'renderer', 'styles');
const HIGHLIGHT_FILE = join(ROOT, 'src', 'client', 'renderer', 'HighlightController.ts');
const DIFF_ENGINE_FILE = join(ROOT, 'src', 'merger', 'DiffEngine.ts');

/**
 * 裸 diff 类名：**字符串字面量内部**出现 `diff-added` / `diff-modified` / `diff-removed`。
 *
 * 违规的真实形态不是「独立的一个字符串 `'diff-added'`」，而是选择器里的
 * `'node.diff-added'` —— 类名嵌在选择器文本中间。因此扫描必须看字符串**内容**，
 * 而不是看整个字符串是否恰好等于类名。
 *
 * 唯一合法的写法是模板串里插值常量（`node.${DIFF_STATUS_CLASS.added}`），它的内容里
 * 含有 `${`，据此区分。
 */
const DIFF_CLASS_IN_TEXT = /diff-(?:added|modified|removed)/;

interface Offender { file: string; line: number; text: string }

/**
 * 剥离注释但**逐字符保留换行**。
 *
 * 不这么做的话，扫描器会命中它自己要守的注释——本仓库已经踩过三次
 * （`e2eSelectorContract.test.ts:25-28`、`a11yFormSemantics.test.ts:87-89`、
 * `visualBaselineContract.test.ts` 头部）。保留换行是必须的：删掉注释会让后面所有
 * 行号上移，报错指到错误的位置。
 *
 * 用状态机而不是正则替换：`'https://…'` 里的 `//` 不是注释，正则会把字符串截断。
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (ch === '\'') state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch; i += 1; continue;
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += ch; } else out += ' ';
      i += 1; continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += ch === '\n' ? '\n' : ' ';
      i += 1; continue;
    }
    // 字符串态：原样保留，遇到未转义的同类引号退出
    if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
    if ((state === 'single' && ch === '\'') || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) {
      state = 'code';
    }
    out += ch; i += 1;
  }
  return out;
}

/** 找出所有字符串字面量（含模板串），返回其内容与起始行号。 */
function stringLiterals(source: string): { content: string; line: number }[] {
  const out: { content: string; line: number }[] = [];
  let i = 0;
  let line = 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch !== '\'' && ch !== '"' && ch !== '`') { i += 1; continue; }
    const quote = ch;
    const startLine = line;
    let content = '';
    i += 1;
    while (i < source.length) {
      const c = source[i]!;
      if (c === '\\') { content += c + (source[i + 1] ?? ''); i += 2; continue; }
      if (c === quote) { i += 1; break; }
      if (c === '\n') line += 1;
      content += c;
      i += 1;
    }
    out.push({ content, line: startLine });
  }
  return out;
}

function scanBareLiterals(rawSource: string, file: string): Offender[] {
  const source = stripComments(rawSource);
  const found: Offender[] = [];
  for (const literal of stringLiterals(source)) {
    if (!DIFF_CLASS_IN_TEXT.test(literal.content)) continue;
    // 模板串里插值常量是合法写法（`node.${DIFF_STATUS_CLASS.added}`）
    if (literal.content.includes('${')) continue;
    found.push({ file, line: literal.line, text: literal.content.trim() });
  }
  return found;
}

function styleFiles(): string[] {
  return readdirSync(STYLE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
}

describe('diff 标记：样式侧必须由常量拼选择器', () => {
  it('has no bare diff class literal in any style file', () => {
    const offenders = styleFiles().flatMap((file) =>
      scanBareLiterals(readFileSync(join(STYLE_DIR, file), 'utf8'), file));

    expect(
      offenders,
      `样式文件里出现了裸 diff 类名字面量。类名必须由 src/shared/diffStatus.ts 的 `
      + `DIFF_STATUS_CLASS 拼出，否则改名后样式侧静默失效：\n`
      + offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join('\n'),
    ).toEqual([]);
  });

  it('the scanner really detects a violation (reverse self-check)', () => {
    // 样本用字符串拼接构造，避免扫描器命中本文件自己的字面量
    const cls = 'diff-' + 'added';
    const sample = `selector: 'node.${cls}',`;
    const hits = scanBareLiterals(sample, 'sample.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(1);
    // 行号必须准确：注释剥离若删掉了换行，这里会指到第 1 行之前
    const multiline = `// header\n// more\nconst s = 'edge.${cls}';`;
    expect(scanBareLiterals(multiline, 'sample.ts')[0]?.line).toBe(3);
  });

  it('the scanner does not fire on the constant-built form', () => {
    // 正向样本：用模板拼接的写法不得被判违规
    const sample = 'selector: `node.${DIFF_STATUS_CLASS.added}`,';
    expect(scanBareLiterals(sample, 'sample.ts')).toEqual([]);
  });

  it('the scanner ignores class names that only appear in comments', () => {
    // 注释里引用类名是正常的文档行为（本文件的说明、HighlightController 的注释都这么做）
    const cls = 'diff-' + 'modified';
    const sample = `/* 说明：${cls} 表示修改 */\nconst ok = 1;`;
    expect(scanBareLiterals(sample, 'sample.ts')).toEqual([]);
  });

  it('the scanned file set is non-empty', () => {
    // 没有这条，一次 walk 失败会让上面所有断言在空集上永久变绿。
    // 样式目录当前有 3 个 .ts（diagramStyles / styleUtils / ThemeStylesheet），
    // 断言只要求「非空且能列出已知的那一个」，不绑定具体数量（新增样式文件不该让它变红）。
    const files = styleFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('ThemeStylesheet.ts');
  });

  it('ThemeStylesheet actually consumes DIFF_STATUS_CLASS', () => {
    const source = readFileSync(join(STYLE_DIR, 'ThemeStylesheet.ts'), 'utf8');
    // 三个状态都必须真的被用来拼选择器，而不是只 import 了常量却写死类名
    for (const status of DIFF_STATUSES) {
      expect(
        source.includes(`DIFF_STATUS_CLASS.${status}`),
        `ThemeStylesheet.ts 必须用 DIFF_STATUS_CLASS.${status} 拼选择器`,
      ).toBe(true);
    }
  });
});

describe('diff 标记：渲染侧必须走共享常量', () => {
  it('HighlightController has no bare diff class literal', () => {
    const offenders = scanBareLiterals(readFileSync(HIGHLIGHT_FILE, 'utf8'), 'HighlightController.ts');
    expect(offenders).toEqual([]);
  });

  it('HighlightController imports the shared class constants', () => {
    const source = readFileSync(HIGHLIGHT_FILE, 'utf8');
    expect(source).toMatch(/from '\.\.\/\.\.\/shared\/diffStatus\.ts'/);
    expect(source).toContain('DIFF_STATUS_CLASS');
    // 清除路径必须用「全部类名」常量，否则状态迁移后残留
    expect(source).toContain('DIFF_STATUS_CLASSES');
  });

  it('clearDiffMarkers removes every class, not just one', () => {
    const source = readFileSync(HIGHLIGHT_FILE, 'utf8');
    const start = source.indexOf('clearDiffMarkers');
    expect(start).toBeGreaterThan(-1);
    // 取方法体（到下一个方法定义之前），断言它用的是全量常量
    const body = source.slice(start, start + 600);
    expect(body).toContain('DIFF_STATUS_CLASSES.join');
  });
});

describe('diff 词汇表：与宿主 DiffEngine 一致', () => {
  it('host DiffEngine writes exactly the three client-known statuses', () => {
    const source = readFileSync(DIFF_ENGINE_FILE, 'utf8');
    const written = new Set<string>();
    for (const match of source.matchAll(/diffStatus:\s*'([a-z]+)'/g)) {
      written.add(match[1] ?? '');
    }
    // 正向：宿主确实写了三个值（否则下面的集合比对会因为空集而假绿）
    expect(written.size).toBeGreaterThan(0);
    // 双向：宿主写的集合必须与客户端认识的集合完全相同
    expect([...written].sort()).toEqual([...DIFF_STATUSES].sort());
  });

  it('DIFF_STATUS_CLASSES has one entry per status', () => {
    expect(DIFF_STATUS_CLASSES).toHaveLength(DIFF_STATUSES.length);
  });
});
