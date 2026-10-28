// 多代适配器的两条结构性守卫（cycle-110 / P1-3）。
//
// ## A. 存在性探测必须显式传 `strict = false`
//
// `ctx.get(name)` 的默认 `strict = true` 含义是「**提供者 fiber 当前活跃**」，不是「服务存在」
// （cordis `lib/index.js:763-772`、`lib/types/reflect.d.ts:16`；知识库
// `site/reference/cordis-api/context.md:242-260` 逐字同义）。在同步的一次性 `apply()` 里用默认
// 值探测，会把「已 apply 但 fiber 还在 loading」的提供者全部判成 false —— 本项目 cycle-83 的
// 5 条 slash command 全部未注册就是这么来的。
//
// 这条纪律**只能靠源码形状守**：传 `false` 与不传的运行时差别取决于时序，单测里造不出那个
// 时序（造出来也只是重演一次特定快照）。所以这里扫源码，并要求每个 `ctx.get(` 都带 `, false`。
//
// ## B. 「快照不决定永远」必须是**纯函数 + 可重算**
//
// `resolveFeatureFlags` 是能力快照的唯一构造点。它必须是纯的、只做加法的、且**不做记忆化** ——
// 调用方随时可以拿最新的探针再算一次。一旦它内部缓存或允许探针关能力，「某一瞬间的宿主状态」
// 就变成了永久判决（`if (!flags.commandUi) return;` 那类缺陷的上游成因）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveFeatureFlags,
  createFeatureFlags,
  FEATURE_FLAGS_BY_GENERATION,
} from '../../../src/host/compat/FeatureFlags.ts';
import { unknownDshVersion, parseDshVersion } from '../../../src/shared/dshGeneration.ts';
import type { HostVersionInfo } from '../../../src/host/compat/HostVersionDetector.ts';
import type { CapabilityProbe, FeatureFlags } from '../../../src/host/compat/FeatureFlags.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * 逐字符抹掉注释、**保留换行**。
 *
 * 保留换行是硬要求：用例按行号报告违规，删掉换行会让每条报告都指向错误位置
 * （本仓已因这一条踩过三次，见 CLAUDE.md 的 scanner 教训）。
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (ch === '/' && next === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (ch === "'") { mode = 'single'; out += ch; i += 1; continue; }
      if (ch === '"') { mode = 'double'; out += ch; i += 1; continue; }
      if (ch === '`') { mode = 'template'; out += ch; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (mode === 'block') {
      if (ch === '*' && next === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += ch === '\n' ? '\n' : ' ';
      i += 1; continue;
    }
    // 字符串内部：注释符号无意义，但要处理转义与闭合。
    if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
    if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"') || (mode === 'template' && ch === '`')) {
      mode = 'code'; out += ch; i += 1; continue;
    }
    out += ch; i += 1;
  }
  return out;
}

/** 递归收集 `src/` 下的 `.ts` / `.tsx` 文件（跳过测试与声明文件）。 */
function collectSources(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { collectSources(full, acc); continue; }
    if (!/\.tsx?$/.test(entry) || entry.endsWith('.d.ts') || entry.endsWith('.test.ts')) continue;
    acc.push(full);
  }
  return acc;
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

/**
 * 在**已剥离注释**的源码里找 `ctx.get(` 调用，返回未带 `, false` 的违规行。
 *
 * 抽成函数是为了让反向自检能喂合成样本：一个永远返回空数组的扫描器是本仓最危险的假绿形态
 * （"删掉断言"、"正则写错"都表现为"零违规"）。
 */
export function findUnguardedServiceProbes(source: string, file = 'synthetic.ts'): Violation[] {
  const code = stripComments(source);
  const violations: Violation[] = [];
  const lines = code.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    let from = 0;
    for (;;) {
      const at = line.indexOf('ctx.get(', from);
      if (at === -1) break;
      from = at + 'ctx.get('.length;
      // 取到该调用的右括号（本仓所有 `ctx.get(...)` 都是单行；跨行写法在此显式失败，
      // 而不是静默跳过 —— 否则一个换行就能绕过守卫）。
      const close = line.indexOf(')', from);
      const args = close === -1 ? line.slice(from) : line.slice(from, close);
      if (!/,\s*false\s*$/.test(args)) {
        violations.push({ file, line: index + 1, text: line.trim() });
      }
    }
  }
  return violations;
}

describe('A. 服务存在性探测必须 ctx.get(key, false)', () => {
  it('扫描器反向自检：合成样本必须被识别，合规范本必须被放行', () => {
    // 正向样本用字符串拼接构造，避免扫描器扫到自己（本仓已踩过：guard 匹配到自己的样本）。
    const ctxExpr = 'ctx' + '.get(';
    const bad = findUnguardedServiceProbes(`${ctxExpr}'sidebarRightTabs')`, 'bad.ts');
    const bad2 = findUnguardedServiceProbes(`${ctxExpr}key, true)`, 'bad2.ts');
    const good = findUnguardedServiceProbes(`${ctxExpr}'sidebarRightTabs', false)`, 'good.ts');
    const goodWithSpaces = findUnguardedServiceProbes(`${ctxExpr} key,  false )`, 'good2.ts');

    expect(bad).toHaveLength(1);
    expect(bad2, 'strict = true is the defect, not the fix').toHaveLength(1);
    expect(good).toHaveLength(0);
    expect(goodWithSpaces).toHaveLength(0);
  });

  it('注释里的 ctx.get 不算违规（注释引用了错误写法用于说明）', () => {
    const sample = [
      '// 历史缺陷：',
      `// const x = ${'ctx' + '.get('}'commandUi');`,
      'const y = 1;',
    ].join('\n');
    expect(findUnguardedServiceProbes(sample)).toHaveLength(0);
  });

  it('src/ 下每个 ctx.get( 都显式传了 false', () => {
    const files = collectSources(join(ROOT, 'src'));
    // 反空扫：目录遍历失败会让本用例永久变绿。
    expect(files.length, 'source walk found suspiciously few files').toBeGreaterThan(50);

    const violations: Violation[] = [];
    let occurrences = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      occurrences += stripComments(source).split('ctx.get(').length - 1;
      violations.push(...findUnguardedServiceProbes(source, file.slice(ROOT.length + 1)));
    }
    // 至少存在若干真实探测点，否则「零违规」毫无意义。
    expect(occurrences, 'no ctx.get call site found at all').toBeGreaterThanOrEqual(3);
    expect(
      violations,
      `every ctx.get() must pass strict=false:\n${violations.map((v) => `${v.file}:${v.line} ${v.text}`).join('\n')}`,
    ).toEqual([]);
  });

  it('至少有一处走响应式 ctx.inject（提供者后 apply 的那一半由它兜住）', () => {
    // 源码级 `ctx.get(key, false)` 只能解决「提供者已 apply、fiber 未 active」。
    // 「提供者**后** apply」只能靠 ctx.inject 的回调重跑（registry.md：
    // "每当某个必需服务发生变化时，系统都会卸载并重新运行该回调"）。
    const files = collectSources(join(ROOT, 'src'));
    const injectSites = files.filter((file) => /ctx\.inject\(\s*\[/.test(stripComments(readFileSync(file, 'utf-8'))));
    expect(injectSites.length).toBeGreaterThanOrEqual(1);
  });
});

describe('B. 能力快照是纯函数，且探针只做加法', () => {
  const gen2: HostVersionInfo = parseDshVersion('0.2.0-rc.2');
  const unknown: HostVersionInfo = unknownDshVersion();

  it('无探针时等于代际默认值（source 标记为 generation）', () => {
    const { flags, source, probedUpgrades } = resolveFeatureFlags(gen2);
    expect(flags).toEqual(FEATURE_FLAGS_BY_GENERATION.gen2);
    expect(source).toBe('generation');
    expect(probedUpgrades).toEqual([]);
  });

  it('探针返回 false 永远不能关掉已授予的能力（只加不减）', () => {
    const denyAll: CapabilityProbe = () => false;
    expect(resolveFeatureFlags(gen2, denyAll).flags).toEqual(FEATURE_FLAGS_BY_GENERATION.gen2);
  });

  it('探针返回 true 能升格代际默认值为 false 的能力（比模型更新的宿主）', () => {
    // unknown 基线的 `incrementalBootstrap` 是 false；探针观测到就打开。
    expect(FEATURE_FLAGS_BY_GENERATION.unknown.incrementalBootstrap).toBe(false);
    const seen: (keyof FeatureFlags)[] = [];
    const probe: CapabilityProbe = (capability) => {
      if (capability === 'incrementalBootstrap') { seen.push(capability); return true; }
      return undefined;
    };
    const { flags, source, probedUpgrades } = resolveFeatureFlags(unknown, probe);
    expect(flags.incrementalBootstrap).toBe(true);
    expect(source).toBe('generation+probe');
    expect(probedUpgrades).toEqual(['incrementalBootstrap']);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('探针抛异常等同于「没有证据」，不会让整次解析失败', () => {
    const throwing: CapabilityProbe = () => { throw new Error('registry unavailable'); };
    const { flags, source } = resolveFeatureFlags(unknown, throwing);
    expect(flags).toEqual(FEATURE_FLAGS_BY_GENERATION.unknown);
    expect(source).toBe('generation');
  });

  it('不做记忆化：同一宿主两次解析得到互相独立的对象（随时可重算）', () => {
    // 「快照不决定永远」的机器证据：解析结果是**新建对象**，改一个不会污染下一次。
    // 若哪天有人在里面加了缓存，这条会红——那是想要的信号，不是测试脆弱。
    const first = resolveFeatureFlags(gen2);
    const second = resolveFeatureFlags(gen2);
    expect(first.flags).not.toBe(second.flags);
    // 改坏第一份，第二份必须不受影响。
    (first.flags as FeatureFlags).incrementalBootstrap = !first.flags.incrementalBootstrap;
    expect(second.flags).toEqual(FEATURE_FLAGS_BY_GENERATION.gen2);
    // 代际默认表本身也不能被上一次调用改坏（它是 `Record` 常量，冻结靠用例守）。
    expect(FEATURE_FLAGS_BY_GENERATION.gen2).toEqual(resolveFeatureFlags(gen2).flags);
  });

  it('createFeatureFlags 与 resolveFeatureFlags 的判定一致（日志层不改语义）', () => {
    const probe: CapabilityProbe = (capability) => (capability === 'aiAssist' ? true : undefined);
    const viaResolve = resolveFeatureFlags(gen2, probe);
    const viaCreate = createFeatureFlags(gen2, probe);
    expect(viaCreate).toEqual(viaResolve.flags);
    // gen2 基线的 aiAssist 是 false（未验证能力），探针可以把它升格。
    expect(FEATURE_FLAGS_BY_GENERATION.gen2.aiAssist).toBe(false);
    expect(viaCreate.aiAssist).toBe(true);
  });
});
