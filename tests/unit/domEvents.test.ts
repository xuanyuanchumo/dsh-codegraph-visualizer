import { describe, it, expect } from 'vitest';
import { DOM_EVENTS, type DomEventName } from '../../src/shared/domEvents.ts';

describe('DOM_EVENTS', () => {
  it('应定义所有预期的事件常量', () => {
    expect(DOM_EVENTS.REFRESH).toBe('codegraph:refresh');
    expect(DOM_EVENTS.OPEN_SOURCE).toBe('codegraph:open-source');
    expect(DOM_EVENTS.IMPORT_REPO).toBe('codegraph:import-repo');
    expect(DOM_EVENTS.INIT_GRAPH).toBe('codegraph:init-graph');
    expect(DOM_EVENTS.TOGGLE_WATCH).toBe('codegraph:toggle-watch');
    expect(DOM_EVENTS.WORKSPACE).toBe('codegraph:workspace');
    expect(DOM_EVENTS.INSTALL_PLUGIN).toBe('codegraph:install-plugin');
    expect(DOM_EVENTS.SYMBOL_SELECT).toBe('codegraph:symbol-select');
    expect(DOM_EVENTS.EDITOR_SYMBOL_SELECT).toBe('dsh:editor-symbol-select');
  });

  it('所有事件名应为非空字符串', () => {
    for (const key of Object.keys(DOM_EVENTS)) {
      const value = DOM_EVENTS[key as keyof typeof DOM_EVENTS];
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('所有事件名应唯一', () => {
    const values = Object.values(DOM_EVENTS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('DomEventName 类型应正确推断', () => {
    const event: DomEventName = DOM_EVENTS.REFRESH;
    expect(event).toBe('codegraph:refresh');
  });
});