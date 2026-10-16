/**
 * 独立性守卫 G-IND —— dsh-anic 源码不得 import 父工程 `src/`（只许借 node_modules）。
 *
 * 起因：`src/host/logger.ts:11` 与 `src/host/routes/selfCheckRoute.ts:105` 两条注释
 * 都声称该不变量"由 tests/contract 常驻守卫（G-IND 家族）约束"，但仓库里**没有
 * 任何断言真的检查它** —— 承诺存在、守卫缺席。本文件把承诺兑现，并让两条注释
 * 指向本文件的真实路径。
 *
 * 为什么只能靠源码形状：越界 import 在行为上与合法 import **完全等价**（同一个
 * 模块对象、同样的类型、同样的运行结果），任何行为测试都不可能因此变红；只有把
 * 每个 specifier 解析成落点、断言它不逃出 dsh-anic 根目录，这个缺陷才看得见。
 *
 * 守卫三条纪律（与 clientRenderContract.test.ts 同形）：
 *   ① 反向自检：每个负向断言先证明正例样例能被匹配（否则坏 regex 永远绿）；
 *   ② 不匹配自身：样例字面量一律拼接构造，文件里不存在连续的违规形状；
 *   ③ 扫描集非空：files.length 有下限断言，静默空扫描等同永久绿。
 *
 * 已知边界（诚实声明，勿读作全覆盖）：模板字面量里带 `${}` 的 import 说明符
 * 无法静态求值，本守卫不覆盖 —— 例如 `tests/contract/dshConformance.test.ts:106`
 * 的 `await import(\`file://${hostJs…}\`)` 落在该边界内，其路径由 PLUGIN_ROOT 拼出。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_FILE = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(SELF_FILE), '..', '..');
const PARENT_ROOT = resolve(PLUGIN_ROOT, '..');
const PARENT_SRC = join(PARENT_ROOT, 'src');

/** 父工程包名（用于拦截 bare specifier）；父工程不在时退化为空串，不误报。 */
function readParentPkgName(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PARENT_ROOT, 'package.json'), 'utf8')) as { name?: string };
    return typeof pkg.name === 'string' ? pkg.name : '';
  } catch {
    return '';
  }
}
const PARENT_PKG = readParentPkgName();

// ---------- 扫描集 ----------
const SCAN_DIRS = ['src', 'tests', 'scripts'];
const SCAN_EXT = /\.(?:ts|tsx|mts|cts|mjs|js)$/;

/**
 * 必须跳过的目录段（生成物 / 临时物，不是插件源码）。
 *
 * 起因（真实失败，非假想）：`skillToolNative.test.ts` / `skillReplaceE2E.test.ts` /
 * `native.test.ts` 会在 `tests/` 下**创建再删除**临时工作区
 * （`tests/unit/tmp-skill-tool-native/`、`tests/unit/tmp-skill-replace-e2e/`、
 * `tests/tmp-native/`），并把 skill 脚本复制进去。vitest 并发跑这些文件时，
 * 本守卫在**模块加载期**列目录、在**用例执行期**读文件，于是 walk 拿到
 * `…/tmp-skill-tool-native/ws-install/.dsh/skills/…/archive-cycle.mjs`，
 * 读的时候目录已被删 —— `ENOENT`，整条 G-IND 断言变红。
 *
 * 两种修法里必须选对：把 readFileSync 包进 try/catch 是**错**的，它会把
 * "文件消失了" 与 "没有违规" 混成同一个结果（正是本仓库反复出现的
 * "静默降级 = 永久绿"）。正确修法是让扫描集**确定性地**只包含源码：
 * 临时物根本不该进入扫描集，它既不是源码，也是唯一会凭空消失的东西。
 */
const EXCLUDE_SEGMENT = /^(?:node_modules|dist|\.git|\.dsh|\.cycles|tmp.*)$/i;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_SEGMENT.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}
const FILES = SCAN_DIRS.flatMap((d) => walk(join(PLUGIN_ROOT, d)));

/**
 * 去注释但**保留换行**：报错行号必须与磁盘一致，否则指向别处。
 * 块注释按字符原位清空（不删除），行注释只清内容保留 `\n`；字符串原样保留，
 * 因为 specifier 就在字符串里。本仓库第 4 次踩"扫描器被自身注释绊倒"，故复用同形。
 */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let inStr: string | null = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; } else { out += ' '; }
      i += 1; continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; out += '  '; i += 2; continue; }
      out += c === '\n' ? c : ' ';
      i += 1; continue;
    }
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === inStr) inStr = null;
      i += 1; continue;
    }
    if (c === '/' && n === '*') { inBlock = true; out += '  '; i += 2; continue; }
    if (c === '/' && n === '/') { inLine = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i += 1; continue; }
    out += c;
    i += 1;
  }
  return out;
}

// 三种形态各一条 regex；`[^;]*?` 让多行 import 子句可跨行、但绝不跨语句边界。
const FROM_RE = /\b(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/g;
const SIDE_EFFECT_RE = /\bimport\s*(['"])([^'"]+)\1/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

export interface Specifier { spec: string; index: number }

/** 提取 `import/export … from '…'`、`import '…'`、`import('…')`/`require('…')`。 */
export function extractSpecifiers(code: string): Specifier[] {
  const found = new Map<number, string>();
  for (const re of [FROM_RE, SIDE_EFFECT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const spec = m[2];
      if (typeof spec === 'string' && spec.length > 0) found.set(m.index, spec);
    }
  }
  return [...found.entries()].map(([index, spec]) => ({ spec, index })).sort((a, b) => a.index - b.index);
}

/**
 * 判定一个 specifier 是否违反 G-IND。返回 null = 合法。
 * - 路径型（相对 / 绝对 / file: URL）：解析成绝对落点，逃出 PLUGIN_ROOT 即违规；
 * - bare 型：含父工程包名即违规。
 */
export function offenseOf(file: string, spec: string): string | null {
  const looksPath = /^(?:\.\.?[\\/]|[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(spec) || spec.startsWith('file:');
  if (looksPath) {
    let abs: string;
    if (spec.startsWith('file:')) {
      try { abs = fileURLToPath(spec); } catch { return `unparsable file: URL ${spec}`; }
    } else {
      abs = resolve(dirname(file), spec);
    }
    const rel = relative(PLUGIN_ROOT, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      const intoParentSrc = relative(PARENT_SRC, abs);
      const kind = !intoParentSrc.startsWith('..') && !isAbsolute(intoParentSrc)
        ? '父工程 src/'
        : '插件根目录之外';
      return `${kind}：${spec} → ${abs}`;
    }
    return null;
  }
  if (PARENT_PKG && spec.includes(PARENT_PKG)) return `bare specifier 含父工程包名：${spec}`;
  return null;
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}

function rel(p: string): string {
  return relative(PLUGIN_ROOT, p).split('\\').join('/');
}

// ---------- 反向自检样例（一律拼接构造，文件内不存在连续违规形状） ----------
const SYNTHETIC_OFFENDER = ['im', 'port { x } fr', 'om ', "'", '../../../..', '/../src/shared/constants.ts', "';"].join('');
const SYNTHETIC_LEGIT = ['im', 'port { x } fr', 'om ', "'", '../../shared/tokens.ts', "';"].join('');
const SYNTHETIC_SIDE_EFFECT = ['im', 'port ', "'", './sibling.ts', "';"].join('');
const SYNTHETIC_DYNAMIC = ['await im', 'port(', "'", './lazy.ts', "');"].join('');

describe('G-IND 独立性守卫', () => {
  it('扫描集非空（静默空扫描 = 永久绿）', () => {
    expect(FILES.length).toBeGreaterThan(100);
    for (const d of SCAN_DIRS) expect(walk(join(PLUGIN_ROOT, d)).length).toBeGreaterThan(0);
    // 本守卫文件必须真的在扫描集里，否则"自扫"是句空话
    expect(FILES).toContain(SELF_FILE);
  });

  it('排除规则：临时/生成目录被跳过，真实源码不被跳过', () => {
    // 反向自检：先证明排除判定对"该排的"和"不该排的"给出相反结论，
    // 否则一个把一切都排掉的 regex 会让扫描集变空却仍然绿。
    for (const n of ['tmp-native', 'tmp-skill-tool-native', 'tmp-skill-replace-e2e', 'node_modules', 'dist', '.cycles', '.dsh', 'TMP-x']) {
      expect(EXCLUDE_SEGMENT.test(n), `${n} 应被排除`).toBe(true);
    }
    for (const n of ['src', 'tests', 'scripts', 'host', 'client', 'contract', 'unit', 'features']) {
      expect(EXCLUDE_SEGMENT.test(n), `${n} 不应被排除`).toBe(false);
    }
    // 非空性：排除后扫描集仍远大于下限（说明排除没有吃掉真实源码）
    expect(FILES.length).toBeGreaterThan(100);
    // 具体到本轮真实失败：那三个临时工作区下的文件不得出现在扫描集里
    const scratch = FILES.filter((f) => /[\\/]tmp[^\\/]*[\\/]/.test(f));
    expect(scratch, `扫描集混入临时物：\n${scratch.join('\n')}`).toEqual([]);
    // 但 tests/ 下的真实用例文件必须还在（证明排除不是"整个 tests 都被跳过"）
    expect(FILES.some((f) => f.endsWith(join('tests', 'unit', 'runtime.test.ts')))).toBe(true);
    expect(FILES.some((f) => f.endsWith(join('tests', 'contract', 'independenceGuard.test.ts')))).toBe(true);
  });

  it('stripComments 保留行号（去掉注释后行数不变）', () => {
    const sample = ['a();', '/* c1', 'c2 */', 'b(); // tail'].join('\n');
    const stripped = stripComments(sample);
    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped).toContain('a();');
    expect(stripped).toContain('b();');
    expect(stripped).not.toContain('c1');
  });

  it('反向自检：三种形态的提取 regex 都能匹配正例样例', () => {
    const fromSpecs = extractSpecifiers(SYNTHETIC_OFFENDER).map((s) => s.spec);
    expect(fromSpecs).toContain('../../../../../src/shared/constants.ts');
    expect(extractSpecifiers(SYNTHETIC_SIDE_EFFECT).map((s) => s.spec)).toContain('./sibling.ts');
    expect(extractSpecifiers(SYNTHETIC_DYNAMIC).map((s) => s.spec)).toContain('./lazy.ts');
    // 注释必须被剥掉，否则 header 里引用的路径会被当成违规
    expect(extractSpecifiers(stripComments(['// im', 'port ', "'", './ghost.ts', "';"].join('')))).toEqual([]);
  });

  it('反向自检：违规样例被抓、合法样例不误伤（否则守卫永远绿或永远红）', () => {
    const at = (p: string): string => join(PLUGIN_ROOT, ...p.split('/'));
    const offenderFile = at('src/client/features/x/a.ts');
    const orgFile = at('src/client/features/org/renderOrgStatus.ts');
    // 真违规：逃到父工程 src/（正是本轮 mutation 探针用的形状）
    // 从 src/client/features/x/ 出发需上溯 5 级才落到父工程根，少一级仍落在
    // dsh-anic/src/ 之内 —— 所以样例必须写够级数，否则自检会以"假违规"通过。
    expect(offenseOf(offenderFile, '../../../../../src/shared/constants.ts')).not.toBeNull();
    // 真违规：绝对路径直达父工程 src/
    expect(offenseOf(offenderFile, PARENT_SRC.replace(/\\/g, '/') + '/shared/constants.ts')).not.toBeNull();
    // 真违规：bare specifier 点名父工程
    if (PARENT_PKG) expect(offenseOf(offenderFile, PARENT_PKG + '/src/shared/constants.ts')).not.toBeNull();
    // 不误伤：插件内合法的向上 import（renderOrgStatus.ts:22 的真实形状）
    expect(offenseOf(orgFile, '../../../shared/tokens.ts')).toBeNull();
    expect(offenseOf(at('src/client/features/x/a.ts'), '../../shared/tokens.ts')).toBeNull();
    expect(offenseOf(at('tests/contract/a.test.ts'), '../../src/shared/tokens.ts')).toBeNull();
    expect(offenseOf(offenderFile, 'node:fs')).toBeNull();
    expect(offenseOf(offenderFile, 'vitest')).toBeNull();
  });

  it('src / tests / scripts 下没有任何 import 逃出 dsh-anic 根目录', () => {
    const offenders: string[] = [];
    let pathLike = 0;
    for (const f of FILES) {
      const code = stripComments(readFileSync(f, 'utf8'));
      for (const { spec, index } of extractSpecifiers(code)) {
        if (/^\.{1,2}[\\/]/.test(spec)) pathLike += 1;
        const bad = offenseOf(f, spec);
        if (bad) offenders.push(`${rel(f)}:${String(lineOf(code, index))} ${bad}`);
      }
    }
    // 非空扫描的第二种形式：提取器本身不能是空转的。若 regex 失效，"零违规"
    // 与"零匹配"长得一样，所以先要求真的提取到足量相对 specifier。
    expect(pathLike).toBeGreaterThan(50);
    expect(offenders, 'G-IND 违规（dsh-anic 是独立工程，只许借父工程 node_modules）：\n' + offenders.join('\n')).toEqual([]);
  });
});

describe('G-IND 承诺兑现：两条注释指向真实守卫文件', () => {
  it('守卫文件自身存在，且文件名与契约名一致', () => {
    expect(existsSync(SELF_FILE)).toBe(true);
    expect(basename(SELF_FILE)).toBe('independenceGuard.test.ts');
  });

  it('logger.ts / selfCheckRoute.ts 按真实文件名引用本守卫', () => {
    const needle = `tests/contract/${basename(SELF_FILE)}`;
    for (const r of ['src/host/logger.ts', 'src/host/routes/selfCheckRoute.ts']) {
      const text = readFileSync(join(PLUGIN_ROOT, r), 'utf8');
      expect(text, `${r} 未按真实文件名引用 G-IND 守卫（应为 ${needle}）`).toContain(needle);
    }
  });
});
