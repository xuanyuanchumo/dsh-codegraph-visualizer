/**
 * 面板布局契约守卫（P0-STICKY-SCROLLPORT）。
 *
 * 缺陷类：**"sticky 工具栏粘在一个不滚动的盒子上"**。
 *
 * `WorkflowGraphPanel` 的根容器同时声明了 `overflow: 'auto'` 与 `height: '100%'`，
 * 而宿主把面板挂在 `[data-conversation-scroll]`（overflow-y:auto）里，且挂载点
 * `[data-slot]` 的高度是 auto。于是根容器成为"最近的滚动容器"，但它自己**永不滚动**：
 * 内容撑高它（实测 6895px），它再撑高父级，真正的滚动发生在宿主的滚动体上
 * （clientH 606 / scrollH 7112）。`position: sticky` 是相对**最近的滚动祖先**定位的，
 * 而那个祖先不滚 → 工具栏跟着页面滚出屏幕。实测滚动宿主 0→500→2000→6000px，
 * 工具栏 y = 76 → -424 → -1924 → -5924，完全跟走。
 *
 * 为什么只有源码形状能守：
 *   - 行为测试全绿：stub 宿主没有布局引擎，`getBoundingClientRect()` 全是 0，
 *     "工具栏粘住了"与"工具栏跟走了"在断言里长得一样；
 *   - DOM 断言也看不出来：元素存在、props 齐全、`position: sticky` 字符串也确实写对了
 *     ——错的是它所处的**包含块/滚动容器**，那是 CSS 计算出来的，不在任何 prop 里；
 *   - 单元测试更是无从下手：`overflow` 只是 style 对象的一个键，值本身"合法"。
 * 与 `clientRenderContract.test.ts` 的"死样式规则"同族：**只有真实 style 读回或源码守卫能看见**。
 *
 * 守卫三条纪律（与 clientRenderContract / dshConformance 同形）：
 *   ① 反向自检：每个负向断言先证明正例样例能被匹配；
 *   ② 不匹配自身：样例字面量一律拼接构造；
 *   ③ 扫描集非空：静默空扫描等同永久绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PANEL_REL = join('src', 'client', 'WorkflowGraphPanel.ts');

/**
 * 去注释但**保留换行**（行号必须与磁盘一致）。
 * 本文件顶部那段注释里就写着 `overflow: 'auto'` 的旧值，若不去注释，
 * 守卫会被自己的文档字符串绊倒 —— 这是本项目第四次踩到，故复用同一形状。
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

const PANEL_SRC = stripComments(readFileSync(join(PLUGIN_ROOT, PANEL_REL), 'utf8'));
const PANEL_LINES = PANEL_SRC.split('\n');

/** 取包含某标记的行号（1-based），找不到返回 -1。 */
function lineIndexOf(marker: string): number {
  return PANEL_LINES.findIndex((l) => l.includes(marker));
}

/**
 * 从某一行里抽出 `overflow:` 的取值（去引号、去尾逗号）。
 * 只处理本工程实际使用的单行 style 字面量形态；抽不到返回 null。
 */
function overflowOf(line: string): string | null {
  const m = /overflow\s*:\s*['"]([a-z]+)['"]/.exec(line);
  return m ? (m[1] ?? null) : null;
}

/** 该行是否声明了 height: '100%'（或 100vh）。 */
function hasFullHeight(line: string): boolean {
  return /height\s*:\s*['"]100(?:%|vh)['"]/.test(line);
}

// ---------- 反向自检样例（拼接构造，永不匹配自身文件） ----------
const BAD_OVERFLOW_SAMPLE = ['style: { width: ', "'100%'", ', overflow: ', "'auto'", ' }'].join('');
const GOOD_OVERFLOW_SAMPLE = ['style: { width: ', "'100%'", ', overflow: ', "'visible'", ' }'].join('');
const BAD_HEIGHT_SAMPLE = ['style: { ', 'height: ', "'100%'", ' }'].join('');

describe('面板布局契约守卫（sticky 必须绑到真正的滚动祖先）', () => {
  it('扫描集非空（静默空扫描 = 永久绿）', () => {
    expect(PANEL_LINES.length).toBeGreaterThanOrEqual(100);
    expect(lineIndexOf("'data-anic-workflow': 'canvas'")).toBeGreaterThanOrEqual(0);
    expect(lineIndexOf("'data-anic-toolbar'")).toBeGreaterThanOrEqual(0);
  });

  it('反向自检：overflow 抽取器真的能识别违规与合规两种形态', () => {
    expect(overflowOf(BAD_OVERFLOW_SAMPLE)).toBe('auto');
    expect(overflowOf(GOOD_OVERFLOW_SAMPLE)).toBe('visible');
    // 抽不到时必须返回 null，而不是悄悄返回一个"看起来合法"的值
    expect(overflowOf(['style: { width: ', "'100%'", ' }'].join(''))).toBeNull();
  });

  it('反向自检：height 检测器能识别 100% 与 100vh', () => {
    expect(hasFullHeight(BAD_HEIGHT_SAMPLE)).toBe(true);
    expect(hasFullHeight(['style: { minHeight: ', '420', ' }'].join(''))).toBe(false);
  });

  it('面板根容器不得成为"不滚动的滚动容器"（overflow 不得为 auto/scroll）', () => {
    const idx = lineIndexOf("'data-anic-workflow': 'canvas'");
    const overflow = overflowOf(PANEL_LINES[idx] ?? '');
    // 断言值本身，而不是"行里没有某个字符串"：后者会被写法变化绕过
    expect(overflow).not.toBe('auto');
    expect(overflow).not.toBe('scroll');
    expect(overflow).toBe('visible');
  });

  it('面板根容器不得声明 height:100% —— 父级高度是 auto，百分比高度无参照', () => {
    const idx = lineIndexOf("'data-anic-workflow': 'canvas'");
    expect(hasFullHeight(PANEL_LINES[idx] ?? '')).toBe(false);
  });

  it('工具栏确实是 sticky 且带 top:0（sticky 没有 top 等于没粘）', () => {
    const idx = lineIndexOf("'data-anic-toolbar'");
    const line = PANEL_LINES[idx] ?? '';
    expect(line).toContain("position: 'sticky'");
    expect(/top\s*:\s*0\b/.test(line)).toBe(true);
  });

  it('sticky 与 overflow:visible 是同一条契约的两半（改一半就复发）', () => {
    // 这条断言的价值：上面两条各自都可能"单看正确"（sticky 写对了 / overflow 写对了），
    // 缺陷恰恰出在两者**组合**上 —— 把它们绑在同一个断言里，删掉任一半都会红。
    const canvasOverflow = overflowOf(PANEL_LINES[lineIndexOf("'data-anic-workflow': 'canvas'")] ?? '');
    const toolbarLine = PANEL_LINES[lineIndexOf("'data-anic-toolbar'")] ?? '';
    const stickyDeclared = toolbarLine.includes("position: 'sticky'");
    expect(stickyDeclared && canvasOverflow === 'visible').toBe(true);
  });
});
