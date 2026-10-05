import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 契约测试：P0-R16-01 的结构性收口必须**长期**成立，而不是"这一轮改对了"。
 *
 * 背景：跨工作区污染在 Round 15 与 Round 16 各出现一次（同一类缺陷两次），根因是"守卫写在调用点，
 * 新增通道时被漏掉"。因此这里用源码级契约把三件事钉死：
 *   1. 判定原语住在 `shared/`（`api/` 与 `runtime/` 都能用，且 `api/` 不反向依赖 `runtime/`）；
 *   2. 增量取数的 `scopeRepoId` 是**必填**参数，杜绝"新增调用点不表态"；
 *   3. 运行时不存在绕过 `applyScopedGraphPayload` 的手写 `setGraphData` 落库路径。
 */
const ROOT = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

describe('cross-workspace guard contract (P0-R16-01)', () => {
  it('keeps the identity primitive in shared/ so api/ need not depend on runtime/', () => {
    const graphScope = read('src/shared/graphScope.ts');
    expect(graphScope).toContain('export function isForeignRepo(');

    // `api/` 只能用 shared 层，不能反向 import runtime/。
    const api = read('src/client/api/index.ts');
    expect(api).toContain("from '../../shared/graphScope.ts'");
    expect(api).not.toMatch(/from '\.\.\/runtime\//);
  });

  it('requires the scope identity on the incremental fetch, so no call site can omit it', () => {
    const api = read('src/client/api/index.ts');
    // 必填（非可选）参数：没有 `?`，也没有默认值。
    expect(api).toMatch(/export async function fetchGraphDataIncremental\(\s*lastUpdated: number,\s*scopeRepoId: string \| null \| undefined,\s*\)/);
    expect(api).not.toMatch(/scopeRepoId\?:/);
    // 取数层必须在返回前比对响应身份。
    expect(api).toContain('if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {');
  });

  it('keeps exactly one runtime channel that may write a fetched payload to the canvas', () => {
    const repoScope = read('src/client/runtime/repoScope.ts');
    expect(repoScope).toContain('export function applyScopedGraphPayload(');
    expect(repoScope).toContain('if (isForeignRepo(data.metadata.repoId, scopeRepoId)) {');

    // 两条增量通道都必须经由唯一通道落库。
    for (const rel of ['src/client/runtime/SSEEvents.ts', 'src/client/runtime/WindowEvents.ts']) {
      expect(read(rel)).toContain('applyScopedGraphPayload(');
    }

    // 取数结果不得被直接写进画布：`fetchGraphDataIncremental` 的回调里不允许出现 `setGraphData`。
    // （`graph-data` 事件是例外——它的负载就在事件体里，其 `repoId` 与已校验的字段是同一个，
    // 不存在"校验 A、落库 B"的错位，故不在此约束内。）
    for (const rel of ['src/client/runtime/SSEEvents.ts', 'src/client/runtime/WindowEvents.ts']) {
      const src = read(rel);
      const fetchedApply = /fetchGraphDataIncremental\([^)]*\)[\s\S]{0,400}?\.setGraphData\(/;
      expect(src).not.toMatch(fetchedApply);
    }

    // WindowEvents 的增量分支曾经是唯一内联守卫点；收口后它不应再自行写图。
    expect(read('src/client/runtime/WindowEvents.ts')).not.toMatch(/store\.setGraphData\(/);
  });

  it('does not resurrect the dead full-graph fetch export', () => {
    const api = read('src/client/api/index.ts');
    expect(api).not.toMatch(/export async function fetchGraphData\(/);
  });
});
