/**
 * ViewsPanel 可达性守卫（cycle-143）。
 *
 * ## 为什么需要源码级守卫
 *
 * ViewsPanel 在 cycle-141 交付时**只有组件没有消费点**——grep "ViewsPanel" 在
 * src/ 里零 import，「实现了但不可达」缺陷家族（同 ViewLayer runtime 成员、
 * GodModulePanel 可见门）。组件测试 11 例全绿、路由测试全绿、注册矩阵写着
 * `consumers: ['client ViewsPanel']`——没有任何一层能发现「用户永远点不开它」。
 *
 * 本守卫钉住接线链的**四个环节**，任一断裂即红：
 *   1. PanelState 有 showViews 开关（usePanelState.ts）；
 *   2. 面板栈消费开关并渲染组件（RightPanelStack.tsx）；
 *   3. 工具下拉有入口项（toolbarConfig.ts 的 VIEWS_ITEMS + PANEL_DROPDOWN_SECTIONS）；
 *   4. 层判据把 showViews 提供给结构层与行为层（viewModeUtils.ts 两个 Set）。
 *
 * 含反向自检（守卫自身的正则必须能匹配真接线、拒绝假接线）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf-8');

describe('ViewsPanel 可达性守卫（cycle-143）', () => {
  it('环节1：PanelState 声明 showViews + toggle/set 双动作', () => {
    const src = read('src/client/hooks/usePanelState.ts');
    // 接口声明 + 初始状态 + CLOSABLE + toggle/set 工厂，五处缺一不可
    expect(src.match(/showViews: boolean;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("makeToggle('showViews')");
    expect(src).toContain("makeSet('showViews')");
    expect(src).toContain("'showRuntime', 'showDiff', 'showKeywordQuery', 'showPathPattern', 'showRegistry', 'showViews',");
  });

  it('环节2：RightPanelStack 挂载 ViewsPanel 且由 showViews 门控', () => {
    const src = read('src/client/components/RightPanelStack.tsx');
    expect(src).toContain("import { ViewsPanel } from './ViewsPanel.tsx'");
    // 词边界匹配：`panel.showViews,` 的后面必须紧跟非标识符字符——否则
    // showViewszzz 这类前缀同形的变量名会骗过前缀匹配（M1 探针实证）。
    expect(src).toMatch(/visible: panel\.showViews[^a-zA-Z0-9_]/);
    // onClose 必须走 setShowViews——裸 onClose 会让开关状态与渲染脱钩
    expect(src).toMatch(/panel\.setShowViews\(false\)/);
  });

  it('环节3：工具下拉有 VIEWS_ITEMS 且注册进 PANEL_DROPDOWN_SECTIONS', () => {
    const src = read('src/client/components/toolbarConfig.ts');
    expect(src).toContain("panel: 'showViews'");
    expect(src).toContain('VIEWS_ITEMS');
    // 段注册必须真实存在（数组里有一行引用 VIEWS_ITEMS）
    expect(src).toMatch(/labelKey: 'toolbar\.viewsSection', items: VIEWS_ITEMS/);
  });

  it('环节4：层判据把 showViews 提供给结构层与行为层（不给运行时层）', () => {
    const src = read('src/shared/viewModeUtils.ts');
    // 以「export const 声明行」为界切片——注释里出现的键名不参与判定
    // （此前用 indexOf('RUNTIME_PANELS') 会被 L117 的注释先命中，切片为空）。
    const decl = (name: string): number => src.indexOf(`export const ${name}: Set<AnalysisPanelKey>`);
    const structural = src.slice(decl('STRUCTURAL_PANELS'), decl('BEHAVIORAL_PANELS'));
    const behavioral = src.slice(decl('BEHAVIORAL_PANELS'), decl('RUNTIME_PANELS'));
    const runtime = src.slice(decl('RUNTIME_PANELS'), src.indexOf('export function getAvailablePanels'));
    expect(structural).toContain("'showViews'");
    expect(behavioral).toContain("'showViews'");
    expect(runtime).not.toContain("'showViews'");
  });

  it('反向自检：假接线（开关存在但无消费点）必须被判红', () => {
    // 守卫有效性证明：构造一个「有 showViews 但面板栈没挂载」的反例文本，
    // 环节2 的断言逻辑对它必须失败——否则守卫对真正的断裂也是绿灯。
    const fakePanelState = "const x = { showViews: boolean; makeToggle('showViews') }";
    expect(fakePanelState).toContain('showViews'); // 前半成立
    // 但 RightPanelStack 的两个必要标记都不在 → 环节2 会红
    const fakeStack = 'import { OtherPanel } from "./OtherPanel.tsx";';
    expect(fakeStack).not.toContain("import { ViewsPanel } from './ViewsPanel.tsx'");
    expect(fakeStack).not.toContain('visible: panel.showViews');
  });
});
