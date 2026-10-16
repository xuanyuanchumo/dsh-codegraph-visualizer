/**
 * skillRegistration 单元测试（cycle-97 官方技能注册）。
 *
 * 契约锚点：
 *   - dsh-plugin-dev-kb lib/index.js（在用参考实现）：register 输入
 *     { name, description, whenToUse?, source:'runtime', content, resourceBase? }，
 *     dsh-skill validateDefinition 要求 name/description/source/content 四字符串。
 *   - kb/site/reference/subsystems/skills.md：register 返回 disposer。
 *
 * 关键纪律：frontmatter 解析测试用**真实 SKILL.md**（assets/skill/SKILL.md，
 * 字段级转录而非手造样本）——手造样本只会测出解析器匹配手造样本。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillFrontmatter, registerRuntimeSkill } from '../../src/host/skillRegistration.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_SKILL_MD = join(HERE, '..', '..', 'assets', 'skill', 'SKILL.md');
/** 真实技能目录（dist 相对推导的同源路径，测试里显式传）。 */
const SKILL_DIR = join(HERE, '..', '..', 'assets', 'skill');

describe('parseSkillFrontmatter', () => {
  it('解析真实 SKILL.md：name 为 ai-native-iteration-cycle，description 非空，body 以正文开头', () => {
    const md = readFileSync(REAL_SKILL_MD, 'utf-8');
    const parsed = parseSkillFrontmatter(md);
    expect(parsed.name).toBe('ai-native-iteration-cycle');
    expect(parsed.description).toBeTruthy();
    // 折叠块拼接：多行 description 变单空格分隔的单行，无换行残留
    expect(parsed.description).not.toMatch(/\n/);
    expect(parsed.description).toContain('AI-Native');
    // body 保留 frontmatter 终止符后的换行（CRLF 文件的真实字节），正文以 H1 开头
    expect(parsed.body.trimStart()).toMatch(/^#\s+AI-Native/);
  });
  it('单行值与 whenToUse 均可解析', () => {
    const parsed = parseSkillFrontmatter('---\nname: demo\ndescription: one line\nwhenToUse: 插件开发\n---\n\n# Body\n');
    expect(parsed.name).toBe('demo');
    expect(parsed.description).toBe('one line');
    expect(parsed.whenToUse).toBe('插件开发');
    expect(parsed.body).toBe('\n# Body\n');
  });
  it('引号包裹的值去引号', () => {
    const parsed = parseSkillFrontmatter('---\nname: "quoted"\ndescription: \'sq\'\n---\n');
    expect(parsed.name).toBe('quoted');
    expect(parsed.description).toBe('sq');
  });
  it('无 frontmatter → body=全文，name/description 缺失（fail-closed 输入）', () => {
    const parsed = parseSkillFrontmatter('# no frontmatter\n');
    expect(parsed.name).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.body).toBe('# no frontmatter\n');
  });
  it('未知键被忽略，不进结果', () => {
    const parsed = parseSkillFrontmatter('---\nname: a\nversion: 9\nextra: x\ndescription: d\n---\n');
    expect(parsed.name).toBe('a');
    expect(parsed.description).toBe('d');
    expect('version' in parsed).toBe(false);
  });
});

describe('registerRuntimeSkill', () => {
  const CLEANUPS: string[] = [];
  function tmpd(): string {
    const dir = mkdtempSync(join(tmpdir(), 'anic-skillreg-'));
    CLEANUPS.push(dir);
    return dir;
  }
  // 每个用例后清理临时目录（mkdtemp + rmSync 是本仓 12 个测试文件的统一形态）
  afterEach((): void => { while (CLEANUPS.length > 0) { const d = CLEANUPS.pop(); if (d) rmSync(d, { recursive: true, force: true }); } });

  it('注册输入形状与官方契约逐字段一致（真实 SKILL.md）', () => {
    const register = vi.fn((): (() => void) => (): void => {});
    const ctx = { skills: { register } };
    const d = registerRuntimeSkill(ctx, SKILL_DIR);
    expect(d).toBeTypeOf('function');
    expect(register).toHaveBeenCalledTimes(1);
    const input = register.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.name).toBe('ai-native-iteration-cycle');
    expect(input.description).toBeTypeOf('string');
    expect(input.source).toBe('runtime');
    expect(input.content).toBeTypeOf('string');
    expect(String(input.content).trimStart()).toMatch(/^#\s+AI-Native/);
    expect(input.resourceBase).toEqual({ kind: 'directory', path: SKILL_DIR });
    // whenToUse 缺省时不得出现 undefined 值键（undefined 序列化差异是真实契约面）
    expect('whenToUse' in input && input.whenToUse === undefined).toBe(false);
  });
  it('宿主无 skills 服务 → null 跳过（多代防御），不抛异常', () => {
    expect(registerRuntimeSkill({}, SKILL_DIR)).toBeNull();
    expect(registerRuntimeSkill({ skills: {} }, SKILL_DIR)).toBeNull();
  });
  it('技能目录无效 → null 跳过（fail-closed，不猜）', () => {
    const register = vi.fn();
    expect(registerRuntimeSkill({ skills: { register } }, join(tmpd(), 'no-such-dir'))).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
  it('frontmatter 缺 name/description → null 跳过', () => {
    const register = vi.fn();
    const dir = tmpd();
    writeFileSync(join(dir, 'SKILL.md'), '# no frontmatter\n');
    expect(registerRuntimeSkill({ skills: { register } }, dir)).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
});

describe('入口静态 inject 契约（cycle-97）', () => {
  it('src/index.ts 的 inject 含 skills 且不含可选服务（workspaceRegistry 仍走探测）', () => {
    // 读真实入口源码：消费 ctx.skills 的接线必须经静态 inject（官方 dsh-skill-badge
    // 同形态；ctx.inject 动态挂载在真实宿主不触发——见 skillRegistration.ts 历史注记）。
    const indexText = readFileSync(join(HERE, '..', '..', 'src', 'index.ts'), 'utf8');
    expect(indexText).toMatch(/inject\s*=\s*\['tools',\s*'webServer',\s*'sessions',\s*'skills'\]/);
    expect(indexText).not.toMatch(/inject\s*=\s*\[[^\]]*workspaceRegistry/);
    // apply 必须经 effect 注册技能（disposer 记账），不能裸调用后丢弃返回值
    expect(indexText).toMatch(/registerRuntimeSkill\(ctx\)\s*\?\?\s*undefined/);
  });
});
