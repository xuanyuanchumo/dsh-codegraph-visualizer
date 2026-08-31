// Unit tests for i18n lang persistence + translation (J10 personalization)
// Node test env has no window.localStorage — the stub below is hoisted so it
// is installed before the i18n module's top-level `getStoredLang()` runs.
const { windowStub } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
  };
  return { windowStub: { localStorage: localStorageStub } };
});

vi.stubGlobal('window', windowStub);

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLang, setLang, toggleLang, t } from '../../src/client/i18n/index.ts';

function clearStoredLang(): void {
  windowStub.localStorage.removeItem('dsh-codegraph-visualizer/lang');
}

describe('i18n lang persistence (J10)', () => {
  beforeEach(() => {
    clearStoredLang();
  });

  it('should default to zh when nothing is stored', () => {
    expect(getLang()).toBe('zh');
  });

  it('setLang should switch language', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    setLang('zh');
    expect(getLang()).toBe('zh');
  });

  it('toggleLang should flip between zh and en', () => {
    clearStoredLang();
    setLang('zh');
    toggleLang();
    expect(getLang()).toBe('en');
    toggleLang();
    expect(getLang()).toBe('zh');
  });

  it('setLang should persist to localStorage', () => {
    setLang('en');
    const stored = windowStub.localStorage.getItem('dsh-codegraph-visualizer/lang');
    expect(stored).toBe('en');
  });

  it('t should return translated text for known keys in zh', () => {
    setLang('zh');
    expect(t('state.ready')).toBe('就绪');
    expect(t('empty.title')).toBe('暂无图谱数据');
  });

  it('t should return English text after switching to en', () => {
    setLang('en');
    expect(t('state.ready')).toBe('Ready');
    expect(t('empty.title')).toBe('No graph data yet');
  });

  it('t should support interpolation params', () => {
    setLang('zh');
    expect(t('search.matches', { n: 3 })).toBe('3 个匹配');
    setLang('en');
    expect(t('search.matches', { n: 3 })).toBe('3 matches');
  });

  it('t should fall back to key when translation is missing', () => {
    const key = 'this.key.does.not.exist';
    expect(t(key)).toBe(key);
  });

  it('t should fall back to English when zh key is missing', () => {
    setLang('zh');
    expect(() => t('state.updated', { time: '10:00' })).not.toThrow();
  });

  // ── Workspace i18n (cycle-14) ───────────────────────────────────────
  it('should translate workspace keys in zh', () => {
    setLang('zh');
    expect(t('workspace.title')).toBe('工作区');
    expect(t('workspace.current')).toBe('当前工作区');
    expect(t('workspace.switch')).toBe('切换工作区');
    expect(t('workspace.add')).toBe('添加工作区');
    expect(t('workspace.empty')).toBe('暂无工作区');
    expect(t('workspace.default')).toBe('默认');
  });

  it('should translate workspace keys in en', () => {
    setLang('en');
    expect(t('workspace.title')).toBe('Workspace');
    expect(t('workspace.current')).toBe('Current Workspace');
    expect(t('workspace.switch')).toBe('Switch Workspace');
    expect(t('workspace.add')).toBe('Add Workspace');
    expect(t('workspace.empty')).toBe('No workspaces yet');
    expect(t('workspace.default')).toBe('Default');
  });
});