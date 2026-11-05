/**
 * .gitignore 过滤器（cycle-141 第七轮）。
 *
 * ## 为什么原生代码图谱要吃 .gitignore
 *
 * 本原生通道是 codegraph 开源项目在 dsh 宿主的优化原生化实现。上游对仓库的
 * 语义是「git 追踪到的源码」，而本适配器此前只有一张**硬编码目录表**
 * （IGNORED_DIRS 13 项）——用户仓库 .gitignore 明确排除的产物目录
 * （artifacts/、.agents/、test-results/、.preview/ 等）全部进了图谱：
 * 真机取证（dsh-anic 14039 节点）：.dsh/.preview/.cycles 等非源码目录的
 * 目录簇占顶层可见节点的大半，图谱显示的是「文件系统」而不是「代码仓库」。
 *
 * ## 语义范围（与 gitignore 规范对齐的子集）
 *
 * 支持：`#` 注释、空行、`!` 取反、目录锚定（尾 `/`）、路径段通配 `*`、
 * `**` 跨段、行内相对路径按 `/` 锚定（gitignore 的「含 / 的模式相对
 * .gitignore 所在目录，否则匹配任意层」规则）。不支持（显式登记缺口，
 * 宁缺勿造）：字符组 `[a-z]`、中段双星（`a` 与 `b` 之间的 `**`）、逐级嵌套 .gitignore
 * （只读仓库根一份——上游 ignore 包也按目录级联，但本仓扫描从根起、
 * 子目录级联的收益远小于复杂度）。
 *
 * ## 与 IGNORED_DIRS 的关系：缺省兜底，不是替代
 *
 * 没有 .gitignore 的仓库（或文件缺失/解析失败）退回硬编码目录表——
 * 「没有配置」不等于「什么都扫」。.gitignore 在场时它的排除**叠加**在
 * 硬编码表之上（两者取并集），取反 `!` 只能救回 .gitignore 自己排除的，
 * 救不回硬编码排除的（node_modules 永不进图——与上游 codegraph 的
 * 内置忽略一致）。
 *
 * ## 零依赖
 *
 * 上游用 `ignore` npm 包；本仓沿用璇玑图「库内自包含」纪律（xuanji 零宿主
 * 依赖的同族约束），glob 匹配是十几行的纯函数，不值得为此引入依赖。
 *
 * @module adapters/gitignoreFilter
 */

import { scoped } from '../shared/Logger.ts';

const log = scoped('gitignore');

/** 一条编译后的 gitignore 规则。 */
interface GitignoreRule {
  /** 原始行（诊断显示用）。 */
  raw: string;
  /** 取反（`!` 前缀）。 */
  negated: boolean;
  /** 只匹配目录（尾 `/`）。 */
  dirOnly: boolean;
  /** 模式含 `/` ⇒ 相对仓库根锚定；否则匹配任意层级的路径段。 */
  anchored: boolean;
  /** 编译后的正则（对「相对仓库根、/ 分隔」的路径匹配）。 */
  re: RegExp;
}

/**
 * 把一条 gitignore 模式编译成正则。
 *
 * 转译规则（gitignore → RegExp，示例用「双星」指代连续两个星号）：
 * - 双星加斜杠的**前缀**形式 ⇒ 可选的任意层级前缀组；
 * - 双星加斜杠的**尾缀**形式 ⇒ 路径前缀匹配（目录及其全部内容）；
 * - 单星 ⇒ 不跨段的任意字符序列；
 * - 问号 ⇒ 不跨段的单字符；
 * - 其余字符字面量转义。
 */
function compilePattern(pattern: string, anchored: boolean): RegExp | null {
  let re = '';
  let i = 0;
  // 尾 / 表示目录锚定，先剥掉。
  if (pattern.endsWith('/')) pattern = pattern.slice(0, -1);
  while (i < pattern.length) {
    const two = pattern.slice(i, i + 3);
    if (two === '**/') {
      re += '(?:.*/)?';
      i += 3;
      continue;
    }
    const ch = pattern[i]!;
    if (ch === '*') {
      // `**` 中段（不在前缀位置）按 gitignore 语义近似为「任意字符含 /」。
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (ch === '/' && i === 0) {
      // 前导 /（/docs/anic 形态）：与「含 / 即根锚定」同义，剥掉——
      // 根锚定由下方「anchored 不加边界前缀组」统一实现，不剥会变成 //docs 永不命中。
      i += 1;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  if (!re) return null;
  // anchored（模式含 /，gitignore 语义 = 相对仓库根）：必须从字符串**开头**锚定
  //（^ 前缀）——其他位置出现的同形路径段不算（other/docs/anic 不该命中 /docs/anic）。
  // unanchored（不含 /，如 artifacts、*.log）：任意段边界处命中该段模式。
  // 尾部 (?:$|/) 让「目录排除」天然覆盖目录**之下**的全部内容：artifacts/ 排除
  // artifacts 本身（dir）与其下每个文件（artifacts/bundle.js 的 ^artifacts/ 命中
  // 尾组 / 分支）——dirOnly 规则对文件不该跳过，而是该按「路径在目录下」命中
  //（首轮实测：跳过导致排除目录下的文件全部漏网）。
  const body = anchored ? `^${re}` : `(?:^|/)${re}`;
  return new RegExp(`${body}(?:$|/)`);
}

/** 解析 .gitignore 文本为规则列表（注释/空行丢弃；语法不可能错——坏行按字面量降级）。 */
export function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith('!')) {
      negated = true;
      pattern = pattern.slice(1);
    }
    if (!pattern) continue;
    // 尾 / 只表示目录锚定，剥掉后再判「含 / 即根锚定」——否则 "build/" 的尾斜杠
    // 会被误判成锚定模式（正则 ^build 从根匹配，src/build 目录漏网，首轮实测）。
    const dirOnly = pattern.endsWith('/');
    const barePattern = dirOnly ? pattern.slice(0, -1) : pattern;
    const anchored = barePattern.includes('/');
    const re = compilePattern(pattern, anchored);
    if (!re) continue;
    rules.push({ raw: line, negated, dirOnly, anchored, re });
  }
  return rules;
}

/**
 * 对「相对仓库根、/ 分隔」的路径做匹配裁决。
 *
 * 顺序语义与 git 一致：**最后一条命中的规则赢**（后写的 `!` 取反能覆盖先前的排除）。
 * dirOnly 规则对文件不跳过：尾部 `(?:$|/)` 边界让「目录排除」覆盖目录之下的全部
 * 内容（artifacts/ 排除 artifacts 目录与其下每个文件）——编译层已实现该语义，
 * 这里不做 isDir 分流。
 */
export function isIgnoredByRules(rules: readonly GitignoreRule[], relPath: string, _isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
}

/**
 * 从文件系统读 workspace 根的 .gitignore 并编译。
 *
 * 读取失败（文件缺失/权限/编码）= 没有规则（调用方退回硬编码兜底），
 * 不抛出——gitignore 缺席是常态而不是错误。
 */
export function loadGitignoreRules(readFile: (path: string) => string, repoRoot: string): GitignoreRule[] {
  try {
    const text = readFile(`${repoRoot}/.gitignore`);
    return parseGitignore(text);
  } catch {
    return [];
  }
}

/** 硬编码兜底目录表（= FileSystemAdapter.IGNORED_DIRS 的同源常量，单一真源在此）。 */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'target',
  '__pycache__', '.venv', 'venv', '.next',
  'coverage', '.cache', '.codegraph',
  // cycle-141：.codegraph-visualizer/ 是插件自己的索引目录，不应出现在图谱中。
  '.codegraph-visualizer',
]);

/**
 * 聚合裁决器：硬编码目录兜底 + .gitignore 规则（并集）。
 * 返回给 FileSystemAdapter.scanDir 的统一判定入口。
 */
export class GitignoreFilter {
  private rules: readonly GitignoreRule[];
  private hasNegationRules: boolean;
  /** 硬编码兜底是否生效（.gitignore 在场时不减——两者并集）。 */
  private defaultDirs: ReadonlySet<string>;

  constructor(rules: readonly GitignoreRule[], defaultDirs: ReadonlySet<string> = DEFAULT_IGNORED_DIRS) {
    this.rules = rules;
    this.hasNegationRules = rules.some((r) => r.negated);
    this.defaultDirs = defaultDirs;
  }

  /** 规则数（管理面板「索引覆盖范围」的白盒数据）。 */
  get ruleCount(): number {
    return this.rules.length;
  }

  /**
   * 是否含取反规则（scanDir 的剪枝策略开关）。
   *
   * 取反在场时目录剪枝必须降级为「不生成节点但仍递归」——否则
   * `!dir/white-listed.ext` 永远救不回被排除目录里的白名单文件
   *（目录级剪枝发生在遍历之前，白名单文件根本不会被看到）。
   */
  get hasNegation(): boolean {
    return this.hasNegationRules;
  }

  /** 目录名是否被硬编码兜底排除（scanDir 剪枝用，O(1)）。 */
  isDefaultIgnoredDir(name: string): boolean {
    return this.defaultDirs.has(name);
  }

  /** 统一裁决：相对路径（/ 分隔）+ 是否目录。 */
  isIgnored(relPath: string, isDir: boolean): boolean {
    if (this.rules.length === 0) return false;
    return isIgnoredByRules(this.rules, relPath, isDir);
  }
}

/** 便捷构造：从文件系统读 .gitignore 并连同兜底表一起编译。读失败 = 纯兜底。 */
export function createGitignoreFilter(
  readFile: (path: string) => string | undefined,
  repoRoot: string,
): { filter: GitignoreFilter; gitignorePresent: boolean } {
  let rules: GitignoreRule[] = [];
  let present = false;
  try {
    const text = readFile(`${repoRoot}/.gitignore`);
    if (typeof text === 'string') {
      rules = parseGitignore(text);
      present = true;
    }
  } catch (e) {
    log.debug('gitignore read failed — default dirs only', { repoRoot, error: String(e) });
  }
  return { filter: new GitignoreFilter(rules), gitignorePresent: present };
}
