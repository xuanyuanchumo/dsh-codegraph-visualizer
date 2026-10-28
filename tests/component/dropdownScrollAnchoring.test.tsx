/**
 * @vitest-environment jsdom
 *
 * 下拉浮层的「不漂移」契约（cycle-110 / T3 验收项：`position: fixed` + 滚动监听 `capture: true`）。
 *
 * 历史缺陷（`CLAUDE.md` 里记过）：`Dropdown` 用 `trigger.getBoundingClientRect()` 取**视口坐标**、
 * 内容用 `position: fixed` 渲染，但只监听 `resize`。于是页面（或 DSH 会话面板这个**滚动祖先**）
 * 一滚动，触发器走了、菜单留在原地：实测向下滚 100px 后间距从 6px 变成 106px。
 *
 * 关键点是 `capture: true`：滚动祖先的 `scroll` 事件**不冒泡**到 window，
 * 只有捕获阶段才收得到。所以本文件用「在内层元素上派发 scroll（bubbles: false）」
 * 来验证监听真的挂在捕获阶段——把 `true` 去掉，这条用例必然变红。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Dropdown } from '../../src/client/components/Dropdown.tsx';

const dropdownSource = readFileSync(
  join(process.cwd(), 'src', 'client', 'components', 'Dropdown.tsx'),
  'utf8',
);
const layoutCss = readFileSync(
  join(process.cwd(), 'src', 'client', 'styles', 'layout.css'),
  'utf8',
);

const originalRaf = globalThis.requestAnimationFrame;

beforeEach(() => {
  // rAF 合并是性能优化，不是被测语义：让回调同步执行，断言才好写
  (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
    ((cb: FrameRequestCallback) => { cb(0); return 1; }) as unknown as typeof requestAnimationFrame;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = originalRaf;
  vi.restoreAllMocks();
  document.querySelectorAll('.cg-scroll-ancestor').forEach((el) => el.remove());
});

function makePanel(width: number): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'cg-graph-panel';
  Object.defineProperty(panel, 'clientWidth', { configurable: true, value: width });
  panel.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 600, width, height: 600 }) as DOMRect;
  document.body.appendChild(panel);
  return panel;
}

function renderDropdown(panel: HTMLElement) {
  return render(
    <Dropdown
      triggerClassName="cg-test-trigger"
      triggerTitle="Test"
      triggerAriaLabel="Test"
      triggerContent={<span>x</span>}
      portalTarget={panel}
    >
      <button>item</button>
    </Dropdown>,
    { container: panel },
  );
}

describe('下拉浮层的滚动跟随', () => {
  it('re-measures when a scrolling ANCESTOR scrolls (capture-phase listener)', () => {
    const panel = makePanel(900);
    renderDropdown(panel);

    fireEvent.click(panel.querySelector('.cg-test-trigger') as HTMLElement);
    const content = panel.querySelector('.cg-dropdown-content') as HTMLElement;
    expect(content).toBeTruthy();
    // 首次测量：触发器 rect 全 0 ⇒ top = 0 + 6
    expect(content.style.getPropertyValue('--cg-portal-top')).toBe('6px');

    // 触发器在视口里挪了位置（等价于视口滚动），随后滚动祖先发出 scroll。
    // bubbles: false 是关键：只有捕获阶段的监听能收到它。
    const trigger = panel.querySelector('.cg-test-trigger') as HTMLElement;
    trigger.getBoundingClientRect = () =>
      ({ left: 10, top: 400, right: 60, bottom: 430, width: 50, height: 30 }) as DOMRect;

    const scroller = document.createElement('div');
    scroller.className = 'cg-scroll-ancestor';
    panel.appendChild(scroller);
    fireEvent.scroll(scroller, { bubbles: false });

    expect(content.style.getPropertyValue('--cg-portal-top')).toBe('436px');
  });

  it('also re-measures on window resize', () => {
    const panel = makePanel(900);
    renderDropdown(panel);
    fireEvent.click(panel.querySelector('.cg-test-trigger') as HTMLElement);
    const content = panel.querySelector('.cg-dropdown-content') as HTMLElement;

    const trigger = panel.querySelector('.cg-test-trigger') as HTMLElement;
    trigger.getBoundingClientRect = () =>
      ({ left: 0, top: 200, right: 50, bottom: 230, width: 50, height: 30 }) as DOMRect;
    fireEvent(window, new Event('resize'));

    expect(content.style.getPropertyValue('--cg-portal-top')).toBe('236px');
  });

  it('uses the capture flag on BOTH add and remove (no leaking listener)', () => {
    // 源码守卫：`remove` 少了 `true` 就撤不掉捕获阶段监听，组件卸载后仍在测量
    expect(dropdownSource).toMatch(/addEventListener\('scroll',\s*onScroll,\s*true\)/);
    expect(dropdownSource).toMatch(/removeEventListener\('scroll',\s*onScroll,\s*true\)/);
    // 反向自检：去掉 capture 的写法必须不匹配（否则正则只匹配了 'scroll' 这个词）
    const withoutCapture = "window.addEventListener('scroll', onScroll);";
    expect(/addEventListener\('scroll',\s*onScroll,\s*true\)/.test(withoutCapture)).toBe(false);
  });

  it('positions the portalled content with position: fixed in the stylesheet', () => {
    // 内容 portal 到 body 后用 absolute 会相对最近的定位祖先定位；必须 fixed + 视口坐标
    const rule = /\.cg-dropdown-content\s*\{([^}]*)\}/.exec(layoutCss);
    expect(rule).toBeTruthy();
    const body = rule![1] ?? '';
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/--cg-portal-left/);
    expect(body).toMatch(/--cg-portal-top/);
  });
});

describe('窄面板抽屉不被容器裁剪', () => {
  it('switches to the drawer form and writes bottom-anchored variables', () => {
    const panel = makePanel(300);
    panel.getBoundingClientRect = () =>
      ({ left: 40, top: 100, right: 340, bottom: 700, width: 300, height: 600 }) as DOMRect;
    renderDropdown(panel);

    fireEvent.click(panel.querySelector('.cg-test-trigger') as HTMLElement);
    const content = panel.querySelector('.cg-dropdown-content') as HTMLElement;
    expect(content.className).toContain('cg-portal-drawer');
    // 抽屉形态：宽度算出来、贴底、top 让位
    expect(content.style.getPropertyValue('--cg-portal-width')).toBe('292px');
    expect(content.style.getPropertyValue('--cg-portal-bottom')).toBe('72px');
    expect(content.style.getPropertyValue('--cg-portal-top')).toBe('auto');
  });
});
