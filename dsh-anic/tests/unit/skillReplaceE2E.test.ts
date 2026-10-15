/**
 * 技能替代能力端到端验证（目标问题：「技能插件能否完全替代项目技能的功能业务」）。
 *
 * 这是唯一真正跨过 A∘B 接缝的测试（CLAUDE.md 纪律：调用器 × 真实脚本）——
 * 此前所有单元测试只测状态机/白名单，从不真正 spawn 技能脚本，导致
 * invokeSkillScript 把 --project-dir 当位置参数传给脚本的 P1 缺陷长期潜伏。
 *
 * 证明链：全新空工作区 → 插件内联技能自动安装 → init-workflow 脚手架 →
 * workflow-state 可读 —— 全程不依赖父工程 .dsh/skills/ 与父工程 .cycles/。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoInstallSkill,
  isSkillInstalled,
  resolveSkillScriptsDir,
  invokeSkillScript,
} from '../../src/host/skillInvoker.ts';

const TMP = join(import.meta.dirname, 'tmp-skill-replace-e2e');
const WORKSPACE = join(TMP, 'fresh-project');

afterAll(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 并发清理容忍 */ }
});

describe('插件内联技能 → 全新工作区完整自举（替代能力证明）', () => {
  it('安装：autoInstallSkill 把内联技能复制到工作区 .dsh/skills/', () => {
    const r = autoInstallSkill(WORKSPACE);
    expect(r.installed).toBe(true);
    expect(isSkillInstalled(WORKSPACE)).toBe(true);
    expect(existsSync(join(r.path, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(r.path, 'scripts', 'init-workflow.mjs'))).toBe(true);
  });

  it('解析：resolveSkillScriptsDir 优先命中工作区自己的外部副本', () => {
    const dir = resolveSkillScriptsDir(WORKSPACE);
    expect(dir).not.toBeNull();
    // 外部优先：安装后必须解析到工作区副本，而不是插件内联底座
    expect(dir!.replace(/\\/g, '/')).toContain('.dsh/skills/ai-native-iteration-cycle/scripts');
  });

  it('调用：init-workflow 在工作区脚手架 .cycles/（P1 回归：位置参数形态）', () => {
    const scriptsDir = resolveSkillScriptsDir(WORKSPACE)!;
    const r = invokeSkillScript(scriptsDir, 'init-workflow', [], WORKSPACE, 60000);
    // P1 回归锚点：退出码 0（此前 --project-dir 被当位置参数 → usage 退出 1）
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain('Usage:');
    // 脚手架产物必须落在工作区，而不是 scriptsDir 下的幽灵目录
    expect(existsSync(join(WORKSPACE, '.cycles', 'config.yml'))).toBe(true);
    expect(existsSync(join(WORKSPACE, '.cycles', 'cycles'))).toBe(true);
    expect(existsSync(join(WORKSPACE, 'CLAUDE.md'))).toBe(true);
    // 幽灵目录守卫：调用目录不得出现 --project-dir 残留
    const phantom = readdirSync(scriptsDir).filter((n) => n.includes('project-dir'));
    expect(phantom).toEqual([]);
  });

  it('config.yml 的 project.name 不被 --project-dir 污染', () => {
    const cfg = readFileSync(join(WORKSPACE, '.cycles', 'config.yml'), 'utf-8');
    expect(cfg).toMatch(/name:\s*"my-project"/); // init-workflow 默认名（未传 --name）
  });

  it('调用：workflow-state status 可读全新项目的状态', () => {
    const scriptsDir = resolveSkillScriptsDir(WORKSPACE)!;
    const r = invokeSkillScript(scriptsDir, 'workflow-state', ['status'], WORKSPACE, 60000);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it('幂等：重复 init-workflow 不炸（模板已存在则跳过）', () => {
    const scriptsDir = resolveSkillScriptsDir(WORKSPACE)!;
    const r = invokeSkillScript(scriptsDir, 'init-workflow', [], WORKSPACE, 60000);
    expect(r.exitCode).toBe(0);
  });
});

describe('未安装工作区的内联兜底（开箱即用证明）', () => {
  it('resolveSkillScriptsDir 回落到插件内联底座', () => {
    const bare = join(TMP, 'no-skill-project');
    const dir = resolveSkillScriptsDir(bare);
    // 工作区未安装 → 内联底座必须可用（方案 C：安装插件即用）
    expect(dir).not.toBeNull();
    expect(existsSync(join(dir!, 'init-workflow.mjs'))).toBe(true);
  });
});
