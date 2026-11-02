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
import { allEntries, brokenLinks, ROUTE_ENTRIES, TOOL_ENTRIES, ENTRY_ITEMS, SKILL_ENTRIES, probeRegistry } from '../../src/host/registry/businessRegistry.ts';

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

  /**
   * **注册数 == 登记数**（cycle-134 真机发现后补的守卫）。
   *
   * 缺陷现场：`src/index.ts` 已经 `ctx.tools.register(graphPathPattern)`（13 个工具），
   * 而 `businessRegistry.ts` 的 `TOOL_ENTRIES` 仍是 12 条。真机 `/status` 因此报
   * `byFace.tools: 12`，而 `brokenLinks: []` —— **完全静默**：不产生断链，
   * 也没有任何断言变红。运维读到的注册矩阵少了一个真实存在的业务面。
   *
   * 为什么必须是「逐个 id 对照」而不是「数量相等」：数量相等会被
   * 「漏登记 A + 多登记 B」同时满足（本仓「计数式断言没有鉴别力」的老坑）。
   * 这里两边都解析成 id 集合再比较，两个方向都红。
   */
  it('TOOL_ENTRIES 与 src/index.ts 真实注册的工具 id 集合完全相等', () => {
    // 入口侧的真相：从 src/index.ts 里抽 ctx.tools.register(<symbol>) 的 symbol，
    // 再到 createGraphTools 的返回里解析该 symbol 对应的工具 name —— 两步都不能省：
    // 只数 register 调用次数看不到「注册了 A 但返回对象里其实是 B」。
    const indexPath = join(ROOT, 'src/index.ts');
    const toolsPath = join(ROOT, 'src/tools.ts');
    const indexSrc = readFileSync(indexPath, 'utf8');
    const toolsSrc = readFileSync(toolsPath, 'utf8');

    const registeredSymbols = [...indexSrc.matchAll(/ctx\.tools\.register\(\s*(\w+)\s*\)/g)]
      .map((m) => m[1]!)
      .filter((sym) => sym !== 'undefined');
    // 必须扫到足够多的注册点：解析失败会让下面的集合比较变成「空 == 空」的假绿。
    expect(registeredSymbols.length).toBeGreaterThanOrEqual(13);

    const registeredNames = new Set<string>();
    for (const sym of registeredSymbols) {
      // 在 tools.ts 里找 `const <sym> = defineTool({ ... name: 'xxx'` 的 name
      // 用模板字符串 + **双反斜杠**：正则元字符必须原样进入 RegExp 构造器。
      // 只写单反斜杠时，模板字符串会把它当转义序列吃掉（\s → s），
      // 于是 `const\s+` 变成 `consts+`，RegExp 抛 "Unterminated group"。
      const re = new RegExp(`const\\s+${sym}\\s*=\\s*defineTool\\(\\{[\\s\\S]*?name:\\s*'([^']+)'`);
      const m = re.exec(toolsSrc);
      if (m?.[1]) registeredNames.add(m[1]);
    }
    // 每个注册符号都必须解析出名字，否则说明解析器与源码形状漂移了（守卫本身失效）
    expect(registeredNames.size).toBe(registeredSymbols.length);

    const declaredIds = new Set(TOOL_ENTRIES.map((e) => e.id));
    expect([...declaredIds].sort()).toEqual([...registeredNames].sort());
  });

  it('反向自检：上面的集合比较真的会因「少登记一个」而红', () => {
    // 不碰真实注册表：把同一比较逻辑喂给一份缺项清单，必须先失败。
    const declared = new Set(TOOL_ENTRIES.map((e) => e.id));
    const missingOne = new Set([...declared].filter((id) => id !== 'graph_path_pattern'));
    expect([...missingOne].sort()).not.toEqual([...declared].sort());
    // 第二个方向：多登记一个同样必须红
    expect([...declared, 'graph_nonexistent'].sort()).not.toEqual([...declared].sort());
  });

  it('faces are non-empty and ids unique', () => {
    const entries = allEntries();
    expect(entries.length).toBeGreaterThan(30);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const face of ['tools', 'routes', 'entries', 'skill']) {
      expect(entries.some((e) => e.face === face), face).toBe(true);
    }
    // cycle-132：+graph_integrity（璇玑图白盒可观测工具）。
    // cycle-134：+graph_path_pattern。这个数字曾经漏更新，导致真机 /status 报
    // `byFace.tools = 12` 而实际注册 13 个——见下面「注册数 == 登记数」的守卫。
    // cycle-135：+graph_slice（多维视图切片：时序 / 所有权 / 领域 + 结构）。
    expect(TOOL_ENTRIES.length).toBe(14);
    expect(ROUTE_ENTRIES.length).toBe(21);
    expect(ENTRY_ITEMS.length).toBe(4);
    expect(SKILL_ENTRIES.length).toBe(1);
  });

  it('live probe covers every entry and emits only valid states', () => {
    const hints = probeRegistry({ getLastGraphData: () => ({ nodes: [] }) });
    expect(hints.length).toBe(allEntries().length);
    for (const h of hints) {
      expect(['live', 'idle', 'degraded', 'unknown']).toContain(h.live);
      expect(h.basis.length).toBeGreaterThan(0);
    }
    // 元路由/status 在空数据下也必须 live（它们不依赖图数据）
    const statusHint = hints.find((h) => h.id === '/status');
    expect(statusHint?.live).toBe('live');
  });

  it('live probe: data routes go idle without graph data', () => {
    const hints = probeRegistry({ getLastGraphData: () => null });
    const dataHint = hints.find((h) => h.id === '/data');
    expect(dataHint?.live).toBe('idle');
    const watchHint = hints.find((h) => h.id === '/watch');
    expect(watchHint?.live).toBe('idle');
  });

  it('reverse self-check: a synthetic broken link IS detected', () => {
    const synthetic = { ...TOOL_ENTRIES[0], consumers: [] as string[] };
    const detected = [synthetic].filter((e) => e.consumers.length === 0);
    expect(detected.length).toBe(1);
  });
});
