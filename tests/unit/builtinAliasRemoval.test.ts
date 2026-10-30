/**
 * 能力位形状守卫（cycle-118 / §62.6 #11 收口）。
 *
 * 背景：`builtin` 兼容别名（cycle-111 引入，原定 cycle-112 移除）在仓库里滞留了 6 个循环。
 * 「下一轮移除」类的承诺没有任何机制兜底，就会一直滚下去——这正是本文件存在的理由：
 * 把移除判据（`docs/agents/09` §9.4）里「**代码级出现点必须全部消失**」变成一条可执行的
 * 源码扫描断言。
 *
 * 三层断言（任何一层单独都不够）：
 *   1. **产出侧**：宿主 `/status` / `/health`、`prerequisite/status` 事件的 emit 载荷、
 *      `checkPrerequisites` / `normalizePrerequisiteStatus` / `emptyPrerequisiteStatus`
 *      的返回值里都**不得**再出现 `builtin` 键；
 *   2. **类型侧**：`PrerequisiteStatus` 与事件 payload 接口不得声明 `builtin` 字段；
 *   3. **读侧**：`src/` 里不得出现 `.builtin` / `builtin:` 的**代码级**引用
 *      （注释里讲历史是允许的——注释才是那一段教训的载体）。
 *
 * 反向自检（防守卫静默失效）：把样本违规文本喂给扫描器必须红；
 * 文件集非空断言防 walk 失败导致的全绿。
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

/** 剥注释但**保留换行**（否则行号整体上移，报错指向错误位置——本仓已三次踩坑）。 */
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

/** 代码级 `builtin` 引用：`.builtin` 成员访问 / `builtin:` 或 `builtin,` 键位。 */
const BUILTIN_CODE = /\.builtin\b|\bbuiltin\s*[:=,)]/;

/** 三个产出/类型文件——它们只要再出现 builtin 就等于别名复活。 */
const STRICT_FILES = [
  'shared/prerequisiteStatus.ts',
  'host/prerequisites.ts',
  'host/routes/statusRoutes.ts',
  'index.ts',
  'types/index.ts',
].map((rel) => join(SRC_ROOT, rel));

const allFiles = collectTsFiles(SRC_ROOT);

describe('builtin alias removal contract (cycle-118, §62.6 #11)', () => {
  it('产出与类型文件零 builtin 代码级引用', () => {
    expect(allFiles.length).toBeGreaterThan(100); // 防空 walk 假绿
    for (const file of STRICT_FILES) {
      const stripped = stripCommentsKeepNewlines(readFileSync(file, 'utf8'));
      expect(stripped, file).not.toMatch(BUILTIN_CODE);
    }
  });

  it('全 src 无 `.builtin` 成员访问（读侧清零）', () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      if (/\.(test|spec)\./.test(file)) continue;
      const stripped = stripCommentsKeepNewlines(readFileSync(file, 'utf8'));
      if (/\.builtin\b/.test(stripped)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('反向自检：扫描器对违规样本必须红（防静默失效）', () => {
    expect(BUILTIN_CODE.test('return { builtin: astSource };')).toBe(true);
    expect(BUILTIN_CODE.test('status.builtin')).toBe(true);
    expect(BUILTIN_CODE.test('builtin: status.builtin,')).toBe(true);
    // 合法形态不得误伤：无关词（builtIn 大小写不同、builtinLabel 词边界不成立）。
    expect(BUILTIN_CODE.test("t('toolbar.builtIn')")).toBe(false);
    expect(BUILTIN_CODE.test('const builtinLabel = 1;')).toBe(false);
    // 注释里的历史叙述经剥除后不得命中——扫描器只看剥注释后的代码。
    expect(BUILTIN_CODE.test(stripCommentsKeepNewlines('// builtin: astSource (历史)'))).toBe(false);
    expect(BUILTIN_CODE.test(stripCommentsKeepNewlines('/* builtin 曾是别名 */ const x = 1;'))).toBe(false);
  });
});
