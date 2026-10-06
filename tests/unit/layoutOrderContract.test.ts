import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { LAYOUT_ORDER } from '../../src/shared/viewModeUtils.ts';

/**
 * 契约守卫：**布局顺序只能有一份权威表**（cycle-84 / Round 20）。
 *
 * ## 为什么需要这条守卫
 *
 * 收敛之前，同一份 7 项布局列表在仓库里有 **4 份互相独立的副本**：
 * 工具栏下拉（`src/client/components/toolbarConfig.ts`）、斜杠命令循环
 * （`src/client/integrations/CommandUiIntegration.ts`）、持久化迁移校验
 * （`src/client/store/graphStore.ts` 的 `migrate`）、键盘快捷键循环
 * （`src/client/hooks/usePanelKeyboard.ts`）。
 *
 * 四份副本**同序**，所以任何一次「新增一种布局」都要记得改 4 处，而漏改的后果
 * 全是静默的：工具栏能选到、斜杠命令循环永远跳过它、持久化把它当脏值回退成
 * `cose`、键盘 `Ctrl+L` 永远轮不到。**没有任何一条既有测试会因此变红** —— 这正是
 * 需要源码守卫而不是行为测试的原因：行为测试只能证明被调用到的那条路径自洽，
 * 证明不了「不存在第 5 份副本」。
 *
 * ## 检查什么
 *
 * 1. 权威表本身的内容与顺序（`cose` 必须第一：`migrate` 的兜底值依赖它）。
 * 2. 全仓 `src/**` 里**不得再出现**任何「4 项以上布局名字面量数组」，
 *    唯一豁免是权威表自己的定义处。
 * 3. 四个已知消费方都必须**引用** `LAYOUT_ORDER`，而不是各自再写一遍。
 *
 * ## 与 `serviceKeyContract.test.ts` 相同的坑
 *
 * 必须先剥掉整行注释：本文件与源码里都有大量散文在解释「原先此处有第 N 份副本」，
 * 不剥注释就会把这些**教学性引用**误判成真实副本，守卫会永远红。
 */

const ROOT = path.resolve(__dirname, '../..');

/** 剥掉整行注释与块注释起始行，使散文中提到的布局名不参与匹配。 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(
      (line) =>
        !line.trim().startsWith('//') &&
        !line.trim().startsWith('*') &&
        !line.trim().startsWith('/*'),
    )
    .join('\n');
}

function collectSources(dir: string): Array<{ rel: string; code: string }> {
  const out: Array<{ rel: string; code: string }> = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
        const raw = fs.readFileSync(full, 'utf8');
        out.push({ rel: path.relative(ROOT, full).replace(/\\/g, '/'), code: codeOnly(raw) });
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

/**
 * 匹配「4 项以上布局名字面量数组」。
 *
 * 门槛取 4 而不是 7，是为了让**部分副本**也现形：把 7 项抄成 5 项同样是副本，
 * 而且更难被发现。`+` 至少匹配 4 个「元素 + 逗号」，尾随逗号与跨行都容许
 * （权威表自己就是跨行 + 尾随逗号的写法）。
 */
const LAYOUT_LIST_LITERAL =
  /\[\s*(?:'(?:cose|fcose|dagre|circle|grid|radial|tree)'\s*,\s*){3,}'(?:cose|fcose|dagre|circle|grid|radial|tree)'\s*,?\s*\]/g;

/** 权威表自身的定义处，也是唯一允许出现字面量列表的文件。 */
const SSOT_FILE = 'src/shared/viewModeUtils.ts';

/** 必须引用权威表、不得自建副本的消费方（路径 → 说明）。 */
const CONSUMERS: ReadonlyArray<readonly [string, string]> = [
  ['src/client/components/toolbarConfig.ts', '工具栏布局下拉'],
  ['src/client/integrations/CommandUiIntegration.ts', '斜杠命令 codegraph-layout'],
  ['src/client/store/graphStore.ts', '持久化 migrate 校验'],
  ['src/client/hooks/usePanelKeyboard.ts', 'Ctrl+L 键盘循环'],
];

describe('layout order contract', () => {
  it('exposes the authoritative order with cose first', () => {
    // 顺序即 UI 呈现顺序、键盘循环顺序、命令循环顺序。
    // `cose` 必须第一：`graphStore.migrate` 的脏值兜底写的就是它。
    expect(LAYOUT_ORDER).toEqual(['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree']);
    expect(LAYOUT_ORDER[0]).toBe('cose');
    // 顺序去重：重复项会让键盘循环原地踏步。
    expect(new Set(LAYOUT_ORDER).size).toBe(LAYOUT_ORDER.length);
  });

  it('keeps the authoritative table frozen against accidental reordering', () => {
    // 只读视图：运行期任何 `LAYOUT_ORDER[0] = ...` 都必须失败。
    // （`as const` 的 `readonly` 只在编译期生效，这里补一道运行期保险。）
    expect(Object.isFrozen(LAYOUT_ORDER)).toBe(true);
  });

  it('has exactly one layout-order literal in src/ (the SSOT itself)', () => {
    const offenders: string[] = [];
    for (const { rel, code } of collectSources('src')) {
      if (rel === SSOT_FILE) continue;
      for (const match of code.matchAll(LAYOUT_LIST_LITERAL)) {
        offenders.push(`${rel}: ${match[0].replace(/\s+/g, ' ')}`);
      }
    }
    // 失败信息要直接点名文件与那段字面量，而不是只说「有 1 处违规」。
    expect(offenders).toEqual([]);
  });

  it('does find the literal inside the SSOT (the guard is not vacuous)', () => {
    // 反向自检：如果正则写错了（例如转义漏了、字符类写窄了），上一条会永远绿。
    // 这里断言它**确实**能在权威表里命中，否则上一条的「零命中」毫无意义。
    const ssot = collectSources('src').find((s) => s.rel === SSOT_FILE);
    expect(ssot).toBeDefined();
    const hits = [...ssot!.code.matchAll(LAYOUT_LIST_LITERAL)];
    expect(hits.length).toBe(1);
  });

  it('actually catches a reverted copy (the cycle-84 regression shape)', () => {
    // 把「回退成副本」这个真实回归形态直接喂给正则。
    const reverted = "const valid: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];";
    expect([...reverted.matchAll(LAYOUT_LIST_LITERAL)].length).toBe(1);

    // 部分副本（7 项抄成 4 项）也必须现形 —— 门槛取 4 的理由。
    const partial = "const order: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle'];";
    expect([...partial.matchAll(LAYOUT_LIST_LITERAL)].length).toBe(1);

    // 3 项以下不算副本（避免把「默认值 + 两个备选」这类合理写法误伤）。
    const tooShort = "const fallbacks: LayoutType[] = ['cose', 'grid', 'circle'];";
    expect([...tooShort.matchAll(LAYOUT_LIST_LITERAL)].length).toBe(0);

    // 单个元素、非数组上下文都不算。
    expect([...`layout: 'cose'`.matchAll(LAYOUT_LIST_LITERAL)].length).toBe(0);
  });

  it('makes every known consumer reference the authoritative table', () => {
    const missing: string[] = [];
    for (const [rel, why] of CONSUMERS) {
      const source = codeOnly(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      if (!/LAYOUT_ORDER/.test(source)) missing.push(`${rel} (${why})`);
    }
    expect(missing).toEqual([]);
  });

  it('does find LAYOUT_ORDER in the SSOT itself (the consumer check is not vacuous)', () => {
    // 同上：先证明「找 LAYOUT_ORDER」这件事在已知为真的文件上成立。
    const source = codeOnly(fs.readFileSync(path.join(ROOT, SSOT_FILE), 'utf8'));
    expect(/LAYOUT_ORDER/.test(source)).toBe(true);
    // 反向：一个必然不含它的文件必须报 false，否则 /LAYOUT_ORDER/ 是空匹配。
    expect(/LAYOUT_ORDER/.test(codeOnly("const x = ['cose', 'grid'];"))).toBe(false);
  });
});
