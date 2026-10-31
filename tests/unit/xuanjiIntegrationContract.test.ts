/**
 * XJ-13 集成层守卫：从「工具已注册」升级到「工具真的调库」。
 *
 * ## 为什么需要这一层
 *
 * `plugin.test.ts:211` 的集合相等守卫只能证明「工厂返回的工具 == 入口注册的工具」；
 * `tools.test.ts` 又全部直接调 `execute()`。两者叠加仍然允许一种死链：
 * **execute 里把库的调用删掉、自己复制一份实现**——工具照样注册、用例照样绿，
 * 而 `src/xuanji` 重新变成「只有测试在用」（本项目 cycle-109 的 D 系列 16 个死符号就是这么来的）。
 *
 * 因此本文件做两件事：
 * 1. **源码形状**：两个路径读法工具的 execute 必须同时出现「取/同步图空间」与「调库读法」，
 *    GF-P0-2 的 `graph_query` 必须出现库内纯函数调用；
 * 2. **负向 + 反向自检**：`new XuanjiAdapter()` 在 `src/tools.ts` 出现 0 次；并给一段
 *    **合成样本**（自己 new 适配层、自己算）证明上面的判定真的会判「未走库」，
 *    否则扫描器恒真、守卫永远绿。
 *
 * 定位用 `indexOf('const <tool> = defineTool({')`，找不到时**显式 fail**：
 * 工具改名后静默空扫描是本仓库反复出现的「守卫被重构清空」形态。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const TOOLS_FILE = join(ROOT, 'src', 'tools.ts');
const TOOLS_CODE = readFileSync(TOOLS_FILE, 'utf8');

/**
 * 剥掉注释（字符级替换为空格、保留换行）。
 *
 * 注释里的调用名不算调用点：`src/tools.ts` 的注释写着「XJ-02 …」还会提到 `new XuanjiAdapter()`，
 * 不剥注释会让负向断言永久为假。
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (inLine) {
      out += ch === '\n' ? '\n' : ' ';
      if (ch === '\n') inLine = false;
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 2;
        inBlock = false;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 取某个工具定义的源码片段（到下一个顶层 `const xxx = defineTool({` 或 `return {` 为止）。 */
function toolBody(code: string, toolName: string): string {
  const marker = `const ${toolName} = defineTool({`;
  const start = code.indexOf(marker);
  if (start < 0) {
    throw new Error(`tool definition not found: ${marker} (renamed? guard would silently scan nothing)`);
  }
  const rest = code.slice(start + marker.length);
  const nextTool = rest.search(/\n {2}const [A-Za-z_$][\w$]* = defineTool\(/);
  const end = nextTool >= 0 ? nextTool : rest.search(/\n {2}return \{/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** 一个读法工具是否「真的调库」：同步图空间 + 调库方法，缺一不可。 */
function callsXuanjiReader(body: string, readerCall: RegExp): boolean {
  return /\badapter\s*\.\s*syncGraph\s*\(/.test(body) && readerCall.test(body);
}

const CODE = stripComments(TOOLS_CODE);

describe('XJ-13 集成层守卫：路径读法必须真的调库', () => {
  it('graph_path_enumerate 的 execute 同时出现 adapter.syncGraph 与 findPathsBetween（不是复制实现）', () => {
    const body = toolBody(CODE, 'graphPathEnumerate');
    expect(body).toMatch(/adapter\s*\.\s*findPathsBetween\s*\(/);
    expect(callsXuanjiReader(body, /adapter\s*\.\s*findPathsBetween\s*\(/)).toBe(true);
    // 不能自己写一遍 DFS 枚举：出现 BFS/邻接自实现的迹象即视为复制
    expect(body).not.toMatch(/\bbuildForwardAdjacency\s*\(/);
  });

  it('graph_cycles 的 execute 同时出现 adapter.syncGraph 与 cycles（环读法走库）', () => {
    const body = toolBody(CODE, 'graphCycles');
    expect(body).toMatch(/adapter\s*\.\s*cycles\s*\(/);
    expect(callsXuanjiReader(body, /adapter\s*\.\s*cycles\s*\(/)).toBe(true);
  });

  it('负向断言：src/tools.ts 中 `new XuanjiAdapter()` 出现 0 次（必须走池）', () => {
    expect(CODE.length).toBeGreaterThan(1000);
    expect(CODE.match(/\bnew\s+XuanjiAdapter\s*\(/g) ?? []).toEqual([]);
    // 池本身必须只构造一次（每次调用新建池 = 缓存失效，等价于每次 new）
    expect((CODE.match(/\bnew\s+XuanjiAdapterPool\s*\(/g) ?? []).length).toBe(1);
  });

  // cycle-122 继承项（XJ-11 消费端收口的防复活守卫）：`executeGraphData`（顶层函数，
  // graph_data 工具的 execute 委托给它）必须**消费** pool.applyDelta 的返回值——
  // `const poolDelta = xuanjiPool.applyDelta(...)`。死链复活形态：有人把它改回
  // `xuanjiPool.applyDelta(...)` 丢弃返回值（一行 diff、全部测试照绿、XJ-11 无声复发），
  // 这正是本文件头注说的「execute 把库的调用删掉」同族。三个正向形状各自钉住
  // 「捕获 → 消费 → 下发」一环，断掉任意一环即红。
  it('graph_data 的 execute 消费 pool.applyDelta 返回值（XJ-11 防复活）', () => {
    const fnStart = CODE.indexOf('export async function executeGraphData');
    expect(fnStart, 'executeGraphData 函数必须存在（改名后守卫显式失败，不允许静默空扫描）').toBeGreaterThanOrEqual(0);
    const fnBody = CODE.slice(fnStart, CODE.indexOf('\nexport ', fnStart + 10) < 0 ? CODE.length : CODE.indexOf('\nexport ', fnStart + 10));
    expect(fnBody.length).toBeGreaterThan(500);
    // 正向：捕获 → 消费（写信号）→ 下发（随事件），三环缺一不可。
    expect(fnBody, 'pool.applyDelta 的返回值必须被捕获（const poolDelta = ...）')
      .toMatch(/const\s+poolDelta\s*=\s*xuanjiPool\s*\.\s*applyDelta\s*\(/);
    expect(fnBody, '捕获的信号必须写入 xuanjiSignal 再进 metadata')
      .toMatch(/xuanjiSignal\s*=\s*\{/);
    expect(fnBody, '信号必须随 GraphDataEvent 下发（emitData 携带 xuanji）')
      .toMatch(/xuanji:\s*xuanjiSignal/);
    // 反向样本（字符串拼接防自扫描）：丢弃返回值的写法必须能被正向正则区分出来。
    const discarded = 'xuanji' + 'Pool.applyDelta(repoId, delta);';
    expect(discarded).not.toMatch(/const\s+poolDelta\s*=\s*xuanjiPool\s*\.\s*applyDelta\s*\(/);
  });

  it('GF-P0-2：graph_query 必须调用库内纯函数（种子选择 / 分词 / 渲染），不得内联复制', () => {
    const body = toolBody(CODE, 'graphQuery');
    expect(CODE).toMatch(/from\s*['"][^'"]*xuanji\/query\/keyword-query\.ts['"]/);
    expect(body).toMatch(/\btokenizeQuery\s*\(/);
    expect(body).toMatch(/\bselectSeeds\s*\(/);
    expect(body).toMatch(/\brenderSubgraphText\s*\(/);
  });

  // cycle-112 继承项 D：`/query` 路由与 `graph_query` 工具必须共用**同一份** token 估算
  //（库的 `renderSubgraphText` 内部用 `estimateTokens`，CJK 1 字 = 1 token 的口径在那里
  // 标定）。route 若自己 `import { estimateTokens }` 或写 `Math.ceil(text.length / N)`，
  // 会出现「工具说截断了、面板说没截断」的两套口径——这正是 graphify 研究里
  // 「截断必须显式」的反面。守卫两头：route 不得 import 库的 estimateTokens（透传即可），
  // 也不得出现手写 token 估算形状。
  it('/query 路由不得自算 token（必须透传库渲染结果里的 tokens 字段）', () => {
    const routeCode = stripComments(readFileSync(join(ROOT, 'src', 'host', 'routes', 'queryRoute.ts'), 'utf8'));
    // 命中即说明 route 拿到了 tokens —— 透传链存在。
    expect(routeCode, 'route 响应里必须带 tokens 字段').toMatch(/\btokens\b/);
    // 负向：不得 import 库的 estimateTokens 自己算。
    expect(routeCode, 'route 不得 import estimateTokens —— token 口径只在库里标定一份').not.toMatch(/\bestimateTokens\s*\(/);
    // 负向：不得手写「长度 / 每字符数」类的估算（graphify 的 len/3 是 CJK 误差 2-3 倍的来源）。
    expect(routeCode, 'route 不得手写 token 估算').not.toMatch(/Math\.ceil\s*\(\s*\w+\.length\s*\/\s*\d+/);
    // 反向自检：给一段「手写估算」的合成样本，上面的负向形状必须真的能命中，
    // 否则两条 not.toMatch 是恒真的空守卫。
    const syntheticViolation = 'const tokens = Math.ceil(text.length / 3);';
    expect(syntheticViolation).toMatch(/Math\.ceil\s*\(\s*\w+\.length\s*\/\s*\d+/);
  });
});

describe('XJ-13 反向自检：合成样本必须被判「未走库」', () => {
  it('自己 new 适配层 + 自己枚举的样本 ⇒ 判定为未走池/未走读法', () => {
    // 样本用字符串拼接，避免这份文件自身的字面量被别的守卫扫到（本仓库踩过三次）。
    const newAdapter = 'new ' + 'XuanjiAdapter' + '()';
    const synthetic = [
      `const adapter = ${newAdapter};`,
      'adapter.loadGraph(data);',
      'const found = myOwnDfs(data, source, target);',
    ].join('\n');

    // 正向样本（真实形状）必须判「是」
    const realShape = ['const adapter = xuanjiPool.get(repoId);', 'adapter.syncGraph(data);', 'adapter.cycles({});'].join('\n');
    expect(callsXuanjiReader(realShape, /adapter\s*\.\s*cycles\s*\(/)).toBe(true);

    // 反向样本必须判「否」
    expect(callsXuanjiReader(synthetic, /adapter\s*\.\s*cycles\s*\(/)).toBe(false);
    expect(/\bnew\s+XuanjiAdapter\s*\(/.test(synthetic)).toBe(true);
  });

  it('toolBody 找不到工具时显式抛错（改名后不允许静默空扫描）', () => {
    expect(() => toolBody(CODE, 'graphDoesNotExist')).toThrow(/tool definition not found/);
  });

  it('扫描到的工具片段非空且真的包含 execute（防止切片失败后空串恒为真）', () => {
    for (const name of ['graphPathEnumerate', 'graphCycles', 'graphQuery']) {
      const body = toolBody(CODE, name);
      expect(body.length).toBeGreaterThan(200);
      expect(body).toContain('execute:');
    }
  });
});
