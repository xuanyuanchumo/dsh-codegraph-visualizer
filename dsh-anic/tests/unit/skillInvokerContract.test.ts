/**
 * 技能解析唯一实现契约守卫（CLAUDE.md「同一语义两条数据路径必须共享一个实现」防漂移线）。
 *
 * 背景：resolveSkillScriptsDir 曾在 skillInvoker.ts 与 routes/selfInitRoute.ts 各有一份，
 * 候选列表（ANIC_SKILL_DIR / cwd）与哨兵（裸目录 vs init-workflow.mjs）已经分叉——
 * 安装路径与调用路径可能解析到不同的技能目录且无任何测试变红。
 *
 * 本守卫断言（源形状级，行为测试无法看见"多出一份实现"）：
 * 1. `function resolveSkillScriptsDir` 的**定义**全 src/ 恰好 1 处，且在 skillInvoker.ts；
 * 2. 所有 import 该符号的模块都从 skillInvoker.ts 导入（不许路由层再自造）;
 * 3. 反向自检：正则先对已知正样本命中、对负样本不命中——防止 regex 失效后守卫永久绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(import.meta.dirname, '..', '..', 'src');

/** 递归收集 src/ 下全部 .ts 文件（测试自己不扫描自身目录，无自匹配问题）。 */
function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 匹配「函数定义」形态：export function X / function X（不含调用点与 import）。 */
const DEF_REGEX = /(export\s+)?function\s+resolveSkillScriptsDir\s*\(/;

/** 匹配「从 skillInvoker 导入」形态（相对路径深度不限）。 */
const IMPORT_FROM_INVOKER_REGEX =
  /import\s+\{[^}]*resolveSkillScriptsDir[^}]*\}\s+from\s+'[^']*skillInvoker\.ts'/;

/** 匹配「从任意模块导入」形态（用于断言没有第三方来源）。g 标志：matchAll 必需。 */
const IMPORT_ANY_REGEX =
  /import\s+\{[^}]*resolveSkillScriptsDir[^}]*\}\s+from\s+'([^']+)'/g;

const INVOKER_FILE = 'skillInvoker.ts';

describe('resolveSkillScriptsDir 唯一实现契约（防漂移守卫）', () => {
  const files = walkTsFiles(SRC_ROOT);

  it('扫描集非空（目录走空会让守卫永久绿）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('定义恰好 1 处且在 skillInvoker.ts', () => {
    const defs = files.filter((f) => DEF_REGEX.test(readFileSync(f, 'utf-8')));
    expect(defs).toHaveLength(1);
    expect(relative(SRC_ROOT, defs[0]!).replace(/\\/g, '/')).toBe(
      `host/${INVOKER_FILE}`,
    );
  });

  it('所有 import 均来自 skillInvoker.ts（不许路由层自造第二实现）', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(IMPORT_ANY_REGEX)) {
        if (!m[1]!.endsWith('skillInvoker.ts')) offenders.push(`${f} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('skillInvoker.ts 存在至少一个真实 import 使用方（实现未被孤立）', () => {
    const importers = files.filter(
      (f) =>
        !f.endsWith(INVOKER_FILE) &&
        !f.endsWith('skillInvoker') &&
        IMPORT_FROM_INVOKER_REGEX.test(readFileSync(f, 'utf-8')),
    );
    expect(importers.length).toBeGreaterThanOrEqual(3);
  });

  it('反向自检：regex 对负样本不命中（regex 失效必须在此暴露）', () => {
    // 负样本 1：调用点不是定义
    expect(DEF_REGEX.test('const d = resolveSkillScriptsDir(ws);')).toBe(false);
    // 负样本 2：import 其他符号不误报
    expect(DEF_REGEX.test("import { spawnSync } from 'node:child_process';")).toBe(false);
    // 正样本：定义形态必须命中（连体防绕过：export 中缀可省略）
    expect(DEF_REGEX.test('export function resolveSkillScriptsDir(ws: string)')).toBe(true);
    expect(DEF_REGEX.test('function resolveSkillScriptsDir(root)')).toBe(true);
    // import 正/负样本
    expect(
      IMPORT_ANY_REGEX.test("import { resolveSkillScriptsDir } from '../skillInvoker.ts';"),
    ).toBe(true);
    expect(
      IMPORT_ANY_REGEX.test("import { spawnSync } from 'node:child_process';"),
    ).toBe(false);
  });
});
