/**
 * 集成标识符。
 *
 * `PLUGIN_SLOT_ID` 是注册进 DSH 托管 slot（例如 `conversation.view`）时使用的**全局唯一**
 * id —— DSH 的 slot 注册表对重复 id 是抛错语义，故该值不能与其他插件撞车。
 *
 * `PLUGIN_TAB_KIND` 是本插件自有集成面内部共用的 id/kind（better-sidebar 的 tab 类型、
 * sidebar-right 的 tab kind、侧边栏页脚动作）。它刻意与既有的
 * `openTab({ type })` 契约保持一致。
 *
 * 历史：注释里曾提到 `spotlight openTab` —— 该服务在任何 DSH 代都不存在（幻影），
 * 已随其集成文件在 cycle-83 删除。
 */
export const PLUGIN_SLOT_ID = 'dsh-codegraph-visualizer';
export const PLUGIN_TAB_KIND = 'codegraph-visualizer';