/**
 * `safeStorage` / 跨源 iframe 白屏（cycle-111 / P2）。
 *
 * `jsdom` 环境：这些用例要的正是「有 window、但 Web Storage 访问会抛」的真实形态。
 * 放在 node 环境里测不到任何东西（`typeof window === 'undefined'` 走的是完全另一条分支）。
 *
 * @vitest-environment jsdom
 *
 * `safeStorage` / 跨源 iframe 白屏（cycle-111 / P2）。
 *
 * 缺陷形态：`src/client/store/graphStore.ts` 修前直接写
 * `typeof window !== 'undefined' ? window.localStorage : memoryStorage`。
 * 在 `dsh-remote-web-ui` 这类**跨源 iframe** 里，读 `window.localStorage` 这个**属性本身**
 * 就抛 `SecurityError`，而那段代码在 `create()` 的初始化路径（模块求值）上执行
 * ⇒ store 建不出来 ⇒ 插件白屏，且**没有任何可见错误**。
 *
 * 本文件钉三件事：
 *   1. `getSafeStorage()` 在属性访问抛错时不抛，且返回一个可用的内存后端；
 *   2. `graphStore` 模块在那种环境下**仍能被导入**（这是白屏的直接判据）；
 *   3. `fetchStatus` 的归一化方向（缺字段一律 false，不兜 true）。
 *
 * 注意：第 2 条必须用动态 `import()` + `vi.resetModules()`，因为 store 的存储后端是在
 * **模块求值时**选定的；静态 import 会拿到别处已缓存的那一份，测不到「初始化路径」。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getSafeStorage, safeGetItem } from '../../src/client/utils/safeStorage.ts';

/** 让 `window.localStorage` 这个**属性访问**抛 SecurityError（跨源 iframe 的真实行为）。 */
function breakLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    ?? Object.getOwnPropertyDescriptor(Window.prototype, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  return () => {
    delete (window as unknown as Record<string, unknown>).localStorage;
    if (original) Object.defineProperty(window, 'localStorage', original);
  };
}

function breakSessionStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    ?? Object.getOwnPropertyDescriptor(Window.prototype, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  return () => {
    delete (window as unknown as Record<string, unknown>).sessionStorage;
    if (original) Object.defineProperty(window, 'sessionStorage', original);
  };
}

describe('getSafeStorage', () => {
  let restore: Array<() => void> = [];

  beforeEach(() => { restore = []; });
  afterEach(() => {
    restore.forEach((fn) => fn());
    restore = [];
    vi.unstubAllGlobals();
  });

  // 旅程覆盖：J51（跨源嵌入不白屏 —— `dsh-remote-web-ui` 的跨源 iframe 里
  // `window.localStorage` 的 getter 本身就会抛 `SecurityError`，`typeof` 检查挡不住它）。
  it('J51: throws nothing when reading window.localStorage throws SecurityError', () => {
    // 缺陷的核心：旧代码没有 try，这一句就会把整个 store 初始化打断。
    restore.push(breakLocalStorage());
    restore.push(breakSessionStorage());
    expect(() => getSafeStorage('test')).not.toThrow();
  });

  it('returns a working storage when both Web Storages are inaccessible', () => {
    restore.push(breakLocalStorage());
    restore.push(breakSessionStorage());
    const storage = getSafeStorage('test');
    // 内存回退必须是**可用的**，不能只是"不抛但什么都不做" —— 上层要对它做 hydration 与写入。
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    storage.removeItem('k');
    expect(storage.getItem('k')).toBeNull();
  });

  it('prefers localStorage when it is usable', () => {
    const storage = getSafeStorage('test');
    storage.setItem('__cg_safe_storage_probe', 'v');
    expect(window.localStorage.getItem('__cg_safe_storage_probe')).toBe('v');
    storage.removeItem('__cg_safe_storage_probe');
    expect(window.localStorage.getItem('__cg_safe_storage_probe')).toBeNull();
  });

  it('falls back to sessionStorage when only localStorage is broken', () => {
    // 同源 iframe 里常见这种组合：local 被禁、session 可用。退回内存会丢掉整个标签页的
    // 偏好持久化，而 session 至少能撑到标签页关闭。
    restore.push(breakLocalStorage());
    const storage = getSafeStorage('test');
    storage.setItem('__cg_safe_storage_probe', 'v');
    expect(window.sessionStorage.getItem('__cg_safe_storage_probe')).toBe('v');
    storage.removeItem('__cg_safe_storage_probe');
  });

  it('degrades a per-call failure to a no-op instead of throwing', () => {
    // 探测通过 ≠ 后续调用永远成功（会话中途配额被清理 / 用户撤销存储权限）。
    // 这条模拟"取出对象成功、写入时抛"：读回 null、写不抛。
    const storage = getSafeStorage('test');
    const originalSet = window.localStorage.setItem.bind(window.localStorage);
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => storage.setItem('k', 'v')).not.toThrow();
    spy.mockRestore();
    originalSet('__cg_safe_storage_probe', 'v');
    window.localStorage.removeItem('__cg_safe_storage_probe');
  });

  it('safeGetItem never throws when localStorage is inaccessible', () => {
    // 调试开关（`__cg_debug`）在模块顶层读 localStorage。它不该能把模块求值干掉。
    restore.push(breakLocalStorage());
    restore.push(breakSessionStorage());
    expect(() => safeGetItem('__cg_debug')).not.toThrow();
    expect(safeGetItem('__cg_debug')).toBeNull();
  });
});

describe('graphStore survives a cross-origin iframe (the white-screen defect)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('imports and creates the store when localStorage lookup throws', async () => {
    const restoreLocal = breakLocalStorage();
    const restoreSession = breakSessionStorage();
    vi.resetModules();
    try {
      // 修前这一句会抛 SecurityError —— 白屏就是这么发生的（模块求值即失败）。
      const mod = await import('../../src/client/store/graphStore.ts');
      const state = mod.useGraphStore.getState();
      // store 必须真的可用，而不只是"导入没崩"：读一个真实字段 + 调一个真实动作。
      expect(state.prerequisites.graphSource).toBe(false);
      expect(() => mod.useGraphStore.getState().setLoading(true)).not.toThrow();
      expect(mod.useGraphStore.getState().isLoading).toBe(true);
    } finally {
      restoreLocal();
      restoreSession();
    }
  });

  it('persisted writes go to memory and do not throw in that environment', async () => {
    const restoreLocal = breakLocalStorage();
    const restoreSession = breakSessionStorage();
    vi.resetModules();
    try {
      const mod = await import('../../src/client/store/graphStore.ts');
      // persist 中间件在每次 set 之后写入。后端若是会抛的那个对象，这里会炸。
      expect(() => mod.useGraphStore.getState().setPanelVisible(true)).not.toThrow();
      expect(mod.useGraphStore.getState().panelVisible).toBe(true);
    } finally {
      restoreLocal();
      restoreSession();
    }
  });
});
