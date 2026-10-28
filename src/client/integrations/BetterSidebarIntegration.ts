import React from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { GraphErrorBoundary } from '../components/ErrorBoundary.tsx';
import { GraphIcon } from '../components/Icons.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { safeCheck } from '../utils/safeCheck.ts';
import { PLUGIN_TAB_KIND } from './integrationIds.ts';

const log = scoped('client');

/**
 * 集成到 `dsh-better-sidebar`（第三方插件，本机 v0.24.1）的标签系统。
 *
 * 契约依据（逐行核验自 `dsh-better-sidebar/lib/types/client/service.d.ts`）：
 *   - `registerTab(descriptor)` 返回 disposer；重复 id 在注册时抛错。
 *   - `TabDescriptor.order` 默认 100（本项目取 50，让代码图谱排在原生标签之前）。
 *   - `features` 是**能力协商**清单（v0.24.1 共 11 项：badge / tabLifecycle / updateTab /
 *     openFile / targetedOpen / stateSubscription / tabMeta / pluginSettings / urlTarget /
 *     settingSelect / fileIcons；v0.19.0 已移除 `floatWindows`）。本项目只在
 *     `badge`、`tabLifecycle`、`stateSubscription` 三个能力上报时才挂对应钩子——
 *     不假设较新版本一定具备较老版本声明过的东西。
 *   - `subscribeState` 的可见性判据：`activePane === 本插件 tab id` 或 `bottomOpen`
 *     （后者对应 `openTab({ target: 'bottom' })` 这条插件自有底部工作台路径）。
 *
 * ## 服务探测为什么必须传 `strict = false`（cycle-83 结构性修复）
 *
 * cordis 的 `ctx.get(name, strict = true)` 只返回**提供者 fiber 当前活跃**
 * （`fiber.state === 2`）的实现（`cordis/lib/index.js:763-772` 的 `_getImpl`，
 * `lib/types/reflect.d.ts:16` JSDoc 逐字「only return implementations whose providing
 * fiber is currently active」）。而本插件的 `apply()` 是**同步一次性**执行的，此刻第三方
 * 插件的 fiber 可能仍在 loading（state 1），strict 探测就会把「其实已经 provide 的服务」
 * 判成不存在，整条集成通道被永久跳过。
 *
 * `strict = false` 的语义是「该服务**已被 provide 且未被撤回**」，正是能力探测想要的粒度：
 * `provide` 的 disposer 会从 store 删除条目，故已卸载插件的服务依然读不到；唯一放宽的是
 * 「已 provide 但 fiber 尚未转 active」这一窗口。
 *
 * ## 为什么这里**不**改用响应式 `ctx.inject`（与 `CommandUiIntegration` 不同）
 *
 * 本模块与 `ConversationViewIntegration` / `SidebarRightTabsIntegration` / `SlotsFallback` /
 * `FloatingPanelIntegration` 争夺的是**同一个互斥资源**（唯一的标签入口），它们靠
 * `state.navButtonRegistered` 组成同步优先级链：
 * conversation.view → sidebar-right → better-sidebar → slot → floating。
 *
 * 若把本通道改成异步注入、而兜底通道仍同步占位，兜底就会在注入回调跑之前
 * `navButtonRegistered = true`，**更好的通道反而永远拿不到入口** —— 优先级被反转。
 * 因此互斥通道必须留在同步链里；只有像 `commandUi` 那样**不占用互斥资源、可叠加**的
 * 贡献面才适合用 `ctx.inject`。
 */
export function integrateBetterSidebar(state: IntegrationState): void {
  // 快照只说明 `apply()` 那一刻读不到 `betterSidebar`，**不说明以后读不到**。
  // 真机 `better-sidebar pending` 已证明提供者晚到是常态（cycle-110 / C1），故：
  //   - 快照为假不再早退，只记一条可观测的 snapshot-miss；
  //   - 真正的判定改用**实时** `ctx.get('betterSidebar', false)`（快照可能是旧的）；
  //   - 实时也读不到 ⇒ 登记「服务就绪后重跑本通道」，重跑仍走同一条同步优先级链的闸门。
  // 这样既没有「一瞬决定永远」，也没有把互斥通道挪进异步链路造成优先级反转。
  if (!state.flags.betterSidebar) state.noteSnapshotMiss('better-sidebar', 'betterSidebar');
  // 顶部标签预留窗口内排队；窗口结束后若顶部标签已落地，本档会在回放时被
  // `navButtonRegistered` 挡掉 —— 这正是「顶部优先、其余让位」的语义。
  if (state.deferIfTopTabPending(() => integrateBetterSidebar(state), 'better-sidebar')) return;
  // 一旦有任何集成通道占位成功，就不再叠加第二个入口（避免同一面板被挂两次）。
  if (state.navButtonRegistered) {
    state.noteChannelYielded('better-sidebar', '席位已被更早占位的通道持有');
    return;
  }

  const { ctx } = state;

  try {
    const betterSidebarApi = ctx.get('betterSidebar', false) as Context['betterSidebar'] | undefined;
    if (!betterSidebarApi) {
      // 实时探测也没有：等它 provide 之后再重跑（`ctx.inject` 是最贴近契约的触发器）。
      state.retryWhenAvailable('betterSidebar', 'better-sidebar', () => integrateBetterSidebar(state));
      return;
    }

    // 能力清单读取失败时按「无能力」处理：宁可少挂钩子，也不要让整个集成崩掉。
    const bsFeatures: string[] = safeCheck(() => betterSidebarApi?.features ?? [], []);
    const hasFeature = (f: string): boolean => bsFeatures.includes(f);
    log.info('better-sidebar features', { version: safeCheck(() => betterSidebarApi?.version, 'unknown'), features: bsFeatures });

    const tabDescriptor: Parameters<NonNullable<Context['betterSidebar']>['registerTab']>[0] = {
      id: PLUGIN_TAB_KIND,
      title: () => t('nav.title'),
      description: () => t('nav.description'),
      icon: (size: number) => React.createElement(GraphIcon, { size }),
      order: 50,
      single: true,
      component: (props: {
        ctx: Context;
        visible: boolean;
        tab: { id: string; title: string; path?: string };
      }) => {
        // 渲染期把可见性同步回 store：DSH 的可见性由宿主布局决定，组件只能如实转述。
        state.panelVisible = props.visible;
        useGraphStore.getState().setPanelVisible(props.visible);
        if (props.tab?.id) state.betterSidebarTabId = props.tab.id;
        return React.createElement(
          'div',
          {
            className: 'cg-integration-host',
            'data-cg-visible': String(props.visible),
            'data-cg-sidebar-visible': String(props.visible),
          },
          React.createElement(GraphErrorBoundary, null, React.createElement(GraphPanel)),
        );
      },
    };

    if (hasFeature('badge')) {
      tabDescriptor.badge = () => {
        const s = useGraphStore.getState();
        if (s.nodes.length === 0) return null;
        return s.nodes.length > 99 ? '99+' : s.nodes.length;
      };
    }

    if (hasFeature('tabLifecycle')) {
      tabDescriptor.onOpen = (tab: unknown, scope: unknown) => {
        log.info('better-sidebar tab opened', { tabId: (tab as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(true);
      };
      tabDescriptor.onActivate = (tab: unknown, scope: unknown) => {
        log.info('better-sidebar tab activated', { tabId: (tab as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(true);
      };
      tabDescriptor.onClose = (tab: unknown, scope: unknown) => {
        log.info('better-sidebar tab closed', { tabId: (tab as { id?: string })?.id, scope });
        useGraphStore.getState().setPanelVisible(false);
      };
    }

    const dispose = betterSidebarApi.registerTab(tabDescriptor);
    if (typeof dispose === 'function') {
      // 把 disposer 交给调用方 fiber：插件卸载时标签随之移除。
      ctx.effect(() => dispose, 'codegraph: better-sidebar tab');
      state.navButtonRegistered = true;
      state.betterSidebarApi = betterSidebarApi;
      // 顶部标签迟到注册时撤回本档入口。
      state.noteFallbackSeat(() => {
        try { dispose(); } catch (e) { log.warn('better-sidebar tab withdrawal failed', e); }
      }, 'better-sidebar');
      state.markChannel('better-sidebar', state.flags.betterSidebar ? 'registered' : 'late-registered');
      if (hasFeature('stateSubscription')) {
        try {
          state.sidebarStateDisposer = betterSidebarApi.subscribeState(() => {
            const snapshot = betterSidebarApi?.getSnapshot();
            if (snapshot?.state) {
              const isVisible = snapshot.state.activePane === PLUGIN_TAB_KIND ||
                snapshot.state.bottomOpen;
              // 只在真变化时写 store，避免宿主快照抖动引发无谓重渲染。
              if (isVisible !== state.panelVisible) {
                state.panelVisible = isVisible;
                useGraphStore.getState().setPanelVisible(isVisible);
              }
            }
          });
          if (state.sidebarStateDisposer) {
            ctx.effect(() => state.sidebarStateDisposer!, 'codegraph: sidebar state subscription');
          }
        } catch (e) {
          log.warn('better-sidebar subscribeState failed', e);
        }
      }
    } else {
      // 契约要求返回 disposer；没拿到说明宿主版本与声明不符，交给 slots 兜底通道。
      log.warn('better-sidebar registerTab did not return a disposer, falling back to slots');
    }
  } catch (e) {
    log.warn('better-sidebar registration failed', e);
  }
}
