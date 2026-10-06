import type { Context } from '@deepseek-ai/cordis';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import { detectClientVersion, type ClientVersionInfo, type ClientGeneration } from './ClientVersionDetector.ts';
import { detectHostPlatform, type HostPlatformInfo } from './PlatformProbe.ts';

const log = scoped('client:compat');

/**
 * 本插件在客户端可用的集成通道。按**优先级从高到低**排列，`detectMode` 取首个可用者。
 *
 * 关于 `remote-web-ui` 的移除（cycle-83）：`ctx.get('remoteWebUI')` 曾在此作为一个模式，
 * 但该服务键在 gen1/gen2 两套 DSH 树与本机全部已装第三方插件中**零 `provide` 命中**，
 * 是幻影。真实的 `@linxin666/dsh-remote-web-ui` 不注册任何 panel/tab API，它只在
 * `sidebar.footer.action` 占一个席位并写 DOM 适配标记，因此「远程窄屏」是
 * **版面适配维度**（见 `PlatformProbe.isRemoteNarrow`），不是一条独立集成通道。
 */
export type SidebarIntegrationMode = 'sidebar-right' | 'better-sidebar' | 'slot' | 'floating' | 'conversation-view';

export interface ClientFeatureFlags {
  /** `ctx.get('sidebarRightTabs')` — DSH 原生右侧栏的 tab 类型注册表（两代都有）。 */
  sidebarRightTabs: boolean;
  /** `ctx.get('betterSidebar')` — 第三方 `dsh-better-sidebar` 的 tab 服务（0.2 线）。 */
  betterSidebar: boolean;
  /** `ctx.slots.inject/register` — slot 系统，本插件唯一的硬依赖。 */
  slots: boolean;
  /** `conversation.view` 顶层标签席位可用（需 slot 系统 + 会话面板在场）。 */
  conversationView: boolean;
  /** `ctx.commandUi.register` — 斜杠命令贡献面（两代都有，替代已删除的 spotlight 幻影）。 */
  commandUi: boolean;
  /** 运行在桌面（Electron）外壳内，由 `<html>` DOM 标记判定，非服务探测。 */
  desktopPlatform: boolean;
  /** 远程窄屏适配插件已激活（`@linxin666/dsh-remote-web-ui` 的 DOM 标记）。 */
  remoteNarrow: boolean;
}

export interface ClientCompatLayer {
  mode: SidebarIntegrationMode;
  flags: ClientFeatureFlags;
  versionInfo: ClientVersionInfo;
  generation: ClientGeneration;
  platform: HostPlatformInfo;
  detectMode(ctx: Context): SidebarIntegrationMode;
  detectFlags(ctx: Context): ClientFeatureFlags;
  detectVersion(ctx: Context): ClientVersionInfo;
  detectPlatform(): HostPlatformInfo;
  hasFlag(key: keyof ClientFeatureFlags): boolean;
  isGen1(): boolean;
  isGen2(): boolean;
  isGen3(): boolean;
}

export function createClientCompatLayer(): ClientCompatLayer {
  let _mode: SidebarIntegrationMode = 'floating';
  let _flags: ClientFeatureFlags = {
    sidebarRightTabs: false,
    betterSidebar: false,
    slots: false,
    conversationView: false,
    commandUi: false,
    desktopPlatform: false,
    remoteNarrow: false,
  };
  let _versionInfo: ClientVersionInfo = { raw: 'unknown', major: 0, minor: 0, patch: 0, generation: 'unknown' };
  let _platform: HostPlatformInfo = detectHostPlatform();

  const detectVersion = (ctx: Context): ClientVersionInfo => {
    _versionInfo = detectClientVersion(ctx);
    return _versionInfo;
  };

  const detectPlatform = (): HostPlatformInfo => {
    _platform = detectHostPlatform();
    return _platform;
  };

  /**
   * 判定集成通道。顺序即优先级：
   *   1. slot 系统可用 → `conversation-view`（顶层标签，本项目最完整的载体）
   *   2. `sidebarRightTabs` → `sidebar-right`（DSH 原生右侧栏）
   *   3. `betterSidebar` → `better-sidebar`（第三方侧边栏）
   *   4. 都没有 → `floating`（插件自绘的浮动面板，兜底）
   */
  const detectMode = (ctx: Context): SidebarIntegrationMode => {
    if (hasSlots(ctx)) {
      _mode = 'conversation-view';
      return _mode;
    }
    if (hasService(ctx, 'sidebarRightTabs')) {
      _mode = 'sidebar-right';
      return _mode;
    }
    if (hasService(ctx, 'betterSidebar')) {
      _mode = 'better-sidebar';
      return _mode;
    }
    _mode = 'floating';
    return _mode;
  };

  const detectFlags = (ctx: Context): ClientFeatureFlags => {
    const slots = hasSlots(ctx);
    const platform = detectHostPlatform();
    _flags = {
      sidebarRightTabs: hasService(ctx, 'sidebarRightTabs'),
      betterSidebar: hasService(ctx, 'betterSidebar'),
      slots,
      conversationView: slots,
      // `commandUi` 经 `Service` 基类注册（`super(ctx, 'commandUi')`），两代都在；
      // 它替换了已删除的 `spotlight` 幻影服务。
      commandUi: hasService(ctx, 'commandUi'),
      desktopPlatform: platform.isDesktop,
      remoteNarrow: platform.isRemoteNarrow,
    };
    log.info('client feature flags resolved', { flags: _flags, mode: _mode, generation: _versionInfo.generation });
    return _flags;
  };

  const hasFlag = (key: keyof ClientFeatureFlags): boolean => _flags[key];
  const isGen1 = (): boolean => _versionInfo.generation === 'gen1';
  // gen3 是 gen2 的前向兼容超集（与宿主侧 ApiCompatLayer 的
  // `GEN3_MAPPING = { ...GEN2_MAPPING }` 策略一致）。
  const isGen2 = (): boolean => _versionInfo.generation === 'gen2' || _versionInfo.generation === 'gen3';
  const isGen3 = (): boolean => _versionInfo.generation === 'gen3';

  return {
    get mode() { return _mode; },
    get flags() { return _flags; },
    get versionInfo() { return _versionInfo; },
    get generation() { return _versionInfo.generation; },
    get platform() { return _platform; },
    detectMode,
    detectFlags,
    detectVersion,
    detectPlatform,
    hasFlag,
    isGen1,
    isGen2,
    isGen3,
  };
}

/** slot 系统是否可用（本插件唯一的硬依赖，见 `src/client/index.ts` 的 `inject`）。 */
function hasSlots(ctx: Context): boolean {
  return safeCheck(() => {
    const slots = ctx.slots;
    if (!slots) return false;
    return typeof slots.inject === 'function' && typeof slots.register === 'function';
  }, false);
}

/**
 * 服务键探测。
 *
 * **必须传 `strict = false`（cycle-83 结构性修复）**。cordis 的
 * `ctx.get(name, strict = true)` 只返回**提供者 fiber 当前活跃**（`fiber.state === 2`）的实现
 * （`cordis/lib/index.js:763-772` 的 `_getImpl`，`lib/types/reflect.d.ts:16` JSDoc 逐字
 * 「only return implementations whose providing fiber is currently active」）。
 *
 * 而本插件的 `apply()` 是**同步一次性**执行的：真机实测（CDP 抓 console 参数）表明
 * 此时 `commandUi`、`pluginNavigation`、`sidebarRightTabs`、`betterSidebar` 的提供者 fiber
 * 都还停在 state 1（loading），只有装载更早的 `slots` 已 active —— 于是 strict 探测把
 * 它们全部判成 false，`integrateCommandUi` 因此在第 34 行早退，**5 条斜杠命令一条都没注册**
 * （真机 `/` 弹层 35 条全是技能、零命令，与结论吻合）。
 *
 * 改用 `strict = false` 后语义变为「该服务**已被 provide 且未被撤回**」——这正是能力探测
 * 想要的粒度：`provide` 的 disposer 会从 store 删除条目，故已卸载插件的服务依然读不到；
 * 唯一放宽的是「已 apply 但 fiber 尚未转 active」这个窗口，而真机上各提供者（`commands`
 * idx 37）确实早于本插件（idx 60）apply。
 *
 * 注意：`strict = false` **读不到尚未 provide 的服务**（cordis 探针实验 2 实测两序皆
 * undefined），因此它只解决「提供者已 apply」这一半；「提供者后 apply」那一半由
 * `CommandUiIntegration` 的响应式 `ctx.inject` 兜住。
 */
function hasService(ctx: Context, key: string): boolean {
  return safeCheck(() => {
    const value = ctx.get(key, false);
    return value !== null && value !== undefined;
  }, false);
}
