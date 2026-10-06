/**
 * 宿主载体判别：网页端（浏览器）与桌面端（Electron 外壳）。
 *
 * 为什么需要单独一个模块：DSH **没有**提供任何「我在桌面端」的服务或环境变量 ——
 * 全机 asar 树 grep `process.versions.electron` 零命中，`dsh-client-modules` 只接受
 * `dsh.client.platform === 'web'`（`lib/index.js:714`），`DSH_*` 环境变量只在**宿主**
 * 侧可见（`dsh-shell-env/lib/index.js:84-94` 的 `collect()` 只写 shell 工具执行的环境
 * 覆盖层，浏览器半读不到）。唯一权威信号是 Electron preload 写在 `<html>` 上的 DOM 标记，
 * 见 `@deepseek-ai/dsh-client-ui-primitives/lib/types/darwin-desktop.d.ts` 的逐字说明：
 *
 *   「Whether the client runs in the macOS desktop shell: the Electron preload marks
 *     `<html>` with `data-platform="darwin"`; plain web never sets it. **Read at render
 *     time — the mark may arrive as late as DOMContentLoaded.**」
 *
 * 因此本模块**必须惰性求值**：不能在 `apply()` 时刻读一次就永久缓存，否则在 preload
 * 晚于插件激活时会永远把桌面端误判为网页端。`dsh-client-ui-layout/lib/client.js:240-241`
 * 的官方用法正是每次渲染时读取：
 *
 *   const darwin = document.documentElement.dataset.platform === "darwin";
 *   const collapsedWidth = darwin || document.documentElement.hasAttribute("data-windows-titlebar") ? 0 : 56;
 *
 * 历史教训：本项目曾用 `ctx.get('desktopProfiles')` 判定桌面端。该键**不是 cordis 服务**
 * （全机零 `provide`；仅 `dshmarket/lib/index.js:34` 提及，且其自带注释写明
 * 「no flag, no `desktopProfiles` service either」），故该判定恒为 false。cycle-83 清除。
 */

/**
 * 载体种类。
 *
 * 刻意**没有** `desktop-linux` 之类的成员：DSH 的 Electron preload 只写
 * `data-platform="darwin"` 与 `data-windows-titlebar` 两种标记（见文件头引用），
 * Linux 桌面外壳不写任何标记，因此在插件侧与网页端**不可区分**。与其加一个永远
 * 产生不出来的枚举成员（那正是本轮清除的幻影叙事），不如让这种情况落进 `web`，
 * 并把「不可区分」写进这里。
 */
export type HostCarrier = 'web' | 'desktop-darwin' | 'desktop-windows';

export interface HostPlatformInfo {
  carrier: HostCarrier;
  /** 是否运行在桌面（Electron）外壳内。 */
  isDesktop: boolean;
  /**
   * `@linxin666/dsh-remote-web-ui` 的窄屏适配是否已激活。
   *
   * 该插件的唯一可靠激活信号是它自己写的 DOM 标记（`lib/client.js:4155` 的
   * `ACTIVE_CLASS = "dsh-remote-portrait"`、`:4368` 的 `body.classList.add(ACTIVE_CLASS)`，
   * 以及 `:4153`/`:4167` 的 `style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]`）。
   * 它**不提供任何 panel/tab 注册 API**，所以本项目与它的关系只能是「识别 + 让版面适配」，
   * 而不是「调用它的 API」—— 这是对既有 `remoteWebUI` 幻影集成的替代。
   */
  isRemoteNarrow: boolean;
}

/** 远程窄屏插件写入的 body class（`@linxin666/dsh-remote-web-ui` `lib/client.js:4155`）。 */
const REMOTE_ACTIVE_CLASS = 'dsh-remote-portrait';
/** 远程窄屏插件写入的 `<style>` 选择器（同文件 `:4153`/`:4167`）。 */
const REMOTE_STYLE_SELECTOR = 'style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]';

/** `typeof document === 'undefined'` 的宿主（SSR / 单测）一律按网页端处理。 */
function rootElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement ?? null;
}

/**
 * 读取当前载体。**每次调用都重新读取 DOM**，不做缓存 —— 见文件头关于
 * 「标记可能晚到 DOMContentLoaded」的说明。
 */
export function detectHostPlatform(): HostPlatformInfo {
  const root = rootElement();
  const isDarwin = root?.dataset.platform === 'darwin';
  const isWindowsTitlebar = root?.hasAttribute('data-windows-titlebar') === true;

  let isRemoteNarrow = false;
  try {
    if (typeof document !== 'undefined') {
      isRemoteNarrow =
        document.body?.classList.contains(REMOTE_ACTIVE_CLASS) === true ||
        document.querySelector(REMOTE_STYLE_SELECTOR) !== null;
    }
  } catch { /* 受限 DOM（如测试桩）按未激活处理 */ }

  let carrier: HostCarrier;
  if (isDarwin) carrier = 'desktop-darwin';
  else if (isWindowsTitlebar) carrier = 'desktop-windows';
  else carrier = 'web';

  return {
    carrier,
    isDesktop: isDarwin || isWindowsTitlebar,
    isRemoteNarrow,
  };
}

/**
 * 订阅载体标记的出现。
 *
 * Electron preload 可能晚于插件激活才写入 `<html>`，而 `MutationObserver` 是唯一
 * 能在标记到达时收到通知的机制。返回 disposer；无 DOM 时是空操作。
 *
 * 这里刻意**不**在回调里缓存结果：回调只是「现在可以重读」的信号，真值始终由
 * {@link detectHostPlatform} 现读现取。
 */
export function observeHostPlatform(listener: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => { /* 无 DOM：无需观察 */ };
  }
  const root = document.documentElement;
  if (!root) return () => { /* 文档尚未就绪 */ };

  const observer = new MutationObserver(() => listener());
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-platform', 'data-windows-titlebar'],
  });
  return () => observer.disconnect();
}
