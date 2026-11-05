/**
 * GitignoreFilter 单元测试（cycle-141 第七轮）。
 *
 * 覆盖：解析（注释/取反/目录锚定/通配）+ 裁决顺序（最后命中赢）+
 * 与硬编码兜底的并集语义 + 脏路径形态（双反斜杠折叠域的 / 分隔约定）。
 */

import { describe, it, expect } from 'vitest';
import {
  parseGitignore, isIgnoredByRules, GitignoreFilter, DEFAULT_IGNORED_DIRS,
} from '../../src/adapters/gitignoreFilter.ts';

describe('parseGitignore', () => {
  it('注释与空行被丢弃', () => {
    const rules = parseGitignore('# comment\n\n  \nartifacts/\n');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.raw).toBe('artifacts/');
  });

  it('! 前缀解析为取反', () => {
    const rules = parseGitignore('.cycles/\n!.cycles/config.yml\n');
    expect(rules[0]!.negated).toBe(false);
    expect(rules[1]!.negated).toBe(true);
  });

  it('尾 / 解析为目录锚定', () => {
    const rules = parseGitignore('build/\n');
    expect(rules[0]!.dirOnly).toBe(true);
  });

  it('含 / 的模式是锚定的，不含的是任意层级', () => {
    const anchored = parseGitignore('docs/anic\n');
    const unanchored = parseGitignore('*.log\n');
    expect(anchored[0]!.anchored).toBe(true);
    expect(unanchored[0]!.anchored).toBe(false);
  });
});

describe('isIgnoredByRules', () => {
  it('目录模式排除目录但不排除同名文件', () => {
    const rules = parseGitignore('build/\n');
    expect(isIgnoredByRules(rules, 'build', true)).toBe(true);
    expect(isIgnoredByRules(rules, 'build/output.js', true)).toBe(true);
    expect(isIgnoredByRules(rules, 'src/build', true)).toBe(true);
    expect(isIgnoredByRules(rules, 'src/build.ts', false)).toBe(false);
  });

  it('通配 * 不跨段', () => {
    const rules = parseGitignore('*.log\n');
    expect(isIgnoredByRules(rules, 'debug.log', false)).toBe(true);
    expect(isIgnoredByRules(rules, 'logs/debug.log', false)).toBe(true);
    expect(isIgnoredByRules(rules, 'log/x.txt', false)).toBe(false);
  });

  it('**/ 前缀匹配任意层级', () => {
    const rules = parseGitignore('**/temp/\n');
    expect(isIgnoredByRules(rules, 'temp', true)).toBe(true);
    expect(isIgnoredByRules(rules, 'a/b/temp', true)).toBe(true);
    expect(isIgnoredByRules(rules, 'a/temporary', true)).toBe(false);
  });

  it('锚定模式只从根匹配', () => {
    const rules = parseGitignore('/docs/anic\n');
    expect(isIgnoredByRules(rules, 'docs/anic', true)).toBe(true);
    expect(isIgnoredByRules(rules, 'other/docs/anic', true)).toBe(false);
  });

  it('最后一条命中的规则赢（后写取反覆盖先前排除）', () => {
    const rules = parseGitignore('.cycles/\n!.cycles/config.yml\n');
    expect(isIgnoredByRules(rules, '.cycles/cache', true)).toBe(true);
    expect(isIgnoredByRules(rules, '.cycles/config.yml', false)).toBe(false);
  });
});

describe('GitignoreFilter 聚合裁决', () => {
  it('空规则 = 纯兜底（gitignore 缺席是常态）', () => {
    const f = new GitignoreFilter([]);
    expect(f.isIgnored('src/a.ts', false)).toBe(false);
    expect(f.ruleCount).toBe(0);
  });

  it('硬编码兜底目录永不进图（! 也救不回）', () => {
    const f = new GitignoreFilter(parseGitignore('!node_modules/\n'));
    expect(f.isDefaultIgnoredDir('node_modules')).toBe(true);
    expect(DEFAULT_IGNORED_DIRS.has('.codegraph-visualizer')).toBe(true);
  });

  it('gitignore 排除与兜底并集生效', () => {
    const f = new GitignoreFilter(parseGitignore('artifacts/\n.agents/\ntest-results/\n.preview/\n'));
    // gitignore 侧
    expect(f.isIgnored('artifacts/bundle.js', false)).toBe(true);
    expect(f.isIgnored('.agents/worktrees/x', true)).toBe(true);
    expect(f.isIgnored('.preview/serve.mjs', false)).toBe(true);
    // 源码不受影响
    expect(f.isIgnored('src/host/routes.ts', false)).toBe(false);
  });

  it('dsh-anic 真机 .gitignore 场景：src 源码全保留', () => {
    const text = [
      'node_modules/', 'dist/', 'artifacts/', '', '.cycles/',
      '!.cycles/config.yml', 'test-results/', '.dsh/', '.codegraph-visualizer/',
      '', '.preview/', '', '# comment line', '.agents/', '.npmrc-publish',
    ].join('\n');
    const f = new GitignoreFilter(parseGitignore(text));
    expect(f.isIgnored('src/adapters/index.ts', false)).toBe(false);
    expect(f.isIgnored('src', true)).toBe(false);
    expect(f.isIgnored('.dsh/skills/x', true)).toBe(true);
    expect(f.isIgnored('.cycles/archive/cycle-1', true)).toBe(true);
    expect(f.isIgnored('.cycles/config.yml', false)).toBe(false);
  });
});
