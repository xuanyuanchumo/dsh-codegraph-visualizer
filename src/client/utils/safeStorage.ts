/**
 * 安全存储：**任何跨源 iframe 环境下都不许抛异常**。
 *
 * ## 缺陷形态（P2，cycle-111）
 *
 * `src/client/store/graphStore.ts` 修前直接取 `window.localStorage`：
 *
 * ```ts
 * storage: createJSONStorage(() => typeof window !== 'undefined' ? window.localStorage : memoryStorage)
 * ```
 *
 * 在 `dsh-remote-web-ui` 这类**跨源 iframe** 里，读 `window.localStorage` 这个**属性本身**
 * 就会抛 `SecurityError`（不是返回 `undefined`）。而这段代码位于 `create()` 的初始化路径上
 * —— 模块求值时就执行。于是症状不是"持久化失效"，而是**整个 store 建不出来 ⇒ 插件白屏**，
 * 界面上一个可见的错误都没有。同理，`localStorage.getItem` 在 iframe 被禁用存储时也可能抛。
 *
 * ## 为什么必须 try/catch 到**属性访问**这一层
 *
 * 常见写法 `typeof localStorage !== 'undefined'` 挡不住这个缺陷：`typeof` 对**已声明**的
 * 全局绑定没有豁免，它仍需解析标识符并触发 Window 上的同名 getter，而那个 getter 在跨源
 * iframe 里直接抛 `SecurityError`。也就是说"先 typeof 再取值"这两步里，第一步就可能已经抛了。
 * 所以正确形态是：**把取值本身也包进 try**，失败就整体退回内存实现。
 *
 * 同理，`localStorage.getItem(key)` 在"能取到对象、但读操作被禁"的环境里也会抛，所以每个
 * 方法的调用点各自 try —— 一次探测通过不代表后续调用永远成功。
 *
 * ## 内存回退的语义
 *
 * `memoryStorage` 不是"假装成功"，而是"这一次会话内仍有一致行为，只是不跨刷新"。
 * 对持久化中间件来说这是**已定义**的状态（zustand 的 storage 合同只要求三个方法可调用），
 * 而把 `storage` 直接留空会让 zustand 打一条 `Unable to update item` 的警告并跳过 hydration
 * —— 那仍然"能用"，但会掩盖真实原因。这里选择显式给一个内存实现，并在日志里留一行可查。
 */

import { scoped } from '../../shared/Logger.ts';

const log = scoped('client');

/** zustand `StateStorage` 的**结构**契约（只依赖这三个方法，不引 zustand 类型以免工具层被框架污染）。 */
export interface SafeStorage {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

/** 纯内存实现：同一页面的多次读写一致，刷新即丢。 */
function createMemoryStorage(): SafeStorage {
  const map = new Map<string, string>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => { map.set(name, value); },
    removeItem: (name) => { map.delete(name); },
  };
}

/**
 * 探测一个 Web Storage 是否真的可用。
 *
 * **必须真读真写一次**，只判断 `typeof window !== 'undefined'` 不够：跨源 iframe 里
 * Window 对象存在、`localStorage` 这个属性名也在原型上，但**取值就抛**。写一次再删掉
 * 是为了覆盖"Safari 隐私模式配额为 0"这一类：`getItem` 正常、`setItem` 抛
 * `QuotaExceededError`。只读探测会让那类环境通过检查然后在第一次持久化时炸。
 */
function isStorageUsable(candidate: () => Storage | undefined): Storage | null {
  try {
    const storage = candidate();
    if (!storage) return null;
    const probeKey = '__cg_storage_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    // 跨源 iframe：连属性访问都抛；隐私模式：setItem 抛。两者都落这里。
    return null;
  }
}

/**
 * 取一个**保证不抛**的持久化后端。
 *
 * @param label 仅用于日志定位（哪个 store / 哪个 key 退回了内存）。
 */
export function getSafeStorage(label = 'generic'): SafeStorage {
  if (typeof window === 'undefined') return createMemoryStorage();

  const local = isStorageUsable(() => window.localStorage);
  if (local) {
    return {
      // 每次读写单独 try：探测通过不代表后续调用永远成功（配额在会话中途被清理、
      // 用户途中撤销存储权限）。任何一个方法抛都会让上层（zustand 的 hydration / 写入）
      // 跟着崩，所以在**方法级**再包一层，失败降级为 no-op 而不是上抛。
      getItem: (name) => {
        try { return local.getItem(name); } catch (e) { log.debug('safeStorage.getItem failed', { label, error: e }); return null; }
      },
      setItem: (name, value) => {
        try { local.setItem(name, value); } catch (e) { log.debug('safeStorage.setItem failed', { label, error: e }); }
      },
      removeItem: (name) => {
        try { local.removeItem(name); } catch (e) { log.debug('safeStorage.removeItem failed', { label, error: e }); }
      },
    };
  }

  // 会话存储是第二选择（同源 iframe 里常常 local 被禁而 session 可用），但它的生命周期
  // 是"标签页"，对 UI 偏好够用。**不**把它当作与 local 等价 —— 这里只是让它有机会生效。
  const session = isStorageUsable(() => window.sessionStorage);
  if (session) {
    log.info('localStorage unavailable, falling back to sessionStorage', { label });
    return {
      getItem: (name) => {
        try { return session.getItem(name); } catch { return null; }
      },
      setItem: (name, value) => {
        try { session.setItem(name, value); } catch { /* no-op */ }
      },
      removeItem: (name) => {
        try { session.removeItem(name); } catch { /* no-op */ }
      },
    };
  }

  log.info('no Web Storage available, falling back to in-memory storage', { label });
  return createMemoryStorage();
}

/**
 * 安全读一个**非持久化**的键（例如调试开关）。
 *
 * 存在的理由：`graphStore.ts` 里有一句 `localStorage.getItem('__cg_debug') === '1'` 位于
 * **模块顶层**。在跨源 iframe 里它同样会抛 `SecurityError` —— 一个调试开关不该能把整个
 * 模块求值干掉。
 */
export function safeGetItem(key: string): string | null {
  return getSafeStorage(`safeGetItem:${key}`).getItem(key);
}
