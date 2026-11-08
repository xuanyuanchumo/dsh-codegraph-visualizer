/**
 * cycle-149 守卫：多选链路接线契约（防静默断裂）。
 *
 * ## 为什么需要源码形状守卫
 *
 * cycle-141 D 的多选是「注册✓（class 应用）/ 生产✓（回调触发）/ 消费✗（零调用方）」
 * 的死链路——行为测试全绿、功能从未可达（CLAUDE.md「The entry point exists is not
 * the entry point is reachable」家族）。本守卫钉死**每一跳**的接线形状，任何一跳
 * 被删（重构时最常见）即红：
 *
 *   InteractionController（集合+class+回调）
 *     → useGraphRenderer 转发           ← MS-GUARD-1
 *     → GraphPanel 传参到 store          ← MS-GUARD-2
 *   InteractionController.clearMultiSelect
 *     → IRenderer/CytoscapeRenderer 委托 ← MS-GUARD-3
 *     → BatchActionBar 清除按钮优先走它   ← MS-GUARD-3（GraphPanel 侧）
 *   ThemeStylesheet 视觉复活             ← MS-GUARD-4（dead-style 家族）
 *   i18n 双语键                          ← MS-GUARD-5
 *
 * 反向自检（reverse self-check）：负样本不得命中同一正则——否则守卫静默失效
 * （「broken regex stays green forever」）。文件集非空断言防扫描失败假绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(p, 'utf-8');

const WIRE = read('src/client/hooks/useGraphRenderer.ts');
const PANEL = read('src/client/GraphPanel.tsx');
const INTERACT = read('src/client/renderer/InteractionController.ts');
const IRENDERER = read('src/client/renderer/IRenderer.ts');
const CY_RENDERER = read('src/client/renderer/CytoscapeRenderer.ts');
const STYLES = read('src/client/renderer/styles/ThemeStylesheet.ts');
const ZH = read('src/client/i18n/dicts/zh.ts');
const EN = read('src/client/i18n/dicts/en.ts');

/** 10 个 batchbar 键（唯一真源：本数组；字典缺键即红）。 */
const BATCHBAR_KEYS = [
  'batchbar.ariaLabel', 'batchbar.count',
  'batchbar.expand', 'batchbar.expandAria',
  'batchbar.collapse', 'batchbar.collapseAria',
  'batchbar.export', 'batchbar.exportAria',
  'batchbar.clear', 'batchbar.clearAria',
];

describe('multiSelect wiring contract (cycle-149)', () => {
  const scannedFiles = [WIRE, PANEL, INTERACT, IRENDERER, CY_RENDERER, STYLES, ZH, EN];

  it('MS-GUARD-0 scan is non-empty (walk failure must not fake green)', () => {
    expect(scannedFiles.length).toBe(8);
    for (const content of scannedFiles) expect(content.length).toBeGreaterThan(100);
  });

  it('MS-GUARD-1 useGraphRenderer forwards onSelectionToggle AND onSelectionClear to callbacksRef', () => {
    // 转发行必须存在且指向 callbacksRef（直接传死值 = 重渲染后失效的假转发）
    expect(WIRE).toMatch(/onSelectionToggle: \(nodeId: string, selected: boolean, selectedIds: readonly string\[\]\) =>\s*\n?\s*callbacksRef\.current\.onSelectionToggle\?\./);
    expect(WIRE).toMatch(/onSelectionClear: \(\) => callbacksRef\.current\.onSelectionClear\?\./);
    // 类型声明同步存在
    expect(WIRE).toMatch(/onSelectionToggle\?\(nodeId: string, selected: boolean, selectedIds: readonly string\[\]\): void;/);
    expect(WIRE).toMatch(/onSelectionClear\?\(\): void;/);
  });

  it('MS-GUARD-2 GraphPanel passes onSelectionToggle/onSelectionClear and mounts BatchActionBar', () => {
    expect(PANEL).toMatch(/onSelectionToggle: \(_nodeId: string, _selected: boolean, selectedIds: readonly string\[\]\) => useGraphStore\.getState\(\)\.syncMultiSelection\(selectedIds\)/);
    expect(PANEL).toMatch(/onSelectionClear: \(\) => useGraphStore\.getState\(\)\.clearMultiSelection\(\)/);
    expect(PANEL).toMatch(/import \{ BatchActionBar \} from '\.\/components\/BatchActionBar\.tsx';/);
    expect(PANEL).toMatch(/<BatchActionBar onClearSelection=/);
  });

  it('MS-GUARD-3 clear path: InteractionController public method → IRenderer → CytoscapeRenderer delegation', () => {
    // InteractionController.clearMultiSelect 必须三件事一体（集合+class+回调）
    const method = INTERACT.match(/clearMultiSelect\(\): void \{[\s\S]*?\n  \}/);
    expect(method).not.toBeNull();
    expect(method![0]).toContain('multiSelectedIds.clear()');
    expect(method![0]).toContain("removeClass('multi-selected')");
    expect(method![0]).toContain('this.callbacks.onSelectionClear?.()');
    // 渲染器委托链两跳都存在
    expect(IRENDERER).toMatch(/clearMultiSelect\(\): void;/);
    expect(CY_RENDERER).toMatch(/clearMultiSelect\(\): void \{\s*\n?\s*this\.safeCallVoid\('clearMultiSelect', \(\) => this\.interactionCtrl\?\.clearMultiSelect\(\)\);/);
  });

  it('MS-GUARD-4 ThemeStylesheet resurrects both dead classes (multi-selected + canvas-focused)', () => {
    expect(STYLES).toMatch(/selector: 'node\.multi-selected'/);
    expect(STYLES).toMatch(/selector: 'node\.canvas-focused'/);
  });

  it('MS-GUARD-5 i18n: all batchbar keys present in BOTH dicts (key sets equal)', () => {
    for (const key of BATCHBAR_KEYS) {
      expect(ZH).toContain(`'${key}':`);
      expect(EN).toContain(`'${key}':`);
    }
  });

  // ---- 反向自检：负样本不得命中（守卫失效 = 永远绿的假守卫） ----

  it('reverse self-check: negative samples must NOT match the guards', () => {
    // 拼接构造，避免文件内出现可被自身扫描命中的连续形状（requireEscapeContract 同款手法）
    const NEG = 'onSelection' + 'Untoggle';
    const NEG_CALLBACK = 'onSelection' + 'Nuke?.()';
    expect(WIRE).not.toContain(NEG);
    expect(PANEL).not.toContain(NEG);
    expect(WIRE).not.toContain(NEG_CALLBACK);
    // 类型声明正则不得命中「只有可选调用、没有类型」的半残实现
    expect(WIRE).toMatch(/onSelectionToggle\?\(nodeId: string/); // 正样本自证正则活性
    const typeRe = /onSelectionToggle\?\(nodeId: string, selected: boolean, selectedIds: readonly string\[\]\): void;/;
    expect(typeRe.test('onSelectionToggle?(nodeId: string): void;')).toBe(false); // 半残形状被拒
    expect(typeRe.test(WIRE)).toBe(true); // 真实文件通过
    // batchbar 键守卫不得被「注释里提到键名」糊弄——注释形态（无冒号引号）不匹配
    expect(ZH).toMatch(/'batchbar\.count':/);
    expect(`// batchbar.count mentioned in a comment`).not.toMatch(/'batchbar\.count':/);
  });
});
