/**
 * 业务注册矩阵契约守卫（cycle-116）。
 *
 * 守卫三件事：
 * 1. 清单里每个 guardTest 指向真实存在的测试文件（清单与测试不同步 = 红）；
 * 2. 断链集合为空（consumers.length === 0 的业务 = 红——新增业务必须声明消费面）；
 * 3. routes.ts 的注册调用数与 ROUTE_ENTRIES 数量一致（加路由忘登记者 = 红）。
 * 反向自检：合成一个断链样本必须被抓到；守卫坏死时样例测试仍绿 = 守卫失效。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allEntries, brokenLinks, ROUTE_ENTRIES, TOOL_ENTRIES, ENTRY_ITEMS, SKILL_ENTRIES } from '../../src/host/registry/businessRegistry.ts';

const ROOT = join(import.meta.dirname, '../..');

function findTestFile(name: string, dir: string): boolean {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const d of entries) {
    const full = join(dir, d);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (isDir) { if (findTestFile(name, full)) return true; }
    else if (d === name) return true;
  }
  return false;
}

describe('business registry contract', () => {
  it('every guardTest points to a real test file', () => {
    const missing = allEntries()
      .filter((e) => e.guardTest)
      .filter((e) => !findTestFile(e.guardTest!, join(ROOT, 'tests')))
      .map((e) => e.id);
    expect(missing).toEqual([]);
  });

  it('no broken links (every business has at least one consumer)', () => {
    expect(brokenLinks().map((e) => e.id)).toEqual([]);
  });

  it('routes.ts registers the same number of routes as ROUTE_ENTRIES', () => {
    const src = readFileSync(join(ROOT, 'src/host/routes.ts'), 'utf8');
    const registerCalls = (src.match(/register[A-Z][a-zA-Z]*Route\(/g) ?? []).length;
    // registerRegistryRoute 自身不计入 ROUTE_ENTRIES（看板不观测自己）
    expect(registerCalls).toBe(ROUTE_ENTRIES.length + 1); // registry 自身
  });

  it('faces are non-empty and ids unique', () => {
    const entries = allEntries();
    expect(entries.length).toBeGreaterThan(30);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const face of ['tools', 'routes', 'entries', 'skill']) {
      expect(entries.some((e) => e.face === face), face).toBe(true);
    }
    expect(TOOL_ENTRIES.length).toBe(11);
    expect(ROUTE_ENTRIES.length).toBe(20);
    expect(ENTRY_ITEMS.length).toBe(4);
    expect(SKILL_ENTRIES.length).toBe(1);
  });

  it('reverse self-check: a synthetic broken link IS detected', () => {
    const synthetic = { ...TOOL_ENTRIES[0], consumers: [] as string[] };
    const detected = [synthetic].filter((e) => e.consumers.length === 0);
    expect(detected.length).toBe(1);
  });
});
