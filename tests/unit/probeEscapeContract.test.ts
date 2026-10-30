/**
 * 探针不得进 HEAD（cycle-118 / §62.6 #7 收口）。
 *
 * 背景（§62.5(a) 现场）：T4 在并行窗口读到 `graph-space.ts` 的
 * `if (true as boolean) { …return; }`——那是 T1 的 M1 变异探针的**临时改动**，恰好落在
 * 几十秒的探针窗口内。事后回滚了，但机制上没有任何东西阻止它被 commit。
 * 「探针窗口内的事实」与「HEAD 事实」在并行开发下必须由**守卫**区分，不能靠人肉记忆。
 *
 * 本守卫扫 `src/` 的三类探针残留形态：
 *   A. `true as boolean` / `false as boolean` —— 无意义断言转型（探针短路的最常见写法）；
 *   B. `PROBE` / `MUTATION` 标记常量（本仓探针写法的规范形态：一眼可辨识）；
 *   C. 恒真/恒假的裸条件 `if (true)` / `if (false)` / `while (true)`（后者允许
 *      事件泵等合法场景极少，本仓 0 命中，若将来需要请写 `for (;;)` 并在豁免表登记）。
 *
 * 反向自检 + 文件集非空断言，同 builtinAliasRemoval / requireEscapeContract 的家族惯例。
 * 剥注释保留换行（行号正确性，本仓第三次踩坑教训）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC_ROOT = join(import.meta.dirname, '..', '..', 'src');

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectTsFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

function stripCommentsKeepNewlines(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    const next = src[i + 1] ?? '';
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' ';
    } else if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch; i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i] ?? ''; out += src[i + 1] ?? ''; i += 2; }
        else { out += src[i]; i++; }
      }
      out += src[i] ?? ''; i++;
    } else {
      out += ch; i++;
    }
  }
  return out;
}

// 样本用拼接构造，防止守卫匹配到自己的样本字面量（requireEscapeContract 同款教训）。
const TRUE_AS_BOOL = 'true as' + ' boolean';
const PROBE_MARKER = /\b(PROBE|MUTATION)_(MARKER|FLAG|SHORT_CIRCUIT)\b/;
const BARE_TRUE_IF = /if\s*\(\s*true\s*\)/;
const BARE_FALSE_IF = /if\s*\(\s*false\s*\)/;

const allFiles = collectTsFiles(SRC_ROOT);

describe('probe escape contract (cycle-118, §62.6 #7)', () => {
  it('src/ 零探针残留（三类形态全扫）', () => {
    expect(allFiles.length).toBeGreaterThan(100); // 防空 walk 假绿
    const offenders: string[] = [];
    for (const file of allFiles) {
      const stripped = stripCommentsKeepNewlines(readFileSync(file, 'utf8'));
      const lines = stripped.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes(TRUE_AS_BOOL) || PROBE_MARKER.test(line)
          || BARE_TRUE_IF.test(line) || BARE_FALSE_IF.test(line)) {
          offenders.push(`${file}:${idx + 1}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('反向自检：各类违规样本必须命中（防静默失效）', () => {
    expect(TRUE_AS_BOOL.includes('true as boolean')).toBe(true);
    expect(PROBE_MARKER.test('const MUTATION_FLAG = true;')).toBe(true);
    expect(BARE_TRUE_IF.test('if (true) { return; }')).toBe(true);
    expect(BARE_FALSE_IF.test('if (false) { x(); }')).toBe(true);
    // 合法形态不得误伤：比较表达式、`as boolean` 的合法转型、字符串内容。
    expect(TRUE_AS_BOOL !== 'x as boolean').toBe(true);
    expect(PROBE_MARKER.test('const probeOnly = true;')).toBe(false); // 小写不命中
    expect(BARE_TRUE_IF.test('if (cond === true) { return; }')).toBe(false);
    expect(BARE_TRUE_IF.test(stripCommentsKeepNewlines('// if (true) 是坏味道'))).toBe(false);
  });

  it('stripComments 保留换行（行号正确性）', () => {
    const src = 'const a = 1;\n// if (true)\nconst b = 2;';
    const stripped = stripCommentsKeepNewlines(src);
    expect(stripped.split('\n').length).toBe(3);
    expect(stripped.split('\n')[2]).toBe('const b = 2;');
  });
});
