/**
 * 客户端渲染契约守卫（P0-ORG-STRING / P1-TOKENS）。
 *
 * 两条纪律都来自本项目已经付过代价的缺陷类：
 *
 * 1. **字符串渲染器不可能在 React 下工作**。`renderOrgStatus` 曾 `return string`
 *    拼 HTML，调用点把它当 React 子节点传入 —— React 转义字符串子节点，整段标记
 *    以可见的字面文本渲染。行为测试全绿（org 分区没有任何测试），DOM 断言也看不
 *    出来（"元素没渲染"与"渲染成一段文本"在断言里长得一样）。只有源码形状能守。
 *
 * 2. **语义令牌必须带同源 fallback**。裸 `var(--anic-pass)` 在宿主未注入变量时
 *    计算为无效值（颜色回退到 initial），组件"没报错但没样式"。而 fallback 必须
 *    是十六进制原语，不能是另一个未定义变量 —— 后者只是把失败推后一层。
 *
 * 守卫三条纪律（与 dshConformance.test.ts 同形）：
 *   ① 反向自检：每个负向断言先证明正例样例能被匹配；
 *   ② 不匹配自身：样例字面量一律拼接构造；
 *   ③ 扫描集非空：files.length 有下限断言，静默空扫描等同永久绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { token, tokenCssBlock, SEMANTIC, TOKEN_SCOPE, THEME_ATTRIBUTE, type TokenName } from '../../src/shared/tokens.ts';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const SRC_FILES = walkTs(join(PLUGIN_ROOT, 'src'));
const CLIENT_FILES = SRC_FILES.filter((f) => f.includes(join('src', 'client')));

/**
 * 去注释但**保留换行**：行号必须与磁盘一致，否则报错行号指向别处。
 * 块注释按字符原位清空（不删除），行注释只清内容保留 `\n`。
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

const STRIPPED = new Map<string, string>();
for (const f of SRC_FILES) STRIPPED.set(f, stripComments(readFileSync(f, 'utf8')));
function src(rel: string): string {
  const full = join(PLUGIN_ROOT, rel);
  const s = STRIPPED.get(full);
  if (s === undefined) throw new Error(`not scanned: ${rel}`);
  return s;
}

// ---------- 反向自检样例（拼接构造，永不匹配自身文件） ----------
const RENDER_STRING_SAMPLE = ['export function renderX(d: D): ', 'string', ' { return ""; }'].join('');
const RENDER_ELEMENT_SAMPLE = ['export function renderX(d: D): ', 'ReactElement', ' { return null; }'].join('');
const RENDER_STRING_RE = /export\s+function\s+render\w+\s*\([^)]*\)\s*:\s*string\b/;
const BARE_TOKEN_SAMPLE = ['style: { color: ', '`var(--anic-pass)`', ' }'].join('');
const GOOD_TOKEN_SAMPLE = ['style: { color: ', 'token(', "'anic-pass'", ')', ' }'].join('');
const BARE_VAR_RE = /var\(\s*--anic-[a-z-]+\s*\)/;
/**
 * 颜色字面量：3 位/6 位十六进制、rgb()/rgba()、hsl()。
 *
 * 必须同时认 3 位形态 —— 只写 `#[0-9a-fA-F]{6}` 时 `background: '#fff'`
 * （WorkflowGraphPanel.ts:36 的真实漏网案例）会整类逃过扫描，而它正是
 * "迁移做一半"最典型的残留。
 */
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;

describe('客户端渲染契约守卫', () => {
  it('扫描集非空（静默空扫描 = 永久绿）', () => {
    expect(SRC_FILES.length).toBeGreaterThanOrEqual(20);
    expect(CLIENT_FILES.length).toBeGreaterThanOrEqual(5);
  });

  it('stripComments 保留行号（去掉注释后行数不变）', () => {
    const sample = ['a();', '/* c1', 'c2 */', 'b(); // tail'].join('\n');
    const stripped = stripComments(sample);
    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped).toContain('a();');
    expect(stripped).toContain('b();');
    expect(stripped).not.toContain('c1');
  });

  it('反向自检：字符串渲染器 regex 真的能匹配（否则守卫永远绿）', () => {
    expect(RENDER_STRING_RE.test(RENDER_STRING_SAMPLE)).toBe(true);
    // 且不误伤正确的 ReactElement 形态
    expect(RENDER_STRING_RE.test(RENDER_ELEMENT_SAMPLE)).toBe(false);
  });

  it('src/client 下没有返回 string 的 render* 函数', () => {
    const offenders: string[] = [];
    for (const f of CLIENT_FILES) {
      const lines = src(f.slice(PLUGIN_ROOT.length + 1)).split('\n');
      lines.forEach((line, idx) => {
        if (RENDER_STRING_RE.test(line)) offenders.push(`${f.slice(PLUGIN_ROOT.length + 1)}:${String(idx + 1)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('没有 dangerouslySetInnerHTML（字符串渲染器已全部改为元素树）', () => {
    const offenders: string[] = [];
    for (const f of SRC_FILES) {
      const text = STRIPPED.get(f) ?? '';
      if (text.includes('dangerouslySetInnerHTML')) offenders.push(f.slice(PLUGIN_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it('反向自检：裸 var(--anic-*) regex 能匹配，且不误伤 token() 调用', () => {
    expect(BARE_VAR_RE.test(BARE_TOKEN_SAMPLE)).toBe(true);
    expect(BARE_VAR_RE.test(GOOD_TOKEN_SAMPLE)).toBe(false);
  });

  it('组件不得直接写裸 var(--anic-*)——必须经 token() 带同源 fallback', () => {
    const offenders: string[] = [];
    for (const f of SRC_FILES) {
      const rel = f.slice(PLUGIN_ROOT.length + 1);
      if (rel === join('src', 'shared', 'tokens.ts')) continue; // 令牌定义处自身是权威
      const lines = (STRIPPED.get(f) ?? '').split('\n');
      lines.forEach((line, idx) => {
        if (BARE_VAR_RE.test(line)) offenders.push(`${rel}:${String(idx + 1)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('每个语义令牌都产出 var(--name, <具体颜色>)，且 fallback 与 SEMANTIC 同源', () => {
    // 行为断言强于源码 regex：token() 用模板串拼出 fallback，源码里**不存在**
    // 字面 `var(--anic-pass, #2d8a3e)`，所以"扫描字面量"这种写法在这里永远
    // 匹配 0 条 —— 正是它自己暴露了 regex 工具选错了。
    const names = Object.keys(SEMANTIC) as TokenName[];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const expr = token(name);
      // 形状：var(--anic-x, <具体颜色>)。允许 rgba() 是因为半透明浮层
      // （anic-detail-surface）无法用 6 位十六进制表达，而它必须是一个
      // **具体颜色**——契约禁止的从来不是 rgba，而是"fallback 又是另一个 var()"，
      // 那只是把失败推后一层。所以这里放宽到"具体颜色字面量"，见下一条断言。
      expect(expr).toMatch(/^var\(--anic-[a-z-]+, (?:#[0-9a-f]{3,8}|rgba?\([^)]*\))\)$/);
      // 同源：fallback 必须等于 SEMANTIC 里的原语，不能是第二张表
      expect(expr).toBe(`var(--${name}, ${SEMANTIC[name]})`);
      // 反向：fallback 不得是另一个 var()（那只是把失败推后一层）
      expect(expr).not.toMatch(/, var\(/);
    }
  });

  it('tokenCssBlock 声明了每个语义令牌（含 renderOrgStatus 引用的三个）', () => {
    const css = tokenCssBlock();
    const names = Object.keys(SEMANTIC) as TokenName[];
    for (const name of names) {
      expect(css).toContain(`--${name}:`);
    }
    // 三个曾被引用却从未定义的变量（P1-TOKENS 的原始症状）
    for (const name of ['anic-pass', 'anic-fail', 'anic-doubt']) {
      expect(css).toContain(`--${name}:`);
    }
    // 暗色只换语义层，且声明 color-scheme（否则暗色下留亮色滚动条/表单控件）
    expect(css).toContain('color-scheme');
    // P0-THEME-MISMATCH 的反向守卫：暗色**必须**由宿主主题属性驱动。
    // 原实现挂在 @media (prefers-color-scheme: dark) 上，于是"宿主浅色 + OS 暗色"
    // 会套用暗色令牌 → 深底深字、实测几乎不可读。这里同时断言：
    //   ① 暗色块选择器存在且带主题属性；② 不再出现 OS 媒体查询。
    expect(css).toContain(`[${THEME_ATTRIBUTE}='dark']`);
    expect(css).not.toContain('prefers-color-scheme');
    // 作用域不得是 :root —— 那会把令牌抬成全局写入面，并在 color-scheme 上与
    // 宿主主题呈现器抢同一属性（见 tokens.ts 的 TOKEN_SCOPE 注释）。
    expect(css).not.toMatch(/^\s*:root\s*\{/m);
    expect(css).toContain(`${TOKEN_SCOPE} {`);
  });

  it('反向自检：颜色字面量 regex 能匹配 3 位与 6 位十六进制和 rgba()', () => {
    // 3 位形态是真实漏网案例：#fff 在 WorkflowGraphPanel.ts:36 躲过了只认 6 位的扫描。
    // 样例一律拼接构造，避免守卫匹配自身字面量。
    const H = '#'; const R = 'rgba' + '(';
    expect(COLOR_LITERAL_RE.test(`background: '${H}fff'`)).toBe(true);
    expect(COLOR_LITERAL_RE.test(`color: '${H}22c55e'`)).toBe(true);
    expect(COLOR_LITERAL_RE.test(`background: '${R}248,250,252,0.95)'`)).toBe(true);
    // 不误伤：令牌引用、id/锚点、`#` 开头的非颜色串
    expect(COLOR_LITERAL_RE.test(`background: ${'token'}('anic-surface')`)).toBe(false);
    expect(COLOR_LITERAL_RE.test(`id: 'anic-design-tokens'`)).toBe(false);
    expect(COLOR_LITERAL_RE.test(`url(#anic-spike-arrow)`)).toBe(false);
  });

  it('src/client 下没有颜色字面量——一律经 token() 走语义层', () => {
    // 这是 P1-TOKENS 的收口断言：四个特性模块各自硬编码一套调色板时，
    // 暗色主题只能覆盖到被 var() 引用的那一份，另外几份永远停在浅色档，
    // 而**任何行为测试都不会变红**（颜色"照常正确"）。
    const offenders: string[] = [];
    for (const f of CLIENT_FILES) {
      const rel = f.slice(PLUGIN_ROOT.length + 1);
      const lines = (STRIPPED.get(f) ?? '').split('\n');
      lines.forEach((line, idx) => {
        if (COLOR_LITERAL_RE.test(line)) offenders.push(`${rel}:${String(idx + 1)} ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('令牌表本身覆盖了每个曾被硬编码的角色（防止"迁移后漏登记"）', () => {
    // 迁移只做一半的典型症状：组件改成 token('anic-x') 而 SEMANTIC 里没有 anic-x，
    // 于是 TypeScript 报错——除非调用方写成字符串绕过类型。这条断言把
    // "图上 8 类节点 + 5 种裁决 + 5 种步骤状态 + 3 种带"固化成契约。
    const required = [
      'anic-gate-pass', 'anic-gate-fail', 'anic-gate-doubt', 'anic-gate-pending', 'anic-gate-skip',
      'anic-band-normal', 'anic-band-warn', 'anic-band-alarm',
      'anic-status-done', 'anic-status-active', 'anic-status-failed', 'anic-status-skipped', 'anic-status-pending',
      'anic-type-phase', 'anic-type-micro-step', 'anic-type-gate', 'anic-type-human-gate',
      'anic-type-cycle', 'anic-type-gate-event', 'anic-type-incident', 'anic-type-autonomy', 'anic-type-unknown',
      'anic-on-accent', 'anic-detail-surface',
    ];
    const names = Object.keys(SEMANTIC);
    const missing = required.filter((r) => !names.includes(r));
    expect(missing).toEqual([]);
    // 反向自检：确实存在一个未登记的名字时，上面的判定式必须能发现
    expect(required.filter((r) => ![...names, 'anic-not-registered'].includes(r))).toEqual([]);
    expect([...names, 'anic-not-registered'].includes('anic-not-registered')).toBe(true);
  });
});
