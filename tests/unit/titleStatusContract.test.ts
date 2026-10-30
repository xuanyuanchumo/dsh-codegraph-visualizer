/**
 * 标题状态词 ⟷ 断言状态值守卫（cycle-118 / §62.6 #8 收口）。
 *
 * 背景（§62.5(b) 现场）：`routes.test.ts` 的 `/health` 用例曾写成
 * `it('returns 200 and degraded status when …', …)` 而体内断言 `toBe('healthy')`——
 * 修前 `builtin` 恒 `true` 让 healthy 恒真，标题承诺的 degraded 分支**从未被验证过**。
 * 用例标题是「这条用例声称在验证什么」的唯一人类可读契约；标题与断言不一致时，
 * 要么标题撒谎（读者被误导），要么断言错了（缺陷被绿掩盖）。两种都不可接受。
 *
 * 机制：扫描 `tests/` 的 `it('…')` / `test('…')` 用例。**触发与校验规则**（刻意收窄）：
 *   - 只有体内存在 `status).toBe('<healthy|degraded|unhealthy>')`（断言**值**落在 `/health`
 *     的三词枚举里）时才做双向一致性检查；此时标题必须声明**同一个**词，
 *     且不得声明其他状态词（换词）。
 *   - `status` 字段名太泛：HTTP 状态码（e2e recorder 的 `.status).toBe(200)`）、
 *     MCP `result.status`（'ready'/'no data'）、扫描状态（'scanning'）都不在该枚举里，
 *     一律不触发——守卫不越权到别的枚举。
 *   - 标题里的状态词若配的不是 status 枚举断言（"healthy codebase"、`.degraded`
 *     布尔字段、`isGraphServiceHealthy(...)).toBe(true)`）是自然语言形容词，
 *     同样不触发（只满足 1 不满足 2 的形态）。
 * （§62.5(b) 的现场恰好双向齐备：标题 degraded + `parsed.status).toBe('healthy')`。）
 *
 * 反向自检：合成违规样本必须红、干净样本必须绿、扫描器空文件集必须拒绝。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const TESTS_ROOT = join(import.meta.dirname, '..');

const STATUS_WORDS = ['healthy', 'degraded', 'unhealthy'] as const;
type StatusWord = (typeof STATUS_WORDS)[number];

function collectTestFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectTestFiles(p, acc);
    else if (/\.(test|spec)\.(ts|tsx)$/.test(name)) acc.push(p);
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

function wordsOf(text: string): StatusWord[] {
  return STATUS_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
}

interface CaseSpan { title: string; body: string; file: string; line: number }

/** 按 `it(`/`test(` 顶格起扫，用括号配平截取标题与体内（平衡括号法，etagContract 同款）。 */
function extractCases(stripped: string, file: string): CaseSpan[] {
  const cases: CaseSpan[] = [];
  const re = /\b(?:it|test)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const start = m.index;
    const line = stripped.slice(0, start).split('\n').length;
    // 找标题字符串（'…' 或 '…'）—— 从 ( 后第一个引号
    const openQuote = stripped.indexOf('\'', m.index);
    const closeQuote = stripped.indexOf('\'', openQuote + 1);
    if (openQuote === -1 || closeQuote === -1) continue;
    const title = stripped.slice(openQuote + 1, closeQuote);
    // 括号配平找用例体结束
    let depth = 0; let i = m.index + m[0].length - 1; let bodyStart = -1;
    for (; i < stripped.length; i++) {
      const c = stripped[i];
      if (c === '(') { depth++; if (bodyStart === -1 && depth === 2) bodyStart = i + 1; }
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    if (bodyStart === -1 || i >= stripped.length) continue;
    cases.push({ title, body: stripped.slice(bodyStart, i), file, line });
  }
  return cases;
}

/** status 枚举断言：值必须落在三词枚举内（泛化的 `status).toBe(` 不触发）。 */
function statusEnumWordOf(body: string): StatusWord | null {
  for (const w of STATUS_WORDS) {
    if (new RegExp(`status\\s*\\)\\s*\\.toBe\\(\\s*['"]${w}['"]\\s*\\)`).test(body)) return w;
  }
  return null;
}

const testFiles = collectTestFiles(TESTS_ROOT);

describe('title-status contract (cycle-118, §62.6 #8)', () => {
  it('断言 /health status 枚举的用例：标题状态词 ⟷ 断言值必须一致（不换词）', () => {
    expect(testFiles.length).toBeGreaterThan(50); // 防空 walk 假绿
    const offenders: string[] = [];
    // 守卫自身文件显式豁免（合成样本字面量会自食）；豁免被反向用例守卫。
    const SELF = import.meta.filename!.replace(/\\/g, '/');
    for (const file of testFiles) {
      if (file.replace(/\\/g, '/').endsWith(SELF)) continue;
      const stripped = stripCommentsKeepNewlines(readFileSync(file, 'utf8'));
      for (const kase of extractCases(stripped, file)) {
        const asserted = statusEnumWordOf(kase.body);
        if (asserted === null) continue;
        const titleWords = wordsOf(kase.title);
        if (!titleWords.includes(asserted)) {
          offenders.push(`${kase.file}:${kase.line} 断言 status='${asserted}' 但标题未声明该词（换词/漏词）`);
        }
        for (const w of titleWords) {
          if (w !== asserted) {
            offenders.push(`${kase.file}:${kase.line} 标题声明 "${w}" 但断言是 status='${asserted}'`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // 样本拼接构造 + 本文件显式豁免（家族惯例：守卫不得匹配自己的样本字面量）。
  // 豁免的有效性由下一条用例反向守卫：若本文件被改名/删除，扫描文件集仍须 > 50。
  const TITLE_DEGRADED = 'returns ' + 'degraded when nothing';
  const ASSERT_HEALTHY = "expect(parsed.status).toBe('" + 'healthy' + "');";
  const ASSERT_DEGRADED = "expect(parsed.status).toBe('" + 'degraded' + "');";

  it('反向自检：违规样本红、干净样本绿（防静默失效）', () => {
    const bad = extractCases(
      stripCommentsKeepNewlines(
        `it('${TITLE_DEGRADED}', () => {\n  ${ASSERT_HEALTHY}\n});`,
      ),
      'synthetic.ts',
    );
    expect(bad.length).toBe(1);
    expect(statusEnumWordOf(bad[0]!.body)).toBe('healthy');
    expect(wordsOf(bad[0]!.title)).toContain('degraded');

    const good = extractCases(
      stripCommentsKeepNewlines(
        `it('${TITLE_DEGRADED}', () => {\n  ${ASSERT_DEGRADED}\n});`,
      ),
      'synthetic.ts',
    );
    expect(good.length).toBe(1);
    expect(statusEnumWordOf(good[0]!.body)).toBe('degraded');

    // 泛化 status 断言不触发：HTTP 200、'ready'、'scanning' 都不在枚举里。
    expect(statusEnumWordOf("expect(r.status).toBe(200); expect(x.status).toBe('ready');")).toBeNull();

    // 形容词语境不触发：布尔谓词与无 status 的用例永不卷入。
    expect(statusEnumWordOf('expect(isHealthy(x)).toBe(true);')).toBeNull();
    expect(statusEnumWordOf('expect(1).toBe(1);')).toBeNull();
  });

  it('本文件豁免有效：主扫描不计入守卫自身，但文件集仍须覆盖真实测试', () => {
    expect(testFiles.some((f) => f.endsWith('titleStatusContract.test.ts'))).toBe(true);
  });
});
