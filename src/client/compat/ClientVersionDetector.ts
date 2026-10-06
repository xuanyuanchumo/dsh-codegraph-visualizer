import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import {
  parseDshVersion,
  probeReleaseFor,
  unknownDshVersion,
  type DshGeneration,
  type DshVersionInfo,
} from '../../shared/dshGeneration.ts';

const log = scoped('client:compat:version');

/** @deprecated 仅为既有调用点保留的别名；模型本体在 `src/shared/dshGeneration.ts`。 */
export type ClientGeneration = DshGeneration;
/** 浏览器半不需要预发布标记，故在此剥掉。 */
export type ClientVersionInfo = Omit<DshVersionInfo, 'prerelease'>;

/** 剥掉仅宿主需要的预发布字段，使两半对消费方报告相同形状。 */
function toClientVersionInfo(info: DshVersionInfo): ClientVersionInfo {
  const { raw, major, minor, patch, generation } = info;
  return { raw, major, minor, patch, generation };
}

/**
 * 候选一：从 cordis context 上读版本串。
 *
 * **本机实测结论（cycle-83，asar 树全量 grep）**：`ctx.hostVersion`、`ctx.version`、
 * `ctx.app?.version`、`ctx.runtime?.version` 在 `@deepseek-ai/*` 里**零命中**。
 * 浏览器半更读不到宿主 env（`DSH_PROFILE` 等只注入 shell 工具的子进程），
 * 也读不到 `window.__DSH_BOOT__` 里的版本（该全局只携带 bundle 图，不含版本串）。
 * 这一路保留作前向兼容探测，当前必然 miss。
 */
function detectFromContext(ctx: Context): string | null {
  const candidates = [
    () => (ctx as unknown as { hostVersion?: string }).hostVersion,
    () => (ctx as unknown as { version?: string }).version,
    () => (ctx as unknown as { app?: { version?: string } }).app?.version,
    () => (ctx as unknown as { runtime?: { version?: string } }).runtime?.version,
  ];
  for (const fn of candidates) {
    try {
      const v = fn();
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* 忽略 */ }
  }
  return null;
}

/**
 * 仅 0.2 线提供的服务键。二者的提供点已逐行核验：
 *   - `pluginNavigation` — `@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js`
 *     （`ctx.reflect.provide("pluginNavigation", …)`）
 *   - `userQuestionPanels` — `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`
 * 在 gen1 树（VS Code 扩展内 0.1.7-rc.1 那套）里两者**零命中**，而 `slots`、
 * `sidebarRightTabs`、`documentPreviews` 两代都在（`dsh-client-ui-slots` 的
 * `lib/index.js` 两代逐字节相同，SHA256 57E1314E…），因此**只有这两个键可以定代**。
 *
 * 注意 `ctx.commandUi` / `ctx.uiSession` / `ctx.uiConversation` 也是两代都有（它们经
 * `Service` 基类 `super(ctx, name)` 注册，故不出现在 `reflect.provide` 的静态扫描里），
 * 同样不能定代。
 */
const GEN2_ONLY_SERVICES = ['pluginNavigation', 'userQuestionPanels'] as const;

/**
 * 两代都存在的 slot 系统服务键。只作「确实身处 DSH 客户端」的下界证据，不作定代依据。
 */
const SHARED_SERVICES = ['sidebarRightTabs', 'documentPreviews'] as const;

/**
 * 服务键探测。**必须传 `strict = false`**，理由与 `ClientCompatLayer.hasService` 相同：
 *
 * cordis 的 `ctx.get(name, strict = true)` 只返回提供者 fiber `state === 2`（active）的实现
 * （`cordis/lib/index.js:763-772`、`lib/types/reflect.d.ts:16`）。本插件的定代逻辑跑在
 * `apply()` 的同步一次性时序里，此刻 `pluginNavigation` 的提供者 fiber 往往还停在
 * state 1（loading），strict 探测会漏掉它，于是 0.2.0-rc.2 宿主被 `hasSlots` 分支
 * 误判成 gen1。改用 `strict = false`（语义 = 「已 provide 且未撤回」）后即可正确定代。
 *
 * 说明：真机上客户端 `generation` 目前**没有功能调用方**（`src` 内 `isGen1/isGen2/isGen3`
 * 零引用），因此这条修正只影响 `client version detected` 日志字段的准确性；真正会造成
 * 功能缺陷的是同一根因下的 `commandUi` 探测（见 `ClientCompatLayer.hasService` 注释）。
 */
function hasService(ctx: Context, key: string): boolean {
  return safeCheck(() => {
    const value = ctx.get(key, false);
    return value !== null && value !== undefined;
  }, false);
}

/**
 * 客户端半跑在浏览器里，通常读不到版本串，因此改为按**真实服务面**给宿主定代。
 *
 * 判据来自 asar 树的静态核验（见 {@link GEN2_ONLY_SERVICES}）：命中 0.2 独有服务即
 * gen2；否则若 slot 系统在场，则这是一个 0.1 线宿主（gen1）；全 miss 返回 `null`，
 * 由调用方退化成 `unknown` 并交给运行时能力探针。
 *
 * 历史教训：此处曾探测 `remoteWebUI` 与 `spotlight` 两个**并不存在**的服务键
 * （全机三棵树零 `provide`、零真实 `ctx.get` 命中），导致 gen1 分支永不命中、
 * gen2 分支被一个幻影服务重复覆盖。幻影已在 cycle-83 清除。
 *
 * 另一条被纠正的错误：`sidebarRightTabs` 与 `documentPreviews` **两代都有**
 * （`dsh-client-ui-slots` 的 `lib/index.js` 两代逐字节相同），旧代码曾把
 * `sidebarRightTabs` 当 gen2 标记，会把 gen1 误判成 gen2。
 */
function detectFromApiShape(ctx: Context): string | null {
  for (const key of GEN2_ONLY_SERVICES) {
    if (hasService(ctx, key)) return probeReleaseFor('gen2');
  }
  const hasSlots = safeCheck(() => {
    const slots = ctx.slots;
    if (!slots) return false;
    return typeof slots.inject === 'function' && typeof slots.register === 'function';
  }, false);
  if (hasSlots) return probeReleaseFor('gen1');
  for (const key of SHARED_SERVICES) {
    if (hasService(ctx, key)) return probeReleaseFor('gen1');
  }
  return null;
}

export function detectClientVersion(ctx: Context): ClientVersionInfo {
  const sources = [
    () => detectFromContext(ctx),
    () => detectFromApiShape(ctx),
  ];
  for (const fn of sources) {
    try {
      const raw = fn();
      if (raw) {
        const info = parseDshVersion(raw);
        log.info('client version detected', { raw, generation: info.generation });
        return toClientVersionInfo(info);
      }
    } catch { /* 忽略 */ }
  }
  log.info('client version unknown, using feature detection only');
  return toClientVersionInfo(unknownDshVersion());
}
