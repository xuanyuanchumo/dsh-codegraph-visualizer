import type { Context } from '@deepseek-ai/cordis';
import type { IntegrationState } from './IntegrationState.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { t } from '../i18n/index.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { scoped } from '../../shared/Logger.ts';
// 布局顺序的唯一权威表（cycle-84 收敛，原先此处有第 2 份副本 `LAYOUT_CYCLE`）。
import { LAYOUT_ORDER } from '../../shared/viewModeUtils.ts';

const log = scoped('client');

/**
 * 把本插件的五个动作贡献为 DSH 的**客户端斜杠命令**。
 *
 * 为什么用 `ctx.commandUi` 而不是别的：本轮对 asar 树逐条核验后确认，本项目原先依赖的
 * `ctx.get('spotlight')` 服务**不存在**（gen1/gen2 两套树与本机全部已装插件中零 `provide`、
 * 零真实 `ctx.get` 命中），因此那条集成路径是恒早退的死代码。真实可用的命令贡献面是
 * `ctx.commandUi`（`@deepseek-ai/dsh-client-ui-commands`，经 `Service` 基类
 * `super(ctx, 'commandUi')` 注册，两代都在）：
 *
 *   - 契约：`CommandUiContract.register(contribution: CommandContribution): () => void`
 *     （`lib/types/client/contract.d.ts:129`，JSDoc 逐字「Register one client command
 *     contribution; effect disposer. Duplicate names throw at registration.」）
 *   - `CommandContribution`：`{ name, label?(), description?(), icon?, available(session), ui }`
 *   - `ActionSpec`：`{ kind: 'action', run(session) }` —— JSDoc 逐字「a bare invocation
 *     consumes the trigger token and runs one client-side callback.」
 *
 * `available` 是**必填**的能力过滤，每次候选遍历都以新的投影调用；这里恒返回 true，
 * 因为五个动作在任何会话里都成立（它们只操作本插件自己的图表面板）。
 *
 * ## cycle-83 结构性修复：改用响应式 `ctx.inject`
 *
 * 旧实现在 `apply()` 的同步一次性时序里 `ctx.get('commandUi')` 探测一次就永久定死。
 * cordis 的 `ctx.get(name, strict = true)` 只返回提供者 fiber 已 active 的实现，而真机上
 * `dsh-client-ui-commands`（BOOT entries idx 37）虽早于本插件（idx 60）apply，其 fiber 在
 * 本插件 apply 的**那一瞬间**仍未转 active，于是 `commandUi` 被误判为 false、
 * `integrateCommandUi` 在第 34 行早退 —— 真机 `/` 弹层 35 条全是技能、**零条命令**，
 * 与本插件 5 条命令一条都没注册的事实吻合（CDP 抓 console 实测）。
 *
 * 修法有两层：
 *   1. `ClientCompatLayer.hasService` 改用 `ctx.get(key, false)`，把「已 provide 但 fiber
 *      未转 active」这一窗口判为可用（能力快照随之正确）；
 *   2. 本模块**不再以能力快照作为硬门**，改为 cordis 官方的响应式注入
 *      `ctx.inject(['commandUi'], (scope) => …)`：依赖到齐才跑回调，服务被替换时会
 *      **先卸载旧 scope 再重跑**（cordis 探针实验 2 实测），依赖永不出现时回调永不执行
 *      且**不阻塞父插件 apply**（实验 1 实测）。官方消费方全部如此写法：
 *      `dsh-client-ui-conversation\lib\client.js:18111`、`dsh-client-ui-message-feedback`
 *      `\lib\client.js:862`、`dsh-client-ui-model-selection\lib\client.js:1209`。
 *
 * 因此这里刻意**不**再写 `if (!state.flags.commandUi) return;` —— 那正是造成「快照早了一瞬
 * 就永久丢功能」的机制；服务在不在场由 `ctx.inject` 自己判定。
 */
export function integrateCommandUi(state: IntegrationState): void {
  const { ctx } = state;

  try {
    ctx.inject(['commandUi'], (scope) => {
      const commandUi = scope.get('commandUi') as Context['commandUi'] | undefined;
      if (!commandUi || typeof commandUi.register !== 'function') return;

      /** 注册一条 action 型命令，并把返回的 disposer 挂进**本次注入的 scope**。 */
      const contribute = (name: string, label: string, run: () => void, effectLabel: string): void => {
        const dispose = commandUi.register({
          name,
          label: () => label,
          available: () => true,
          ui: { kind: 'action', run },
        });
        // 挂在 scope 上而非外层 ctx 上：服务被替换时 scope 先卸载，
        // 旧命令随之撤销，不会与重跑后的注册重复。
        if (typeof dispose === 'function') scope.effect(() => dispose, effectLabel);
      };

      contribute(
        'codegraph-search',
        t('nav.searchSymbols'),
        () => {
          state.openSidebarTab();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
        },
        'codegraph: command search',
      );

      contribute(
        'codegraph-toggle',
        t('nav.togglePanel'),
        () => state.togglePanel(),
        'codegraph: command toggle',
      );

      contribute(
        'codegraph-layout',
        t('nav.switchLayout'),
        () => {
          state.openSidebarTab();
          const store = useGraphStore.getState();
          const currentIdx = LAYOUT_ORDER.indexOf(store.layout);
          const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % LAYOUT_ORDER.length : 0;
          store.setLayout(LAYOUT_ORDER[nextIdx] ?? 'cose');
        },
        'codegraph: command layout',
      );

      contribute(
        'codegraph-filter',
        t('nav.toggleFilter'),
        () => {
          state.openSidebarTab();
          window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_FILTER_PANEL));
        },
        'codegraph: command filter',
      );

      contribute(
        'codegraph-export',
        t('nav.exportGraph'),
        () => {
          state.openSidebarTab();
          window.dispatchEvent(new CustomEvent(DOM_EVENTS.TOGGLE_EXPORT_MENU));
        },
        'codegraph: command export',
      );

      log.info('commandUi contributions registered', { count: 5 });
    });
  } catch (e) {
    log.warn('commandUi registration failed', e);
  }
}
