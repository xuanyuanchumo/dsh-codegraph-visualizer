import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 契约守卫：**测试代码不得用 CJS `require()` 加载 `src/**` 的 TypeScript 源码**（cycle-87 / Round 23）。
 *
 * ## 为什么需要这条守卫
 *
 * `tests/unit/chaos.test.ts:211` 曾有一行加载 `../../src/client/store/graphStore.ts` 的 `require`。
 * `require` 会逃逸到 Node 内建的 TS 加载器（type-stripping），**绕过 vite-node**
 * 直接编译磁盘源码，于是同一个 `file://` URL 上出现了**第二个 V8 script**
 * （偏移量 = 磁盘字节数），与 vite-node 的 SSR 产物并存。
 *
 * `@bcoe/v8-coverage` 的 `mergeProcessCovs` 按 URL 分桶后按
 * `stringifyFunctionRootRange`（`merge.js:119-122`，只取 `ranges[0].startOffset;endOffset`，
 * **不看函数名、不看 scriptId**）分组 —— 两套偏移不相交 ⇒ 两套具名函数全部保留（并集）。
 * 结果：`src/client/diagram/index.ts` 的 `fnMap` 从 29 涨到 **58**，第二套全为 count=0，
 * 即 39 个文件的函数覆盖率被**系统性压低**（修复后实测全局 functions 86.20% → 96.64%）。
 *
 * 同一行还压低了 **statement** 维度：`src/shared/GraphValidator.ts` 从
 * `s 228/363` 变成 `s 363/363`（+135 条被误报为未覆盖），因为第二套坐标系的
 * 位置与真实源码错位，导致真实 statement 的命中记录被写到了错误的位置键上。
 *
 * ## 为什么必须是源码守卫而不是行为测试
 *
 * 这个缺陷**没有任何一条既有测试会因此变红**：所有测试都通过、类型也「通过」
 * （因为 `require` 返回 `any`，调用点根本不参与类型检查 —— 迁移时因此暴露出
 * 6 处 `TS2322` 与 1 处 `TS1308` 既有缺陷）。行为测试只能证明「被调用到的那条路径自洽」，
 * 证明不了「不存在第二套 V8 script」。唯一能红的检查是「源码里不允许出现这个形状」。
 *
 * ## 两个必须处理的陷阱
 *
 * 1. **豁免内建模块**：`node:sqlite` 的 require 是合法的（`tests/unit/codeGraphAdapter.test.ts`
 *    等 13 处），守卫必须只抓「相对路径 + .ts/.tsx」的形状，否则会误伤。
 * 2. **守卫不能匹配自己**：本文件需要正/反例样本，但样本字面量本身就会被正则命中，
 *    使守卫永远红。因此样本一律用**字符串拼接**构造，源码里不出现连续形状。
 *    同理，正则需要**反向自检**（在合成样本上必须命中），否则「正则写坏了」会永远绿 ——
 *    这是 `serviceKeyContract.test.ts` 与 `layoutOrderContract.test.ts` 都踩过的坑。
 */

const ROOT = path.resolve(__dirname, '../..');

/** 匹配「require(相对路径.ts/tsx)」——即会逃逸到 Node TS 加载器的形状。 */
const RELATIVE_TS_REQUIRE = /require\s*\(\s*['"](\.{1,2}\/[^'"]+\.tsx?)['"]\s*\)/;

/** 剥掉整行注释与块注释起始行，使散文里的示例代码不参与匹配。 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(
      (line) =>
        !line.trim().startsWith('//') &&
        !line.trim().startsWith('*') &&
        !line.trim().startsWith('/*'),
    )
    .join('\n');
}

function collectTestFiles(dir: string): Array<{ rel: string; code: string }> {
  const out: Array<{ rel: string; code: string }> = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const raw = fs.readFileSync(full, 'utf8');
        out.push({ rel: path.relative(ROOT, full).replace(/\\/g, '/'), code: codeOnly(raw) });
      }
    }
  };
  walk(dir);
  return out;
}

// 样本用拼接构造：源码里因此不出现连续的 require 形状，守卫不会匹配自己。
const REQ = 'requ' + 'ire';
const SAMPLE_ESCAPE_SINGLE = `const { useGraphStore } = ${REQ}('../../src/client/store/graphStore.ts');`;
const SAMPLE_ESCAPE_DOUBLE = `${REQ}("./src/x.ts")`;
const SAMPLE_ESCAPE_TSX = `${REQ}('../src/client/App.tsx')`;
const SAMPLE_BUILTIN = `${REQ}('node:sqlite')`;
const SAMPLE_BARE_PKG = `${REQ}('zustand')`;
const SAMPLE_ESM = `await import('../../src/shared/constants.ts')`;

describe('require-escape contract: tests must load src/** via ESM import', () => {
  const files = collectTestFiles(path.join(ROOT, 'tests'));

  it('collected a non-trivial number of test files', () => {
    // 防止 walk 因目录改名而静默返回空集合 —— 空集合会让下面的守卫永远绿。
    expect(files.length).toBeGreaterThan(100);
  });

  it('the detector regex actually matches the shape it is meant to catch (reverse self-check)', () => {
    // 正向样本：就是被删掉的那一行（单引号形态）。
    expect(RELATIVE_TS_REQUIRE.test(SAMPLE_ESCAPE_SINGLE)).toBe(true);
    // 双引号变体。
    expect(RELATIVE_TS_REQUIRE.test(SAMPLE_ESCAPE_DOUBLE)).toBe(true);
    // tsx 变体。
    expect(RELATIVE_TS_REQUIRE.test(SAMPLE_ESCAPE_TSX)).toBe(true);
    // 反例：内建模块必须**不**匹配，否则守卫会把合法的 node:sqlite 用法也判红。
    expect(RELATIVE_TS_REQUIRE.test(SAMPLE_BUILTIN)).toBe(false);
    // 反例：裸包名不匹配。
    expect(RELATIVE_TS_REQUIRE.test(SAMPLE_BARE_PKG)).toBe(false);
    // 反例：已迁移的 await import 形状不匹配。
    expect(RELATIVE_TS_REQUIRE.test(SAMPLE_ESM)).toBe(false);
  });

  it('no test file escapes to the Node TS loader via relative require()', () => {
    const offenders = files
      .filter((f) => RELATIVE_TS_REQUIRE.test(f.code))
      .map((f) => f.rel);

    // 失败时给出可操作的清单，而不是只报数量。
    expect(offenders).toEqual([]);
  });

  it('built-in module requires are still allowed (guard is not over-broad)', () => {
    // 证明豁免成立：仓库里确实存在合法的 node: 内建 require，且它们不触发守卫。
    const withBuiltin = files.filter((f) => f.code.includes(`${REQ}('node:`));
    expect(withBuiltin.length).toBeGreaterThan(0);
    for (const f of withBuiltin) {
      expect(RELATIVE_TS_REQUIRE.test(f.code)).toBe(false);
    }
  });
});
