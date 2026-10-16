/**
 * 对比度契约（P1-A11Y-CONTRAST）——本仓库里**唯一**能看见"颜色够不够亮"的守卫。
 *
 * ## 为什么必须存在
 *
 * 低对比文字没有任何行为症状：元素照常渲染、DOM 断言照常通过、颜色"照常正确"、
 * 覆盖率满分、lint 零告警。P1-TOKENS 把颜色收敛到一张表，只解决了"颜色从哪来"，
 * **没有**解决"颜色够不够亮"——实测 `--anic-doubt` #e6a700 在浅色面上只有 2.03:1
 * （WCAG 正文要求 4.5:1），而那条前景/背景组合不会让任何测试变红。
 * 所以这里用 WCAG 2.x 相对亮度公式**逐值算数**。
 *
 * ## 三条防自欺的设计（缺一条这个守卫就会变成永久绿）
 *
 * 1. **被测对象只能是真表**：值全部来自 `SEMANTIC` / `SEMANTIC_DARK` 的运行时对象，
 *    不是手抄的一份颜色清单。手抄表格会在源改动后继续测旧值，即"fixture 发明外部契约"。
 * 2. **每个令牌必须被显式分类**（文本 / 非文本 / 装饰 / 特殊），未分类即红。
 *    否则新加一个令牌就自动绕过守卫——这正是"迁移只做一半"的复发机制。
 * 3. **反向自检**：判定式必须能对已知坏值报红（如旧的白字形墨），
 *    否则 regex/公式写错时守卫会永远绿。
 *
 * ## 阈值来自 WCAG，余量来自工程判断
 *
 * - 文本：≥4.5（WCAG 2.x AA 正文），本仓库要求 ≥4.55（留 0.05 余量防抗锯齿/字体漂移）
 * - 非文本图形/填充/圆点：≥3.0（WCAG 2.1 非文本对比），本仓库要求 ≥3.3
 * - 阈值是**契约**、余量是**质量线**，两条断言分开写：余量被打破时能看到原因。
 *
 * ## 已知不覆盖的范围（明说不猜）
 *
 * - `anic-border` / `anic-border-strong` / `anic-row-border` 归类为**装饰**，不设阈值。
 *   `anic-row-border` #f1f5f9 在浅色面上只有 1.05:1，但它是表格行分隔线，
 *   不承载信息；`anic-border` 参与按钮描边，按 WCAG 1.4.11 严格说该 ≥3:1，
 *   但按钮同时有文字可辨识边界，故列为装饰并在此登记为**残余风险**（见 cycle-95
 *   交付清单的 C-xx 结转项），不假装已覆盖。
 * - 半透明浮层 `anic-detail-surface` 是背景，不设阈值；它压在 `--anic-surface`
 *   同一色系上（#f8fafc @ 0.95），合成后与表面几乎同色，所以上面那些文本令牌
 *   仍按表面阈值衡量是成立的。
 * - 灰度/色盲可辨性（WCAG 1.4.1）不由对比度覆盖，由 `graphA11y.test.ts` 的
 *   字形+虚线第二通道负责——**而那条通道本身的可读性（字形画在填充上）在本文件里测**，
 *   两边合起来才完整。
 */
import { describe, it, expect } from 'vitest';
import {
  PALETTE,
  SEMANTIC,
  SEMANTIC_DARK,
  THEME_ATTRIBUTE,
  TOKEN_SCOPE,
  tokenCssBlock,
  type TokenName,
} from '../../src/shared/tokens.ts';

// ── WCAG 2.x 相对亮度 / 对比度 ──

/** 只接受 3 位或 6 位十六进制；收到 rgba()/var() 直接抛，防止静默跳过测量。 */
function channelsOf(value: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
  if (m === null) throw new Error(`对比度契约只能测量十六进制颜色，收到：${value}`);
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function linear(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string): number {
  const [r, g, b] = channelsOf(value);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = la >= lb ? la : lb;
  const lo = la >= lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── 阈值：契约来自 WCAG，余量来自工程判断（两条断言分开写）──
const TEXT_AA = 4.5;
const TEXT_WITH_MARGIN = 4.55;
const NON_TEXT_AA = 3.0;
const NON_TEXT_WITH_MARGIN = 3.3;

// ── 两个表面取自真表，不是手抄字面量 ──
const SURFACE_LIGHT: string = SEMANTIC['anic-surface'];
const SURFACE_DARK: string = SEMANTIC_DARK['anic-surface'] as string;

/**
 * 角色分类——**穷举**，任何 SEMANTIC 键未出现在四组之一即测试失败。
 * 分组的依据是 consumption 事实（哪个 CSS 属性消费它），不是"看起来像什么"。
 */
const TEXT_ROLES: TokenName[] = [
  // color: 正文/标题/标签
  'anic-text', 'anic-text-strong', 'anic-text-dim', 'anic-text-faint',
  // renderOrgStatus scoreColor/bandColor → 文本
  'anic-pass', 'anic-fail', 'anic-doubt',
  // renderDiagnostics PASS/FAIL、renderStepTrace ✓ structured
  'anic-ok-text', 'anic-bad-text',
  // renderStepTrace ⚠ heuristic / 账本，prefsDrawer 警告
  'anic-warn-text', 'anic-ledger-text',
  // gateColors.ts:92 控制带标签是 bold 文本（不是色块！）
  'anic-band-normal', 'anic-band-warn', 'anic-band-alarm',
];

const NON_TEXT_ROLES: TokenName[] = [
  // SVG circle fill（同时是字形背景）
  'anic-gate-pass', 'anic-gate-fail', 'anic-gate-doubt', 'anic-gate-pending', 'anic-gate-skip',
  // SVG circle fill（图区 8 类 + 兜底）
  'anic-type-phase', 'anic-type-micro-step', 'anic-type-gate', 'anic-type-human-gate',
  'anic-type-cycle', 'anic-type-gate-event', 'anic-type-incident', 'anic-type-autonomy',
  'anic-type-unknown',
  // renderStepTrace.ts:53 10px 圆点 background
  'anic-status-done', 'anic-status-active', 'anic-status-failed', 'anic-status-skipped',
  'anic-status-pending',
];

/** 装饰/背景：不承载信息，不设阈值（残余风险已在文件头登记）。 */
const DECORATIVE: TokenName[] = [
  'anic-surface', 'anic-border', 'anic-border-strong', 'anic-row-border', 'anic-detail-surface',
];

/** 特殊角色：画在门禁填充之上的字形墨，逐填充单独测量（见下方专用断言）。 */
const SPECIAL: TokenName[] = ['anic-on-accent'];

const GATE_FILLS: TokenName[] = [
  'anic-gate-pass', 'anic-gate-fail', 'anic-gate-doubt', 'anic-gate-pending', 'anic-gate-skip',
];

describe('对比度契约（P1-A11Y-CONTRAST）', () => {
  it('覆盖完整性：每个令牌恰好被分类一次（未分类即红）', () => {
    const groups = { TEXT_ROLES, NON_TEXT_ROLES, DECORATIVE, SPECIAL };
    const all = [...TEXT_ROLES, ...NON_TEXT_ROLES, ...DECORATIVE, ...SPECIAL];
    const names = Object.keys(SEMANTIC) as TokenName[];
    // 无重复
    expect(all.length).toBe(new Set(all).size);
    // 无遗漏：未分类的名字就是守卫的漏洞
    const unclassified = names.filter((n) => !all.includes(n));
    expect(unclassified).toEqual([]);
    // 无越界：分类表里不能出现 SEMANTIC 里不存在的名字
    const stray = all.filter((n) => !names.includes(n));
    expect(stray).toEqual([]);
    // 非空：防止上面几条在空表上"全绿"
    expect(names.length).toBeGreaterThan(30);
    expect(TEXT_ROLES.length).toBeGreaterThan(10);
    expect(NON_TEXT_ROLES.length).toBeGreaterThan(15);
    expect(Object.keys(groups).length).toBe(4);
  });

  it('两个表面取自真表且确实一深一浅', () => {
    expect(SURFACE_LIGHT).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(SURFACE_DARK).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(SURFACE_LIGHT).not.toBe(SURFACE_DARK);
    expect(luminance(SURFACE_LIGHT)).toBeGreaterThan(luminance(SURFACE_DARK));
  });

  it('文本级令牌：浅色面全部 ≥4.5，且留有余量', () => {
    const offenders: string[] = [];
    for (const name of TEXT_ROLES) {
      const v = SEMANTIC[name];
      const r = ratio(v, SURFACE_LIGHT);
      if (r < TEXT_AA) offenders.push(`${name} ${v} → ${round2(r)}:1（需 ≥${TEXT_AA}）`);
    }
    expect(offenders).toEqual([]);
    // 余量线：刚好卡 4.50 的值一改字体就掉下去
    const thin: string[] = [];
    for (const name of TEXT_ROLES) {
      const r = ratio(SEMANTIC[name], SURFACE_LIGHT);
      if (r < TEXT_WITH_MARGIN) thin.push(`${name} ${SEMANTIC[name]} → ${round2(r)}:1`);
    }
    expect(thin).toEqual([]);
  });

  /**
   * 暗色面：**缺覆盖自动被抓**。文本令牌若没有暗色覆盖，它的浅色值会被拿去
   * 跟暗色面比，通常直接失败——这就是"amber 没进暗色块"这个真实缺陷的复发机制。
   */
  it('文本级令牌：暗色面全部 ≥4.5（缺暗色覆盖即红）', () => {
    const offenders: string[] = [];
    const missing: string[] = [];
    for (const name of TEXT_ROLES) {
      const overridden = Object.prototype.hasOwnProperty.call(SEMANTIC_DARK, name);
      if (!overridden) missing.push(name);
      const v = overridden ? (SEMANTIC_DARK[name] as string) : SEMANTIC[name];
      const r = ratio(v, SURFACE_DARK);
      if (r < TEXT_AA) offenders.push(`${name} ${v} → ${round2(r)}:1（需 ≥${TEXT_AA}）`);
    }
    expect(offenders).toEqual([]);
    // 每一个文本令牌都必须有暗色档：同一色值在两个表面上不可互换
    expect(missing).toEqual([]);
    const thin: string[] = [];
    for (const name of TEXT_ROLES) {
      const v = SEMANTIC_DARK[name] as string;
      const r = ratio(v, SURFACE_DARK);
      if (r < TEXT_WITH_MARGIN) thin.push(`${name} ${v} → ${round2(r)}:1`);
    }
    expect(thin).toEqual([]);
  });

  it('非文本级令牌：两个表面都 ≥3.0，且留有余量', () => {
    const offenders: string[] = [];
    const thin: string[] = [];
    for (const name of NON_TEXT_ROLES) {
      const v = SEMANTIC[name];
      for (const [label, surface] of [['浅色', SURFACE_LIGHT], ['暗色', SURFACE_DARK]] as const) {
        const r = ratio(v, surface);
        if (r < NON_TEXT_AA) offenders.push(`${name} ${v} 在${label}面 → ${round2(r)}:1`);
        if (r < NON_TEXT_WITH_MARGIN) thin.push(`${name} ${v} 在${label}面 → ${round2(r)}:1`);
      }
    }
    expect(offenders).toEqual([]);
    expect(thin).toEqual([]);
  });

  it('非文本令牌不得被暗色覆盖（两套门禁色漂移会让各自的余量失效）', () => {
    // 设计决定：填充/圆点色按"两个表面同时成立"校准，覆盖只会制造两套基准。
    const overridden = NON_TEXT_ROLES.filter((n) => Object.prototype.hasOwnProperty.call(SEMANTIC_DARK, n));
    expect(overridden).toEqual([]);
    // 反向自检：真有一条覆盖时上面的过滤必须能发现它
    const fakeDark: Partial<Record<TokenName, string>> = { 'anic-gate-pass': '#123456' };
    expect(NON_TEXT_ROLES.filter((n) => Object.prototype.hasOwnProperty.call(fakeDark, n))).toEqual([
      'anic-gate-pass',
    ]);
  });

  /**
   * 字形墨色：`VERDICT_SHAPE` 的字形是给色盲/灰度打印准备的**第二通道**
   * （P2-A11Y-COLOR），而它必须画在门禁填充上。改造前固定用白色，
   * 实测白在亮绿上只有 2.28:1、亮黄 2.15:1 —— 第二通道自己在四个裁决上不可读。
   * 反向自检把那个旧值喂进同一判定式，证明这条断言真的能发现它。
   */
  it('字形墨色：五个门禁填充上全部 ≥4.5（旧的白墨必须被判红）', () => {
    const ink = SEMANTIC['anic-on-accent'];
    const offenders: string[] = [];
    for (const fill of GATE_FILLS) {
      const r = ratio(ink, SEMANTIC[fill]);
      if (r < TEXT_AA) offenders.push(`${ink} on ${fill} ${SEMANTIC[fill]} → ${round2(r)}:1`);
    }
    expect(offenders).toEqual([]);
    // 反向自检：旧实现的白墨确实过不了这条线，所以这条断言有判别力
    const legacyWhite = PALETTE.onAccent;
    const legacyFails = GATE_FILLS.filter((f) => ratio(legacyWhite, SEMANTIC[f]) < TEXT_AA);
    expect(legacyFails.length).toBeGreaterThan(0);
    // 且墨色不能恰好等于某个填充（否则"字形"成了隐形）
    expect(GATE_FILLS.every((f) => SEMANTIC[f] !== ink)).toBe(true);
  });

  it('反向自检：对比度公式本身正确（黑白 21:1、同色 1:1、中间值可判别）', () => {
    expect(round2(ratio('#ffffff', '#000000'))).toBe(21);
    expect(round2(ratio('#f8fafc', '#f8fafc'))).toBe(1);
    // 已知坏组合 <4.5、已知好组合 >4.5：证明阈值判定能双向判别
    expect(ratio('#e6a700', '#f8fafc')).toBeLessThan(TEXT_AA);
    expect(ratio('#334155', '#f8fafc')).toBeGreaterThan(TEXT_AA);
    // 非十六进制必须抛而不是静默返回 1（否则 rgba 令牌会被当成"刚好达标"）
    expect(() => channelsOf('rgba(0,0,0,0.5)')).toThrow();
    expect(() => channelsOf(`var(--anic-surface)`)).toThrow();
  });

  it('暗色覆盖表结构：键必须是已登记令牌，值必须是具体颜色而非 var()', () => {
    const names = Object.keys(SEMANTIC) as TokenName[];
    const unknown = Object.keys(SEMANTIC_DARK).filter((k) => !names.includes(k as TokenName));
    expect(unknown).toEqual([]);
    const unresolved: string[] = [];
    for (const [k, v] of Object.entries(SEMANTIC_DARK)) {
      if (typeof v !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim()) === false) {
        // 允许 rgba（detail-surface），但不允许把覆盖值本身写成 var()——那只是把失败推迟一层
        if (typeof v === 'string' && v.includes('var(')) unresolved.push(`${k} → ${v}`);
      }
    }
    expect(unresolved).toEqual([]);
    // 非空：空表会让上面几条"全绿"
    expect(Object.keys(SEMANTIC_DARK).length).toBeGreaterThan(10);
  });

  it('tokenCssBlock：浅色块发射全部令牌，暗色块恰好发射覆盖表', () => {
    const css = tokenCssBlock();
    expect(css).toContain(`${TOKEN_SCOPE} {`);
    for (const [k, v] of Object.entries(SEMANTIC)) {
      expect(css).toContain(`--${k}: ${v};`);
    }
    for (const [k, v] of Object.entries(SEMANTIC_DARK)) {
      expect(css).toContain(`--${k}: ${v};`);
    }
    // 暗色块**不得**包含非覆盖表的声明：否则暗色面实际生效的值与守卫测的值不一致。
    // 缩进用 `\s*` 而不是写死宽度——换生成格式不该让守卫静默变成"扫不到任何声明"。
    const darkBlock = css.slice(css.indexOf(`[${THEME_ATTRIBUTE}='dark']`));
    const declaredInDark = [...darkBlock.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]);
    expect(declaredInDark.sort()).toEqual(Object.keys(SEMANTIC_DARK).sort());
    // 反向自检：正则确实抓得到声明（暗色块非空），否则上面的排序比较是在比两个空数组
    expect(declaredInDark.length).toBeGreaterThan(10);
  });
});
