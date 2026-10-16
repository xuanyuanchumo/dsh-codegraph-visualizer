// @vitest-environment jsdom
/**
 * 宿主主题跟随契约（P0-THEME-MISMATCH）。
 *
 * 真实缺陷（实机复现，非假想）：令牌块的暗色层挂在
 * `@media (prefers-color-scheme: dark)` 上，于是"用户在设置里选了浅色主题、
 * 操作系统是暗色"这一常见组合会命中媒体查询、给面板套用暗色令牌
 * （`--anic-surface: #0f172a`），而宿主的文字色仍是浅色主题的近黑色
 * （实测 `rgb(15, 17, 21)`），**深底深字，整块面板几乎不可读**。
 *
 * 宿主契约（从 `app.asar` 内 theme-presenter 源码逐字确认）：
 * `apply(snapshot)` 依 `snapshot.active.colorScheme` 写
 * `documentElement.style.colorScheme`、`html[data-ds-theme-source]`
 * 与 `body[data-ds-dark-theme]`，**从不读 `prefers-color-scheme`**
 * （`system` 在更上游就解析成具体方案）。所以权威信号是 body 属性。
 *
 * 为什么用 jsdom 而不是手搓 stub：本契约的核心是「惰性读 + 订阅属性变化」，
 * 而 MutationObserver 的**异步投递**正是最容易写错的地方（同步断言会假绿）。
 * 手搓 stub 只能证明"我调用了它"，证不了"属性变化真的传达到回调"。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveShellTheme, observeShellTheme, THEME_ATTRIBUTE } from '../../src/shared/shellTheme.ts';
import { tokenCssBlock, TOKEN_SCOPE } from '../../src/shared/tokens.ts';

const DARK = 'data-ds-dark-theme';

/** 让 MutationObserver 的微任务投递落地（投递在微任务队列，不是同步）。 */
const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

describe('resolveShellTheme —— 读宿主解析后的主题，不读 OS 偏好', () => {
  beforeEach(() => { document.body.removeAttribute(DARK); });
  afterEach(() => { document.body.removeAttribute(DARK); });

  it('body 无 data-ds-dark-theme → light（宿主浅色主题）', () => {
    expect(resolveShellTheme()).toBe('light');
  });

  it('body 有 data-ds-dark-theme → dark', () => {
    document.body.setAttribute(DARK, '');
    expect(resolveShellTheme()).toBe('dark');
  });

  it('惰性求值：同一次会话内属性变化后立刻反映，不缓存', () => {
    expect(resolveShellTheme()).toBe('light');
    document.body.setAttribute(DARK, '');
    // 关键：没有重新挂载、没有订阅，也必须读到新值。
    // 若实现里缓存了初始值，这里会读回 'light'。
    expect(resolveShellTheme()).toBe('dark');
    document.body.removeAttribute(DARK);
    expect(resolveShellTheme()).toBe('light');
  });

  it('属性值内容不影响判定（宿主写的是空串）', () => {
    document.body.setAttribute(DARK, '');
    expect(resolveShellTheme()).toBe('dark');
    document.body.setAttribute(DARK, 'dark');
    expect(resolveShellTheme()).toBe('dark');
  });

  it('反向自检：判定真的读的是 body 属性，而不是别的信号', () => {
    // 设一个长得很像但不同的属性，必须**不**被当成暗色。
    document.body.setAttribute('data-ds-theme-source', 'dark');
    expect(resolveShellTheme()).toBe('light');
    document.body.removeAttribute('data-ds-theme-source');
  });
});

describe('observeShellTheme —— 订阅宿主主题切换', () => {
  beforeEach(() => { document.body.removeAttribute(DARK); });
  afterEach(() => { document.body.removeAttribute(DARK); });

  it('属性加上后回调收到 dark（MutationObserver 异步投递）', async () => {
    const seen: string[] = [];
    const dispose = observeShellTheme((t) => { seen.push(t); });
    document.body.setAttribute(DARK, '');
    await flush();
    dispose();
    expect(seen).toEqual(['dark']);
  });

  it('属性移除后回调收到 light', async () => {
    document.body.setAttribute(DARK, '');
    const seen: string[] = [];
    const dispose = observeShellTheme((t) => { seen.push(t); });
    document.body.removeAttribute(DARK);
    await flush();
    dispose();
    expect(seen).toEqual(['light']);
  });

  it('主题未变化时不重复回调（避免每次属性扰动都触发重渲染）', async () => {
    const seen: string[] = [];
    const dispose = observeShellTheme((t) => { seen.push(t); });
    // 写同值 / 写无关属性：都不应产生回调
    document.body.setAttribute(DARK, '');
    await flush();
    document.body.setAttribute(DARK, '');
    document.body.setAttribute('data-unrelated', 'x');
    await flush();
    document.body.removeAttribute('data-unrelated');
    dispose();
    expect(seen).toEqual(['dark']);
  });

  it('disposer 之后不再回调（防止卸载后写入已销毁组件）', async () => {
    const seen: string[] = [];
    const dispose = observeShellTheme((t) => { seen.push(t); });
    dispose();
    document.body.setAttribute(DARK, '');
    await flush();
    expect(seen).toEqual([]);
  });

  it('无 DOM 环境（smoke 沙盒）返回可用 disposer 而非抛错', () => {
    const realDoc = globalThis.document;
    // @ts-expect-error 故意移除，模拟 smoke 的 stub 全局
    delete globalThis.document;
    try {
      const dispose = observeShellTheme(() => undefined);
      expect(typeof dispose).toBe('function');
      expect(() => { dispose(); }).not.toThrow();
      expect(resolveShellTheme()).toBe('light');
    } finally {
      globalThis.document = realDoc;
    }
  });
});

describe('tokenCssBlock —— 面板作用域 + 宿主主题驱动的暗色层', () => {
  const css = tokenCssBlock();

  it('作用域是面板容器，不是 :root', () => {
    expect(css).toContain(`${TOKEN_SCOPE} {`);
    expect(css).not.toMatch(/^\s*:root\s*\{/m);
  });

  it('暗色层由主题属性选择器驱动', () => {
    expect(css).toContain(`[${THEME_ATTRIBUTE}='dark']`);
  });

  it('不再出现 OS 媒体查询（这正是缺陷本体）', () => {
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('两个主题各自声明 color-scheme（面板内原生控件跟随面板主题）', () => {
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('color-scheme: dark');
  });

  it('暗色层覆盖了在暗底上会失效的语义令牌，且不是空块', () => {
    const darkBlock = css.slice(css.indexOf(`[${THEME_ATTRIBUTE}='dark']`));
    for (const name of ['anic-surface', 'anic-text', 'anic-border', 'anic-detail-surface']) {
      expect(darkBlock).toContain(`--${name}:`);
    }
    // 反向：亮色层也必须真的存在（否则两个选择器写反了也照样"包含"）
    const lightBlock = css.slice(0, css.indexOf(`[${THEME_ATTRIBUTE}='dark']`));
    expect(lightBlock).toContain('--anic-surface:');
  });

  it('反向自检：作用域断言能识别出 :root 形态的回归', () => {
    // 把块还原成旧形态，上面两条断言必须能抓到 —— 否则守卫是永久绿的。
    const regressed = [':root {', '  color-scheme: light dark;', '  --anic-surface: #f8fafc;', '}', '@media (prefers-color-scheme: dark) {', '  :root {', '    --anic-surface: #0f172a;', '  }', '}'].join('\n');
    expect(regressed).toMatch(/^\s*:root\s*\{/m);
    expect(regressed).toContain('prefers-color-scheme');
    expect(regressed).not.toContain(`[${THEME_ATTRIBUTE}='dark']`);
    expect(css).not.toContain('light dark');
  });
});
