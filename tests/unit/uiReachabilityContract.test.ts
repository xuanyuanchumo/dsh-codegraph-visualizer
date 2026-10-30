/**
 * UI 面可达性守卫（cycle-118 / §62.6 #9 收口）。
 *
 * 背景（§62.5(c) 现场）：`graph_query` 有完整工具面用例、在 `src/index.ts` 正常注册、
 * 三层可达性守卫（库自包含 / 死符号 / 工具注册）全绿——而客户端 **0 引用**。
 * 「实现完成 ≠ 交付完成」：一个能在 /tools 列出的能力，人点不到就等于没交付，
 * 且**没有任何现有测试会因此变红**。三层守卫没有一层扫 `src/client`。
 *
 * 本守卫补上第四层：**面板级可达性**。`RightPanelStack` / `LeftPanelStack` 里每个
 * `visible: panel.showXxx` 的面板，其 `showXxx` 必须满足以下入口之一：
 *   A. 工具栏面板下拉条目（`toolbarConfig.ts` 的 `panel: 'showXxx'`）；
 *   B. 「更多」菜单条目（`moreMenu.ts` 引用 `onToggleXxx` / `showXxx`）;
 *   C. 显式置位调用点（`src/` 里存在 `setShowXxx(true)` 的非面板栈调用——
 *      数据驱动型面板由分析动作/空态触发，不进下拉）。
 * 豁免表显式声明（每条 = 一次评审），豁免必须写「为什么人点不到是**有意**的」。
 *
 * 反向自检 + 文件集非空，家族惯例。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectTsFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

const allFiles = collectTsFiles(SRC);
const read = (p: string) => readFileSync(p, 'utf8');

const rightStack = read(join(SRC, 'client', 'components', 'RightPanelStack.tsx'));
const leftStack = read(join(SRC, 'client', 'components', 'LeftPanelStack.tsx'));
const toolbarConfig = read(join(SRC, 'client', 'components', 'toolbarConfig.ts'));
const moreMenu = read(join(SRC, 'client', 'components', 'toolbar', 'moreMenu.ts'));
// 「数据」下拉（ToolbarActions）：第四种入口形态，直接解构 panelControls 并渲染开关按钮。
const toolbarActions = read(join(SRC, 'client', 'components', 'toolbar', 'ToolbarActions.tsx'));

/** 面板栈中 visible 标志全集：`visible: panel.showXxx`（含 `?? false` 兜底形态）。 */
function extractPanelFlags(stackSource: string, label: string): string[] {
  const flags = [...stackSource.matchAll(/visible:\s*panel\.(show[A-Za-z]+)/g)].map((m) => m[1]!);
  if (flags.length === 0) throw new Error(`${label}: 面板栈解析为空——面板栈结构变了，守卫需同步`);
  return [...new Set(flags)];
}

const rightFlags = extractPanelFlags(rightStack, 'RightPanelStack');
const leftFlags = extractPanelFlags(leftStack, 'LeftPanelStack');

/**
 * 豁免表：每个条目 = 一次显式评审。理由必须写「人为什么**有意**点不到」。
 * 新面板默认不可豁免——先给入口，再谈豁免。
 */
const EXEMPTIONS: Record<string, string> = Object.freeze({
  // HotspotPanel 有 toolbarConfig 的 QUALITY_ITEMS 条目（showHotspot）——非豁免，示例见下。
  // （当前为空：cycle-118 实测全部面板均有入口。新增豁免 = 评审。）
});

function hasToolbarEntry(flag: string): boolean {
  return new RegExp(`panel:\\s*'${flag}'`).test(toolbarConfig);
}

function hasMoreMenuEntry(flag: string): boolean {
  // moreMenu 引用同一能力的形态：showXxx 或 onToggleXxx（onToggle 后缀去掉 show 前缀大小写转换）。
  const toggleName = 'onToggle' + flag.replace(/^show/, '');
  return moreMenu.includes(flag) || moreMenu.includes(toggleName);
}

function hasToolbarActionsEntry(flag: string): boolean {
  // ToolbarActions 的入口形态：`showXxx` 出现在解构（第 31 行形态）**且**同文件有
  // onClick 消费（`onToggleXxx()` 调用或 `setShowXxx(true)`），防止"解构了但没渲染"的半成品。
  const destructure = new RegExp(`\\b${flag}\\b`).test(toolbarActions);
  const consumed = new RegExp(`onToggle${flag.replace(/^show/, '')}\\s*\\(`).test(toolbarActions)
    || new RegExp(`set${flag}\\(\\s*true\\s*\\)`).test(toolbarActions);
  return destructure && consumed;
}

function hasExplicitSetTrue(flag: string): boolean {
  const setter = 'set' + flag;
  // 全 src 扫 `setShowXxx(true)`；面板栈自身的 onClose(setXxx(false)) 不算入口。
  const re = new RegExp(`\\.${setter}\\(\\s*true\\s*\\)`);
  return allFiles.some((f) => {
    const src = read(f);
    return re.test(src) && !f.replace(/\\/g, '/').includes('PanelStack');
  });
}

describe('ui reachability contract (cycle-118, §62.6 #9)', () => {
  it('每个面板栈 visible 标志都有可达入口（工具栏 / 更多菜单 / 显式置位）', () => {
    expect(allFiles.length).toBeGreaterThan(100); // 防空 walk 假绿
    expect(rightFlags.length + leftFlags.length).toBeGreaterThanOrEqual(18); // 面板栈非空退化
    const offenders: string[] = [];
    for (const flag of [...rightFlags, ...leftFlags]) {
      if (flag in EXEMPTIONS) continue;
      const entries = [
        hasToolbarEntry(flag) && 'toolbar',
        hasMoreMenuEntry(flag) && 'moreMenu',
        hasToolbarActionsEntry(flag) && 'toolbar-actions',
        hasExplicitSetTrue(flag) && 'explicit-set-true',
      ].filter(Boolean);
      if (entries.length === 0) {
        offenders.push(`${flag}: 无任何入口（工具栏/更多菜单/显式置位三缺一不可或豁免表登记）`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('豁免表不过度扩张（方向性：新豁免 = 显式评审，不做静默兜底）', () => {
    // 豁免的键必须真的存在于面板栈标志集合，防「豁免写错名 → 永不生效 → 面板静默失联」。
    const all = new Set([...rightFlags, ...leftFlags]);
    for (const key of Object.keys(EXEMPTIONS)) {
      expect(all.has(key), `豁免键 "${key}" 不在任何面板栈中（拼写漂移）`).toBe(true);
    }
  });

  it('反向自检：入口检测器对合成样本必须正确（防静默失效）', () => {
    // toolbarConfig 样本检测
    expect(new RegExp(`panel:\\s*'showFilterPanel'`).test('panel: \'showFilterPanel\'')).toBe(true);
    expect(new RegExp(`panel:\\s*'showNope'`).test("panel: 'showOther'")).toBe(false);
    // setter 检测（含 `?.` 与空格形态）
    expect(/\.setShowTour\(\s*true\s*\)/.test('panel.setShowTour(true)')).toBe(true);
    expect(/\.setShowTour\(\s*true\s*\)/.test('panel.setShowTour(false)')).toBe(false);
    // moreMenu 形态
    expect(moreMenu.includes('onToggleRegistry') || moreMenu.includes('showRegistry')).toBe(true);
  });

  it('面板栈与工具栏配置真实存在（防文件改名后守卫空转）', () => {
    expect(rightStack).toContain('RightPanelStack');
    expect(leftStack).toContain('LeftPanelStack');
    expect(toolbarConfig).toContain('ToolMenuItem');
  });
});
