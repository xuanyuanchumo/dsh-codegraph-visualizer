/**
 * 工具输出 ContentBlock 契约（P0-RENDER-CONTENT 回归守卫）。
 *
 * 缺陷史（2026-10-16 真模型实测）：makeToolOutput 的 render 曾返回裸字符串
 * `JSON.stringify(value)`。DSH 注册期不校验 render 的返回类型
 * （dsh-tools/lib/index.js:2564 snapshotProjection 只验无损 JSON，字符串合法），
 * 直到请求组装期 dsh-llm/lib/index.js:594 `contentHasImage(content)` 调
 * `content.some(...)` 才崩溃：`content.some is not a function`——
 * anic_evaluate / anic_status / anic_skill(eval-runner) 三工具同错，模型侧全灭。
 *
 * 官方契约（dsh-plugin-dev-kb kb/site/reference/subsystems/tools.md:23）：
 * `output.render(args, value): ContentBlock[]`。
 *
 * 本守卫两层：
 *   1. 行为面：makeToolOutput().render 必须返回 ContentBlock[]（数组、每块 {type:'text'}、
 *      text 可被模型 JSON.parse 还原）；
 *   2. 源码形态面：src/host/tools*.ts 里不得再出现"裸字符串 render"
 *      （`=> JSON.stringify(...)` 直返 / 字符串字面量直返）。
 *
 * 守卫纪律（与本仓 clientRenderContract / independenceGuard 一致）：
 *   - 反向自检：负样本必须先证明正则能命中；
 *   - 样本用字符串拼接构造，永不匹配自身字面量；
 *   - 非空扫描集（文件数下限），扫描器哑掉时守卫必须红。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeToolOutput } from '../../src/host/toolsSlot.ts';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST_DIR = join(PLUGIN_ROOT, 'src', 'host');

/** 收集 src/host 下 tools 域全部源文件（tools.ts / toolsSlot.ts / tools*Gateway.ts）。 */
function collectToolDomainFiles(): string[] {
  return readdirSync(HOST_DIR)
    .filter((n) => /^tools.*\.ts$/.test(n))
    .map((n) => join(HOST_DIR, n));
}

/** 裸字符串 render 形态：`render: (…) => JSON.stringify(…)` 不包装数组。 */
const BARE_STRINGIFY_RENDER = /render\s*:\s*\([^)]*\)\s*=>\s*(?!.*\[\s*\{\s*type)/;
/** 字符串字面量直返：`render: (…) => '…'` / `=> "…"`。 */
const STRING_LITERAL_RENDER = /render\s*:\s*\([^)]*\)\s*=>\s*['"]/;

describe('makeToolOutput（行为面：ContentBlock[] 契约）', () => {
  it('render 返回数组（不是字符串）——P0 崩溃的直接回归锚', () => {
    const out = makeToolOutput();
    const content = out.render({}, { ok: true, cycles: 62 });
    expect(Array.isArray(content)).toBe(true);
    expect(typeof content).not.toBe('string');
  });

  it('每个块都是 {type:"text", text:string}，text 可 JSON.parse 还原原值', () => {
    const value = { trust: { G0: 100 }, autonomy: 'L4', nested: { list: [1, 2, 3] } };
    const content = makeToolOutput().render({}, value);
    expect(content.length).toBeGreaterThan(0);
    for (const block of content) {
      expect(block.type).toBe('text');
      expect(typeof block.text).toBe('string');
    }
    const parsed = JSON.parse((content[0] as { text: string }).text) as typeof value;
    expect(parsed).toEqual(value); // 模型侧必须能无损还原
  });

  it('schema 是 object-rooted（DSH assertSupportedJsonSchema 要求）', () => {
    expect((makeToolOutput().schema as { type?: string }).type).toBe('object');
  });

  it('value 为 undefined 时 text 兜底为 "null"（JSON.stringify(undefined) 返回非字符串）', () => {
    const content = makeToolOutput().render({}, undefined);
    const text = (content[0] as { text: string }).text;
    expect(typeof text).toBe('string');
    expect(JSON.parse(text)).toBeNull();
  });
});

describe('源码形态面：tools 域不得再出现裸字符串 render', () => {
  // 样本拼接构造：本文件自身不得含有连续的 `render: (` … `=>` 形态字面量
  const R = 'render' + ':';
  const badStringifySample = `const t = { ${R} (_a, v) => JSON.stringify(v) };`;
  const badLiteralSample = `const t = { ${R} (_a, v) => 'done' };`;

  it('反向自检：两个正则都能命中负样本（正则坏 → 守卫红，不静默绿）', () => {
    expect(BARE_STRINGIFY_RENDER.test(badStringifySample)).toBe(true);
    expect(STRING_LITERAL_RENDER.test(badLiteralSample)).toBe(true);
    // 好形态（数组包装）不得命中
    const goodSample = `const t = { ${R} (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] };`;
    expect(STRING_LITERAL_RENDER.test(goodSample)).toBe(false);
  });

  it('非空扫描集：tools 域文件 ≥ 3（扫描器哑掉时本断言红）', () => {
    const files = collectToolDomainFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some((f) => f.endsWith('toolsSlot.ts'))).toBe(true);
  });

  it('全部 tools 域源文件：零裸字符串 render', () => {
    const files = collectToolDomainFiles();
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(f, 'utf-8');
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        if (STRING_LITERAL_RENDER.test(line)) offenders.push(`${f}:${i + 1} 字符串字面量 render`);
        if (BARE_STRINGIFY_RENDER.test(line) && /JSON\.stringify/.test(line) && !/\[\s*\{/.test(line)) {
          offenders.push(`${f}:${i + 1} 裸 JSON.stringify render`);
        }
      });
    }
    expect(offenders, `发现裸字符串 render（会复现 content.some 崩溃）:\n${offenders.join('\n')}`).toEqual([]);
  });
});
