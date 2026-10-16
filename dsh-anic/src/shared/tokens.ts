/**
 * 设计令牌唯一来源（P1-TOKENS + P1-A11Y-CONTRAST）。
 *
 * 两层结构：「原语调色板（palette.ts）→ 语义别名（本文件）」。
 * 组件只消费 `token('anic-*')`，即 `var(--anic-*, <原语 fallback>)`；
 * `tests/contract/clientRenderContract.test.ts` 会拒绝任何绕过本表的颜色字面量。
 *
 * ## 修因一（P1-TOKENS）：四套私有调色板 + 半接线主题
 *
 * 改造前 4 个特性模块各自硬编码一套十六进制调色板（renderGraph TYPE_COLORS /
 * gateColors GATE_COLORS+BAND_COLORS / renderStepTrace STATUS_COLORS /
 * renderDiagnostics 内联色），且 renderOrgStatus 引用的 `--anic-pass` /
 * `--anic-fail` / `--anic-doubt` **从未被定义**——变量永远走 fallback。
 *
 * ## 修因二（P1-A11Y-CONTRAST）：令牌值本身不满足 WCAG 对比度
 *
 * 收敛到一张表只解决了"颜色从哪来"，没解决"颜色够不够亮"。逐值实测（WCAG 2.x
 * 相对亮度）后的缺陷清单：`--anic-pass` #2d8a3e 在浅色面 4.17；`--anic-doubt`
 * #e6a700 **2.03**；`--anic-ok-text` #16a34a 3.15；暗色面上 `--anic-text-faint`
 * 3.75、`--anic-warn-text` 3.56、`--anic-ledger-text` 3.13（后两者压根没进暗色
 * 覆盖表）。更严重的一处是**字形墨色**：`anic-on-accent` 固定为白色，而白色画在
 * 亮绿填充上只有 2.28 —— 那个字形正是为色盲用户准备的"第二通道"，它在五个裁决里
 * 有四个不可读。全部值已在 `palette.ts` 里按角色重解，并由
 * `tests/contract/contrastContract.test.ts` 逐项测量守护。
 *
 * ## 为什么暗色是一张**表**而不是模板字符串
 *
 * 原实现把暗色值写在 `tokenCssBlock()` 的字符串数组里，于是它们的对比度
 * **无法被任何测试引用**——这正是上述三个暗色缺陷能长期存活的机制。
 * 现在 `SEMANTIC_DARK` 是一个导出的 `Partial<Record<TokenName, string>>`，
 * 对比度契约测试可以直接遍历它逐一测量。
 *
 * ## 暗色由宿主主题驱动，不由 OS 偏好驱动
 *
 * 宿主契约（app.asar 内 theme-presenter 源码）：`apply(snapshot)` 依据
 * `snapshot.active.colorScheme` 写 `html[data-ds-theme-source]` 与
 * `body[data-ds-dark-theme]`，**永不读 `prefers-color-scheme`**（`system` 在
 * 更上游就解析成具体方案）。原实现把暗色挂在 `@media (prefers-color-scheme: dark)`，
 * 于是"用户选浅色 + 操作系统暗色"这一常见组合会命中媒体查询、套用暗色令牌，
 * 得到深底配宿主的深色文字，整块面板几乎不可读（实测复现）。现改为读
 * `[data-anic-theme="dark"]`，由组件用 `resolveShellTheme()` 写入。
 *
 * ## 作用域
 *
 * `tokenCssBlock()` 只写 `[data-anic-workflow]`，**绝不写 `:root`**：宿主把
 * `color-scheme` 写在 `documentElement.style`（内联）上，内联胜过任何样式表规则，
 * 所以 `:root { color-scheme }` 今天是无害的死规则，却是一颗雷——宿主哪天改用
 * 样式表/类名，它就会把整页翻成 `light dark`。面板不需要全站生效，就不该留这个
 * 全局写入面。
 *
 * 注：`var(--x, fallback)` 的 fallback 只在变量「未定义或计算期无效」时生效，
 * 它不是老浏览器缺自定义属性时的 polyfill。实测确认 SVG 表现属性
 * `fill="var(--x, #0a9f41)"` 在变量未定义时同样解析出 fallback，所以图形色与
 * CSS 色可以走同一套令牌，无需给 SVG 另开通道。
 */
import { PALETTE } from './palette.ts';
import { THEME_ATTRIBUTE } from './shellTheme.ts';

// 原语调色板转出，保持既有调用面（契约测试直接引用本表的 SEMANTIC）。
export { PALETTE };

/** 语义令牌名（`--anic-*`）；键即 CSS 变量名去掉 `--` 前缀。 */
export type TokenName = keyof typeof SEMANTIC;

/**
 * 浅色语义别名 → 原语。每个键都在下方注释里标注**消费角色**（文本 / 填充 /
 * 圆点 / 边），因为同一个令牌在不同角色下适用不同阈值（4.5 vs 3.3），
 * 角色标注就是对比度契约测试的判定依据。
 */
export const SEMANTIC = {
  // 门禁填充（SVG circle fill；同时是字形背景）——≥3.3 两个表面同时成立
  'anic-gate-pass': PALETTE.gatePass,
  'anic-gate-fail': PALETTE.gateFail,
  'anic-gate-doubt': PALETTE.gateDoubt,
  'anic-gate-pending': PALETTE.gatePending,
  'anic-gate-skip': PALETTE.gateSkip,
  // 控制带（gateColors.ts:92 是**文本** color，故取文本级 L 值）
  'anic-band-normal': PALETTE.bandNormalL,
  'anic-band-warn': PALETTE.bandWarnL,
  'anic-band-alarm': PALETTE.bandAlarmL,
  // 节点类型色（SVG circle fill）
  'anic-type-phase': PALETTE.typePhase,
  'anic-type-micro-step': PALETTE.typeMicroStep,
  'anic-type-gate': PALETTE.typeGate,
  'anic-type-human-gate': PALETTE.typeHumanGate,
  'anic-type-cycle': PALETTE.typeCycle,
  'anic-type-gate-event': PALETTE.typeGateEvent,
  'anic-type-incident': PALETTE.typeIncident,
  'anic-type-autonomy': PALETTE.typeAutonomy,
  'anic-type-unknown': PALETTE.typeUnknown,
  // 步骤状态（renderStepTrace.ts:53 是 10px 圆点 background ⇒ 非文本 ≥3.3）
  'anic-status-done': PALETTE.statusDone,
  'anic-status-active': PALETTE.statusActive,
  'anic-status-failed': PALETTE.statusFailed,
  'anic-status-skipped': PALETTE.statusSkipped,
  'anic-status-pending': PALETTE.statusPending,
  // 文本级（全部按浅色面 ≥4.5 校准）
  'anic-pass': PALETTE.textPassL,
  'anic-fail': PALETTE.textFailL,
  'anic-doubt': PALETTE.textDoubtL,
  'anic-ok-text': PALETTE.textOkL,
  'anic-bad-text': PALETTE.textBadL,
  'anic-warn-text': PALETTE.textWarnL,
  'anic-ledger-text': PALETTE.textLedgerL,
  // 面/边/字
  'anic-surface': PALETTE.surface,
  'anic-border': PALETTE.border,
  'anic-border-strong': PALETTE.borderStrong,
  'anic-row-border': PALETTE.rowBorder,
  'anic-text': PALETTE.textL,
  'anic-text-strong': PALETTE.textStrongL,
  'anic-text-dim': PALETTE.textDimL,
  'anic-text-faint': PALETTE.textFaintL,
  /**
   * 画在门禁填充之上的**字形墨色**（renderGraph.ts:203）。
   * 值不是白而是深墨：见 PALETTE.glyphInk 注释（白在亮绿上仅 2.28）。
   * 填充本身不随主题变化，故本项**不设**暗色覆盖。
   */
  'anic-on-accent': PALETTE.glyphInk,
  // 半透明浮层（节点详情抽屉压在图上，不能全遮）
  'anic-detail-surface': PALETTE.detailSurface,
} as const;

/**
 * 暗色覆盖表（第二层：只登记**在暗底上会失效**的那些）。
 *
 * 刻意**不覆盖**的三组值，各有理由，写在注释里以免后人"顺手补齐"：
 *   - 门禁填充 / 类型色：本身按"两个表面同时 ≥3.3"校准，覆盖只会让两套门禁色漂移；
 *   - 步骤状态色：同上（原实现在这里覆盖了 done/failed，属于多余且互相漂移）；
 *   - `anic-on-accent`：填充不变，墨色也不该变。
 *
 * 文本级令牌一律换成 `*D` 档：同一个色值在浅底过 4.5 **不代表**在暗底也过
 * （实测 `#2b823b`：浅色面 4.60、暗色面仅 3.2）。两档不可互换。
 */
export const SEMANTIC_DARK: Partial<Record<TokenName, string>> = {
  'anic-surface': PALETTE.surfaceD,
  'anic-border': PALETTE.borderD,
  'anic-border-strong': PALETTE.borderStrongD,
  'anic-row-border': PALETTE.rowBorderD,
  'anic-text': PALETTE.textD,
  'anic-text-strong': PALETTE.textStrongD,
  'anic-text-dim': PALETTE.textDimD,
  'anic-text-faint': PALETTE.textFaintD,
  'anic-pass': PALETTE.textPassD,
  'anic-fail': PALETTE.textFailD,
  'anic-doubt': PALETTE.textDoubtD,
  'anic-ok-text': PALETTE.textOkD,
  'anic-bad-text': PALETTE.textBadD,
  'anic-warn-text': PALETTE.textWarnD,
  'anic-ledger-text': PALETTE.textLedgerD,
  'anic-band-normal': PALETTE.bandNormalD,
  'anic-band-warn': PALETTE.bandWarnD,
  'anic-band-alarm': PALETTE.bandAlarmD,
  'anic-detail-surface': PALETTE.detailSurfaceD,
};

/**
 * 面板作用域选择器：令牌块只作用于本面板，**绝不写 `:root`**（见文件头注释）。
 */
export const TOKEN_SCOPE = '[data-anic-workflow]';

// 主题探测已拆至 shellTheme.ts（T3 单文件 ≤250 行）；此处转出，保持调用面不变。
export { resolveShellTheme, observeShellTheme, THEME_ATTRIBUTE, type ShellTheme } from './shellTheme.ts';

/**
 * 取令牌引用表达式：`var(--anic-pass, #2b823b)`。
 *
 * 内联 style 里**必须**用它而不是裸 `var(--anic-pass)`——宿主未注入变量时
 * 裸引用会让属性计算为无效值（颜色回退到 initial），组件看起来"没坏但没样式"。
 */
export function token(name: TokenName): string {
  return `var(--${name}, ${SEMANTIC[name]})`;
}

/**
 * 生成面板作用域的令牌块（挂载时一次性注入 head）。
 *
 * `color-scheme` 也随主题写在面板作用域内：让面板内的原生滚动条/表单控件
 * 跟随面板主题，而不是留一条与宿主相反的槽。
 */
export function tokenCssBlock(): string {
  const light = Object.entries(SEMANTIC).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  const dark = Object.entries(SEMANTIC_DARK).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  return [
    `${TOKEN_SCOPE} {`,
    '  color-scheme: light;',
    light,
    '}',
    `${TOKEN_SCOPE}[${THEME_ATTRIBUTE}='dark'] {`,
    '  color-scheme: dark;',
    dark,
    '}',
  ].join('\n');
}
