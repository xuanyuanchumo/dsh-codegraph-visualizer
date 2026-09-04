import { useSyncExternalStore } from 'react';
import { en } from './dicts/en.ts';
import { zh } from './dicts/zh.ts';

export type Lang = 'zh' | 'en';

type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = { zh, en };

const STORAGE_KEY = 'dsh-codegraph-visualizer/lang';
let currentLang: Lang = 'zh';
const listeners = new Set<() => void>();

function getStoredLang(): Lang {
  if (typeof window === 'undefined') return 'zh';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'zh' || stored === 'en' ? stored : 'zh';
  } catch { return 'zh'; }
}

export function getLang(): Lang { return currentLang; }

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage unavailable */ }
  }
  for (const fn of listeners) fn();
}

export function toggleLang(): void {
  setLang(currentLang === 'zh' ? 'en' : 'zh');
}

currentLang = getStoredLang();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

export function t(key: string, params?: Record<string, string | number>): string {
  let str = dicts[currentLang][key] ?? dicts.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  useLang();
  return t;
}
