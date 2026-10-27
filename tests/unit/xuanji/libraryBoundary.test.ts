/**
 * 库边界契约：`src/xuanji/**` 必须自包含。
 *
 * 为什么需要源码级守卫（而不是行为测试）：
 * 库的价值承诺是「零宿主依赖、可独立发布为 @xuanji/core」。一旦某个文件
 * `import ... from '../../types/index.ts'`，行为测试仍然全绿（宿主里跑得通），
 * 但库已经不可提取——只有扫描导入说明符才能看见这类退化。
 *
 * 三条断言缺一不可：
 * 1) 正向扫描：src/xuanji 下每个导入都必须落在 src/xuanji 内（相对路径）；
 *    bare specifier（第三方/宿主包）一律违规。
 * 2) 反向自检：喂给扫描器一段人造违规样本必须被判定为违规——否则正则写坏时守卫永远绿。
 * 3) 非空扫描：文件数 ≥ 10，防止目录改名/遍历失败导致「零文件 = 零违规」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = resolve(HERE, '../../../src/xuanji');

/** 与源码/样本无关的通用导入说明符提取器。 */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier && !specifiers.includes(specifier)) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function listTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...listTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) result.push(full);
  }
  return result;
}

interface Violation {
  file: string;
  specifier: string;
  reason: string;
}

/** 扫描一批 (文件路径, 源码)；root 之外或 bare specifier 都是违规。 */
function scanForViolations(files: Array<{ path: string; source: string }>, root: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    for (const specifier of extractSpecifiers(file.source)) {
      if (!specifier.startsWith('.')) {
        violations.push({ file: file.path, specifier, reason: 'bare specifier (third-party or host package)' });
        continue;
      }
      const target = resolve(dirname(file.path), specifier);
      const rel = relative(root, target);
      if (rel.startsWith('..') || rel === '' || rel.split(sep)[0] === '..') {
        violations.push({ file: file.path, specifier, reason: 'escapes src/xuanji' });
      }
    }
  }
  return violations;
}

describe('xuanji 库边界契约', () => {
  const files = listTsFiles(LIB_ROOT);

  it('扫描到足够的库文件（防止遍历失败导致的空扫描）', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('库内导入全部自包含（无宿主/第三方依赖）', () => {
    const scanned = files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    const violations = scanForViolations(scanned, LIB_ROOT);
    expect(violations).toEqual([]);
  });

  it('反向自检：人造违规样本必须被扫描器抓到', () => {
    const sample = [
      {
        path: join(LIB_ROOT, 'core', 'sample.ts'),
        source: "import type { GraphNode } from '../../types/index.ts';\nexport const a = 1;",
      },
      {
        path: join(LIB_ROOT, 'core', 'sample2.ts'),
        source: "import { zustand } from 'zustand';\nexport const b = 2;",
      },
      {
        path: join(LIB_ROOT, 'core', 'sample3.ts'),
        source: "import { boothMinimalRotation } from '../ops/booth.ts';\nexport const c = 3;",
      },
    ];
    const violations = scanForViolations(sample, LIB_ROOT);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.specifier).sort()).toEqual(['../../types/index.ts', 'zustand']);
  });

  it('库内不允许出现宿主的 branded 类型/NodeId 构造器', () => {
    const offenders: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      if (/\bGraphNode\b|\bGraphEdge\b|\bGraphData\b|\bGraphDelta\b|\bRepoId\b/.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
