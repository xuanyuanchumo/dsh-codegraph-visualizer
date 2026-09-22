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
} as const;

export type DomEventName = (typeof DOM_EVENTS)[keyof typeof DOM_EVENTS];