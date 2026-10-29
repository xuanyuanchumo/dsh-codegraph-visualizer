// 旅程覆盖：J19（FR-24 版本对比——工具栏入口的 i18n 词条契约）。
/**
 * i18n 词条完整性契约（cycle-104）。
 *
 * 缺陷形态（真机发现）：`toolbarConfig` 里新增一个工具项时，`key` 指向
 * `'toolbar.diff'`，但两份词典都没有这个键。`t()` 的兜底行为是**原样返回 key**，
 * 于是界面上直接渲染出 `toolbar.diff` 这个字符串——不抛错、不变红、所有既有测试
 * 依然全绿（`i18n.test.ts:82` 甚至有一条用例把这个兜底当作正确行为来断言）。
 *
 * 因此这里守三条，覆盖「新增入口但漏词条」这个具体失误：
 *   1. `toolbarConfig` 里每个 `ToolMenuItem.key` 都必须在 zh 与 en 两份词典里存在；
 *   2. `toolbarConfig` 里每个 `PANEL_DROPDOWN_SECTIONS.labelKey` 同理；
 *   3. 两份词典的**键集合**必须完全一致（缺一侧会让切换语言后显示原始键）。
 *
 * 第 3 条是双向的：只查「zh 的键都在 en 里」会漏掉「en 多了 zh 没有的键」——
 * 那在中文界面下就是同样的症状。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zh } from '../../src/client/i18n/dicts/zh.ts';
import { en } from '../../src/client/i18n/dicts/en.ts';
import { PANEL_DROPDOWN_SECTIONS, EXPORT_FORMATS } from '../../src/client/components/toolbarConfig.ts';

const ROOT = join(__dirname, '..', '..');
const TOOLBAR_CONFIG = join(ROOT, 'src', 'client', 'components', 'toolbarConfig.ts');
/** `AnalysisPanelKey` 联合声明的真源（cycle-111：白名单改为从这里反解）。 */
const VIEW_MODE_UTILS = join(ROOT, 'src', 'shared', 'viewModeUtils.ts');

describe('i18n dictionaries: key parity', () => {
  it('zh and en declare the same key set', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    const onlyZh = zhKeys.filter((k) => !(k in en));
    const onlyEn = enKeys.filter((k) => !(k in zh));
    expect(
      { onlyZh, onlyEn },
      '两份词典的键必须完全一致：缺一侧会在该语言下渲染出原始 key（t() 的兜底行为）',
    ).toEqual({ onlyZh: [], onlyEn: [] });
  });

  it('no dictionary value is an empty string', () => {
    // 空串会让界面显示空白，比显示原始 key 更难排查
    const emptyZh = Object.entries(zh).filter(([, v]) => v.trim() === '').map(([k]) => k);
    const emptyEn = Object.entries(en).filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect({ emptyZh, emptyEn }).toEqual({ emptyZh: [], emptyEn: [] });
  });
});

describe('toolbarConfig: every referenced key exists', () => {
  /** 收集 toolbarConfig 里所有会被 `t()` 消费的 key。 */
  function referencedKeys(): { kind: string; key: string }[] {
    const refs: { kind: string; key: string }[] = [];
    for (const section of PANEL_DROPDOWN_SECTIONS) {
      refs.push({ kind: 'section', key: section.labelKey });
      for (const item of section.items) refs.push({ kind: 'item', key: item.key });
    }
    for (const format of EXPORT_FORMATS) refs.push({ kind: 'export', key: format.key });
    return refs;
  }

  it('every section label and item key exists in both dictionaries', () => {
    const missing: string[] = [];
    for (const ref of referencedKeys()) {
      if (!(ref.key in zh)) missing.push(`${ref.kind} "${ref.key}" 缺 zh`);
      if (!(ref.key in en)) missing.push(`${ref.kind} "${ref.key}" 缺 en`);
    }
    expect(
      missing,
      'toolbarConfig 引用了词典里不存在的 key —— 界面会直接渲染出原始 key 字符串',
    ).toEqual([]);
  });

  it('the scan actually collected references (anti-vacuity)', () => {
    // 没有这条，`referencedKeys()` 返回空数组时上面的断言会永久变绿
    const refs = referencedKeys();
    expect(refs.length).toBeGreaterThan(10);
    expect(refs.some((r) => r.kind === 'section')).toBe(true);
    expect(refs.some((r) => r.kind === 'item')).toBe(true);
    expect(refs.some((r) => r.kind === 'export')).toBe(true);
  });

  it('every ToolMenuItem panel key is a known AnalysisPanelKey', () => {
    // 反向：`panel` 字段被拿去查 `availablePanels.has(panel)`，写错一个字母
    // 会让该工具项永远被过滤掉（段标题还在，内容空了）。
    //
    // ## cycle-111：这份清单从「手写白名单」改为「从联合类型反解」
    //
    // 旧版是一个手写的 `new Set([...18 个 key])`。它有两个方向的缺陷：
    //   · 新增一个 `AnalysisPanelKey` 时必须记得来这里加一行，否则守卫报红 —— 那不是
    //     "缺陷被抓住了"，而是"守卫需要人工同步"（本轮 `showKeywordQuery` 就是这种红）；
    //   · 更糟的反方向：手写清单**永远不会**自己变短，联合类型里删掉一个成员时它照旧通过 ——
    //     于是"这个 panel key 根本不存在"这类拼写错误只要拼进清单就永久免检。
    //
    // 改成从 `src/shared/viewModeUtils.ts` 的 `AnalysisPanelKey` 联合声明里反解成员：
    // 真源是类型定义本身，"新增/删除一个 panel"因此只需要改一处（类型），
    // 这条守卫自动跟上，且**两个方向**都成立。
    const viewModeUtils = readFileSync(VIEW_MODE_UTILS, 'utf8');
    const unionMatch = viewModeUtils.match(/export type AnalysisPanelKey\s*=([\s\S]*?);/);
    expect(unionMatch, '找不到 AnalysisPanelKey 联合声明（正则失效会让下面的断言恒绿）').toBeTruthy();
    const knownPanels = new Set(
      [...(unionMatch![1] ?? '').matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] ?? ''),
    );
    // 防空转：联合声明解析失败会让 `knownPanels` 为空，那样上面声明的每个 panel 都会
    // 被报成 unknown —— 失败原因从"源码漂移了"变成"守卫坏了"。先证明它真的读到了成员。
    expect(knownPanels.size, 'AnalysisPanelKey 解析出 0 个成员，说明解析器坏了').toBeGreaterThan(10);

    const source = readFileSync(TOOLBAR_CONFIG, 'utf8');
    const declared = new Set(
      [...source.matchAll(/panel:\s*'([a-zA-Z]+)'/g)].map((m) => m[1] ?? ''),
    );
    expect(declared.size).toBeGreaterThan(10);
    const unknown = [...declared].filter((p) => !knownPanels.has(p));
    expect(
      unknown,
      'toolbarConfig 里出现不是 AnalysisPanelKey 成员的 panel —— availablePanels.has(panel) 会永久为假，'
        + '该工具项永远被过滤掉（段标题还在、内容空了）',
    ).toEqual([]);

    // 反向自检：一个合成的、不在联合里的 panel key 必须被判红。
    // 样本用字符串拼接构造，避免扫描器扫到本文件自己的字面量（本仓踩过三次）。
    const fakePanel = 'show' + 'NotARealPanel';
    expect(knownPanels.has(fakePanel)).toBe(false);
    const synthetic = `const items = [{ panel: '${fakePanel}' }];`;
    const syntheticDeclared = [...synthetic.matchAll(/panel:\s*'([a-zA-Z]+)'/g)].map((m) => m[1] ?? '');
    expect(syntheticDeclared.filter((p) => !knownPanels.has(p))).toEqual([fakePanel]);

    // 另一半反向自检：`showKeywordQuery`（本轮新增）必须真的在联合里 —— 否则上面那条
    // "unknown = []" 会因为两边同时缺失而恒绿（这正是旧白名单最危险的退化形态）。
    expect(knownPanels.has('showKeywordQuery')).toBe(true);
    expect(declared.has('showKeywordQuery')).toBe(true);
  });
});
