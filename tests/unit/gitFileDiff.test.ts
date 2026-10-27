// 旅程覆盖：J19（FR-24 版本对比——git 文件级 diff 的解析与图负载转换）。
/**
 * `src/shared/gitFileDiff.ts` 的单元测试（cycle-105，P0-D）。
 *
 * ## 为什么这一层必须单独测
 *
 * 这个模块是 `/diff` 的**全部智能**所在：解析 git 输出、把路径归一化成与
 * `codegraph.db` 可比的形状、构造画布能命中的节点 id。宿主侧 `gitDiff.ts` 只负责
 * 起进程。把逻辑放在这里的目的就是「不需要真的建一个 git 仓库也能验证」——
 * 而真实的 git 输出形状在 `parseGitRawDiff` 的用例里以**字面量**出现，
 * 因为那是外部契约（git 的输出格式），不是我们编的。
 *
 * ## 三条与验收直接相关的断言
 *
 * 1. **id 必须是 `file:<path>`**。拼错一个字符的后果是静默的：`getElementById`
 *    找不到元素 ⇒ 标记一个都不出现 ⇒ 面板报「N 处变更」而画布毫无反应，且无报错。
 *    探针 `scripts/probe-file-node-ids.mjs` 实测画布上 433/433 个文件节点恰好是
 *    这个形状，因此这里的断言有真实基准。
 * 2. **`diffStatus` 必须落在 `properties` 里**。`readDiffStatus` 只读那个位置，
 *    写到顶层会被整条忽略。
 * 3. **解析不能错位一格**。`-z` 输出是「状态行 + 路径」交替；任何按「每两段一组」
 *    的硬切在遇到空路径段时会让后续所有配对整体偏移，结果表现为「一堆文件状态
 *    全是上一个文件的」，同样无报错。
 */
import { describe, it, expect } from 'vitest';
import {
  GIT_DIFF,
  buildFileNodeId,
  fileChangesToDiffNodes,
  normalizeDiffPath,
  parseGitRawDiff,
} from '../../src/shared/gitFileDiff.ts';

describe('normalizeDiffPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizeDiffPath('src\\client\\App.tsx')).toBe('src/client/App.tsx');
  });

  it('strips a leading ./ and trailing slashes', () => {
    expect(normalizeDiffPath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeDiffPath('src/dir/')).toBe('src/dir');
  });

  it('trims surrounding whitespace', () => {
    // `--raw` 的人类可读格式在状态码与路径之间有一个空格；`-z` 下理论上没有，
    // 但归一化不能依赖「git 永远不给我空格」这个假设。
    expect(normalizeDiffPath('  src/a.ts  ')).toBe('src/a.ts');
  });

  it('keeps non-ASCII and spaces inside a path intact', () => {
    // 中文与空格都是真实存在的路径字符。`-z` 的意义正在于此：不做 C 风格转义。
    expect(normalizeDiffPath('docs/中文 文档.md')).toBe('docs/中文 文档.md');
  });

  it('returns an empty string for null/undefined rather than the literal "undefined"', () => {
    // `String(undefined)` 会得到 `'undefined'`，那会变成一个假路径。
    expect(normalizeDiffPath(undefined as unknown as string)).toBe('');
    expect(normalizeDiffPath(null as unknown as string)).toBe('');
  });
});

describe('buildFileNodeId', () => {
  it('builds the file: namespace id the canvas uses', () => {
    // 与 `CodeGraphAdapter.mapRowsToGraphNodes` 的产出对齐（DB 的 file 节点 id 就是
    // `file:<file_path>`）。这条断言是 P0-D 修复是否真的能命中标记的唯一静态证据。
    expect(buildFileNodeId('src/a.ts')).toBe('file:src/a.ts');
  });

  it('normalizes before building so both sides of a pair agree', () => {
    expect(buildFileNodeId('src\\a.ts')).toBe('file:src/a.ts');
    expect(buildFileNodeId('./src/a.ts')).toBe('file:src/a.ts');
  });
});

describe('parseGitRawDiff', () => {
  it('parses a raw diff into path/status pairs', () => {
    // 这是 git `--raw -z` 的真实输出形状：状态行与路径以 NUL 交替。
    const output = [
      ':100644 100644 694c57a e3b3222 M',
      'src/a.ts',
      ':000000 100644 0000000 abc1234 A',
      'src/new.ts',
      ':100644 000000 1234567 0000000 D',
      'src/gone.ts',
      '',
    ].join('\0');

    expect(parseGitRawDiff(output)).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/gone.ts', status: 'removed' },
    ]);
  });

  it('maps the T (typechange) status to modified', () => {
    // 普通文件 ↔ 符号链接。在图上仍然是「这个文件变了」，不是第四种状态。
    const output = ':100644 120000 aaa bbb T\0src/link.ts\0';
    expect(parseGitRawDiff(output)).toEqual([{ path: 'src/link.ts', status: 'modified' }]);
  });

  it('maps an unknown status letter to modified instead of dropping the file', () => {
    // 少报一个文件比多报危险得多：用户会以为没改。未知状态至少能确定「它不同」。
    const output = ':100644 100644 aaa bbb U\0src/conflict.ts\0';
    expect(parseGitRawDiff(output)).toEqual([{ path: 'src/conflict.ts', status: 'modified' }]);
  });

  it('skips an empty path segment without shifting subsequent pairs', () => {
    // 关键回归：按「每两段一组」硬切的实现在这里会让第二个文件的状态整体错位。
    const output = [
      ':100644 100644 aaa bbb M',
      '', // 空路径段
      ':000000 100644 0000000 ccc A',
      'src/real.ts',
      '',
    ].join('\0');

    expect(parseGitRawDiff(output)).toEqual([{ path: 'src/real.ts', status: 'added' }]);
  });

  it('returns an empty array for empty output', () => {
    expect(parseGitRawDiff('')).toEqual([]);
    expect(parseGitRawDiff('\0')).toEqual([]);
  });

  it('handles a path that itself contains a colon', () => {
    // 状态行以 `:` 开头，路径段**不**按这个判据识别——若实现用「以 : 开头就是状态行」
    // 来区分，Windows 盘符路径（`C:/x.ts`）会被误当成状态行。
    const output = ':100644 100644 aaa bbb M\0C:/weird/path.ts\0';
    expect(parseGitRawDiff(output)).toEqual([{ path: 'C:/weird/path.ts', status: 'modified' }]);
  });
});

describe('fileChangesToDiffNodes', () => {
  it('produces nodes whose ids are in the canvas namespace', () => {
    const nodes = fileChangesToDiffNodes([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'added' },
    ]);
    expect(nodes.map((n) => n.id)).toEqual(['file:src/a.ts', 'file:src/b.ts']);
  });

  it('puts diffStatus inside properties, not on the node root', () => {
    // `readDiffStatus` 只读 `properties.diffStatus`。写到顶层会被整条忽略，
    // 标记不出现且没有任何报错——这是最容易被误判成「样式没生效」的缺陷。
    const [node] = fileChangesToDiffNodes([{ path: 'src/a.ts', status: 'removed' }]);
    expect(node!.properties.diffStatus).toBe('removed');
    expect(node as unknown as Record<string, unknown>).not.toHaveProperty('diffStatus');
  });

  it('uses type module so the node survives the client-side assembler', () => {
    // `CodeGraphAdapter` 把 DB 的 `kind: 'file'` 映射成 `module`；这里必须一致，
    // 否则同一个文件在整图与 diff 两条路径上是两种类型，样式与过滤行为会分叉。
    const [node] = fileChangesToDiffNodes([{ path: 'src/a.ts', status: 'added' }]);
    expect(node!.type).toBe('module');
    expect(node!.filePath).toBe('src/a.ts');
  });

  it('derives the label from the last path segment', () => {
    const [node] = fileChangesToDiffNodes([{ path: 'src/client/components/App.tsx', status: 'added' }]);
    expect(node!.label).toBe('App.tsx');
  });

  it('deduplicates the same path, keeping the first status', () => {
    // rename 在 `--no-renames` 下被拆成 D + A；两侧可能归一到同一个路径。
    // 覆盖会让状态在「删除」与「新增」之间随机跳动。
    const nodes = fileChangesToDiffNodes([
      { path: 'src/a.ts', status: 'removed' },
      { path: './src/a.ts', status: 'added' },
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.properties.diffStatus).toBe('removed');
  });

  it('drops entries whose path normalizes to empty', () => {
    const nodes = fileChangesToDiffNodes([{ path: '   ', status: 'modified' }]);
    expect(nodes).toEqual([]);
  });

  it('returns an empty array for an empty change list', () => {
    expect(fileChangesToDiffNodes([])).toEqual([]);
  });
});

describe('GIT_DIFF limits', () => {
  it('declares a positive file cap and a positive timeout', () => {
    // 这两个值参与「截断」与「超时」两条用户可见的语义。为 0 或负数会让
    // 「永远截断」或「永远超时」以完全静默的方式发生。
    expect(GIT_DIFF.MAX_FILES).toBeGreaterThan(0);
    expect(GIT_DIFF.TIMEOUT_MS).toBeGreaterThan(0);
    expect(GIT_DIFF.MAX_OUTPUT_BYTES).toBeGreaterThan(0);
  });
});
