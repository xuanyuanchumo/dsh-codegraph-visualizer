
import type { IntegrationState } from './IntegrationState.ts';
import { GraphPanel } from '../GraphPanel.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';
import { PLUGIN_SLOT_ID } from './integrationIds.ts';

const log = scoped('client');

/**
 * 接入 DSH **原生右侧栏**的 tab 体系（`ctx.get('sidebarRightTabs')`）。
 *
 * 这条通道需要两步，缺一不可：
 *   1. `tabs.register(definition)` 声明一个 tab **类型**（`kind` 是 `openTab` 用来指名它的键）；
 *   2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <id> }, Body)` 声明该类型的
 *      **内容**。契约逐字如此：`SidebarRightTabDefinition.id` 的 JSDoc 写明
 *      「it is the key its body and title register under in the `sidebar.right.pane.tab` and
 *      `sidebar.right.pane.tab.title` seats」（`lib/types/client/tab-registry.d.ts:75-120`）。
 *
 * 本文件在 cycle-83 修正了三处契约偏差（均对照 DSH 类型逐字核验）：
 *   - `title` 改为 `(address: string) => string`（DSH 是**必填**且收 `address` 形参；
 *     旧代码写 `() => t('nav.title')`，运行时无害但契约不精确）；
 *   - 移除 `order: 100` —— `SidebarRightTabDefinition` **没有** `order` 字段，排序由
 *     `priority` band 决定（`RANKS = { extension: 3, builtin: 2, fallback: 1 }`）；
 *   - 补 `keepMounted: true` —— 图表面板持有 cytoscape 实例与视口状态，跨隐藏/会话切换/
 *     停靠重建的代价高；DSH 的该字段 JSDoc 正是「Lazily keep a visited body mounted
 *     through hiding, Session changes and docking; default false」。
 */
export function integrateSidebarRightTabs(state: IntegrationState): void {
  if (state.navButtonRegistered) return;
  if (!state.flags.sidebarRightTabs) return;

  const { ctx } = state;

  try {
    // cordis 的 `ctx.inject(deps, callback)` 回调首参是 **Context**（`registry.d.ts:71-73`
    // 的 `Function<T> { (ctx: Context, config: T): any }`），不是 Map —— cycle-83 修正了
    // 此处原先错误的 `(injected: Map<string, unknown>)` 形参声明。
    // 返回的 Fiber 随父 fiber 自动释放，无需手工登记。
    ctx.inject(['sidebarRightTabs'], (scope) => {
      const tabs = scope.get('sidebarRightTabs') as typeof ctx.sidebarRightTabs | undefined;
      if (!tabs) {
        log.warn('sidebarRightTabs injected but undefined');
        return;
      }
      log.info('sidebarRightTabs injected via ctx.inject, registering...');

      const typeDispose = tabs.register({
        id: PLUGIN_SLOT_ID,
        kind: 'codegraph',
        priority: 'extension',
        keepMounted: true,
        canOpen: () => true,
        // DSH 传入 address（该 tab 要打开的地址）；本插件的标题是常量，故忽略该形参，
        // 但签名必须保留以匹配 `SidebarRightTabDefinition.title`。
        title: (_address: string) => t('nav.title'),
      });
      if (typeof typeDispose === 'function') scope.effect(() => typeDispose, 'codegraph: sidebar-right tab type');

      const bodyDispose = ctx.slots.inject('sidebar.right.pane.tab', () => {
        const regResult = ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: PLUGIN_SLOT_ID },
          GraphPanel,
        );
        if (typeof regResult === 'function') state.slotDisposers.push(regResult);
      });
      if (typeof bodyDispose === 'function') state.slotDisposers.push(bodyDispose);

      state.navButtonRegistered = true;
      useGraphStore.getState().setIntegrationMode('sidebar-right');
      log.info('sidebarRightTabs registration succeeded');
    });
  } catch (e) {
    log.error('sidebarRightTabs ctx.inject failed', e);
  }
}
