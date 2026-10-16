/**
 * 宿主主题探测与面板主题契约（P0-THEME-MISMATCH）。
 *
 * 从 `tokens.ts` 拆出（T3 单文件 ≤250 行）：本文件只回答"当前宿主是什么主题、
 * 主题变了怎么知道、面板用哪个属性承载它"，不持有任何调色板。
 *
 * 宿主契约（`app.asar` 内 theme-presenter 源码逐字确认）：
 * `apply(snapshot)` 依 `snapshot.active.colorScheme` 写
 * `documentElement.style.colorScheme`、`html[data-ds-theme-source]`
 * 与 `body[data-ds-dark-theme]`，**从不读 `prefers-color-scheme`**
 * （`system` 在更上游就解析成具体方案）。所以权威信号是 body 属性。
 */

/** 宿主解析后的主题（`light` / `dark`）。 */
export type ShellTheme = 'light' | 'dark';

/** 面板主题属性：由组件按 `resolveShellTheme()` 的结果写在面板根上。 */
export const THEME_ATTRIBUTE = 'data-anic-theme';

/** 宿主写在 body 上的暗色标记（权威信号）。 */
export const HOST_DARK_ATTRIBUTE = 'data-ds-dark-theme';

/**
 * 读宿主当前主题 —— **惰性求值，绝不缓存**。
 *
 * 修因（真实 P0，实机复现）：暗色令牌原先挂在
 * `@media (prefers-color-scheme: dark)`。实测宿主
 * `html[data-ds-theme-source=light]`、`body` 无 `data-ds-dark-theme`
 * （用户在设置里选了浅色），而操作系统是暗色 —— 媒体查询命中，面板套用暗色令牌，
 * 得到 `--anic-surface:#0f172a` 配宿主近黑文字色 `rgb(15, 17, 21)`，
 * **深底深字，几乎不可读**。OS 偏好 ≠ 宿主主题，二者必须解耦。
 *
 * 属性可能晚于 DOMContentLoaded 到达，因此每次调用都重新读（配合
 * `observeShellTheme` 订阅变化），与父工程 `PlatformProbe` 同一纪律。
 */
export function resolveShellTheme(): ShellTheme {
  try {
    if (typeof document === 'undefined') return 'light';
    return document.body?.hasAttribute(HOST_DARK_ATTRIBUTE) === true ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * 订阅宿主主题变化（用户在设置里切换时，宿主改的是 body 属性）。
 *
 * 返回 disposer。无 DOM / 无 MutationObserver（如 smoke 沙盒）时返回空函数，
 * 调用方无需分支。
 *
 * 只在**值真的变了**时回调：宿主每次 apply 都会重写一批内联变量，
 * 若不过滤，一次主题微调会触发多次无意义重渲染。
 */
export function observeShellTheme(onChange: (theme: ShellTheme) => void): () => void {
  try {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function' || !document.body) return () => undefined;
    let last = resolveShellTheme();
    const mo = new MutationObserver(() => {
      const next = resolveShellTheme();
      if (next === last) return;
      last = next;
      onChange(next);
    });
    mo.observe(document.body, { attributes: true, attributeFilter: [HOST_DARK_ATTRIBUTE] });
    return () => { mo.disconnect(); };
  } catch {
    return () => undefined;
  }
}
