/**
 * Integration identifiers.
 *
 * `PLUGIN_SLOT_ID` is the globally-unique id used when registering into DSH
 * host-managed slots (e.g. `conversation.view`), where ids must not collide with
 * other plugins.
 *
 * `PLUGIN_TAB_KIND` is the internal id/kind shared across this plugin's own
 * integration surface (better-sidebar tab, sidebar footer action, spotlight
 * `openTab`). It intentionally matches the existing `openTab({ type })` contract.
 */
export const PLUGIN_SLOT_ID = 'dsh-codegraph-visualizer';
export const PLUGIN_TAB_KIND = 'codegraph-visualizer';