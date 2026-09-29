export const DOM_EVENTS = {
  REFRESH: 'codegraph:refresh',
  OPEN_SOURCE: 'codegraph:open-source',
  IMPORT_REPO: 'codegraph:import-repo',
  INIT_GRAPH: 'codegraph:init-graph',
  TOGGLE_WATCH: 'codegraph:toggle-watch',
  WORKSPACE: 'codegraph:workspace',
  INSTALL_PLUGIN: 'codegraph:install-plugin',
  SYMBOL_SELECT: 'codegraph:symbol-select',
  EDITOR_SYMBOL_SELECT: 'dsh:editor-symbol-select',
  TOGGLE_FILTER_PANEL: 'codegraph:toggle-filter-panel',
  TOGGLE_EXPORT_MENU: 'codegraph:toggle-export-menu',
  THEME_CHANGED: 'codegraph:theme-changed',
} as const;

export type DomEventName = (typeof DOM_EVENTS)[keyof typeof DOM_EVENTS];