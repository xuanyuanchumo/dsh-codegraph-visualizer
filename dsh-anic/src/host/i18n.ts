/**
 * 宿主侧 i18n 最小实现——从 locale/ 加载中英文字典，t(key) 查找。
 * presentation.ts + reviewRoute.ts 用户面文本经 t()（P2-4 修复）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Dict = Record<string, unknown>;

/** 深度查找 a.b.c → dict.a.b.c */
function lookup(dict: Dict, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

// 加载 locale（构建后 dist/host.js 同级有 ../../locale/）
let zhDict: Dict = {};
let enDict: Dict = {};
try {
  zhDict = JSON.parse(readFileSync(join(__dirname, '..', '..', 'locale', 'zh.json'), 'utf-8')) as Dict;
  enDict = JSON.parse(readFileSync(join(__dirname, '..', '..', 'locale', 'en.json'), 'utf-8')) as Dict;
} catch { /* locale 加载失败时降级到 key 本身 */ }

/** 翻译查找——先中文，找不到回退英文，再找不到回退 key。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let val = lookup(zhDict, key) ?? lookup(enDict, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return val;
}
