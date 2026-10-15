/**
 * Skill script invoker — runs ai-native-iteration-cycle scripts via spawnSync.
 * Security: script whitelist + workspace path validation + timeout.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const SKILL_SCRIPTS = [
  'init-workflow',
  'init-cycle',
  'eval-runner',
  'gate-check',
  'auto-fix-loop',
  'multi-agent-gate',
  'hitl-audit',
  'band-detector',
  'gate-ledger',
  'workflow-state',
  'org-status',
  'quick-validate',
  'fact-base-verify',
  'plan-sync-check',
  'archive-cycle',
] as const;

export type SkillScriptName = (typeof SKILL_SCRIPTS)[number];

export interface InvokeResult {
  script: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export function isAllowedScript(name: string): name is SkillScriptName {
  return (SKILL_SCRIPTS as readonly string[]).includes(name);
}

export function listSkillScripts(): SkillScriptName[] {
  return [...SKILL_SCRIPTS];
}

/** 技能 scripts 目录哨兵：任何有效技能 scripts 目录必含 init-workflow.mjs
 * （引导脚本 + 15 个白名单业务脚本的共同存在性证明；只查目录会接受损坏安装）。 */
const SKILL_DIR_SENTINEL = 'init-workflow.mjs';

/** Inline skill scripts bundled in dsh-anic/assets/skill/scripts/ (方案 C 底座). */
function inlineSkillScriptsDir(): string | null {
  // dist/host.js → ../../assets/skill/scripts (production)
  // src/host/skillInvoker.ts → ../../assets/skill/scripts (dev)
  const thisFile = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
  for (const up of ['..', '../..', '../../..']) {
    const p = path.join(thisFile, up, 'assets', 'skill', 'scripts');
    if (fs.existsSync(path.join(p, SKILL_DIR_SENTINEL))) return p;
  }
  return null;
}

/**
 * 技能 scripts 目录解析 — **全插件唯一实现**（12 §1.3 路径无关；C 域一致性）。
 * 方案 C 混合查找：显式环境变量 → 外部（可升级）→ 内联底座（开箱即用）。
 * 每个候选都必须通过 init-workflow.mjs 哨兵检查，绝不接受裸目录。
 */
export function resolveSkillScriptsDir(workspaceDir: string): string | null {
  const candidates = [
    // 0. ANIC_SKILL_DIR 显式覆盖（用户明确意图 > 自动发现）
    process.env.ANIC_SKILL_DIR
      ? path.join(process.env.ANIC_SKILL_DIR, 'scripts')
      : null,
    // 1. workspace/.dsh/skills/ai-native-iteration-cycle/scripts（外部最新，优先）
    path.join(workspaceDir, '.dsh', 'skills', 'ai-native-iteration-cycle', 'scripts'),
    // 2. Repo root (parent of workspace，workspace 为仓库子目录时)
    path.join(workspaceDir, '..', '.dsh', 'skills', 'ai-native-iteration-cycle', 'scripts'),
    // 3. process.cwd()/.dsh/...（宿主进程从仓库根启动时的兼容候选）
    path.join(process.cwd(), '.dsh', 'skills', 'ai-native-iteration-cycle', 'scripts'),
    // 4. Inline bundled skill scripts（内联底座，兜底）
    inlineSkillScriptsDir(),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, SKILL_DIR_SENTINEL))) return c;
  }
  return null;
}

/** 检查技能是否已安装在工作区 .dsh/skills/ 中。 */
export function isSkillInstalled(workspaceDir: string): boolean {
  return fs.existsSync(
    path.join(workspaceDir, '.dsh', 'skills', 'ai-native-iteration-cycle', 'SKILL.md'),
  );
}

/** 将内联技能复制到工作区 .dsh/skills/（自动安装）。 */
export function autoInstallSkill(workspaceDir: string): { installed: boolean; path: string; error?: string } {
  const targetDir = path.join(workspaceDir, '.dsh', 'skills', 'ai-native-iteration-cycle');
  const inlineDir = inlineSkillScriptsDir();
  if (!inlineDir) return { installed: false, path: targetDir, error: 'inline skill not bundled' };
  const skillRoot = path.join(inlineDir, '..'); // assets/skill/
  if (!fs.existsSync(skillRoot)) return { installed: false, path: targetDir, error: 'skill root not found' };

  // 创建目标目录
  fs.mkdirSync(targetDir, { recursive: true });

  // 递归复制
  function copyRecursive(src: string, dst: string): void {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copyRecursive(s, d);
      } else {
        fs.copyFileSync(s, d);
      }
    }
  }
  copyRecursive(skillRoot, targetDir);
  return { installed: true, path: targetDir };
}

export function validateWorkspace(ws: string): { ok: boolean; error?: string } {
  if (!ws || typeof ws !== 'string') return { ok: false, error: 'workspace is required' };
  const resolved = path.resolve(ws);
  // Path traversal protection
  if (ws.includes('..')) return { ok: false, error: 'path traversal not allowed' };
  if (!fs.existsSync(resolved)) return { ok: false, error: 'workspace does not exist' };
  if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: 'workspace is not a directory' };
  return { ok: true };
}

export function invokeSkillScript(
  scriptsDir: string,
  script: string,
  args: string[] = [],
  workspace: string,
  timeoutMs = 30000,
): InvokeResult {
  const scriptPath = path.join(scriptsDir, `${script}.mjs`);
  const start = Date.now();

  if (!fs.existsSync(scriptPath)) {
    return {
      script,
      exitCode: -1,
      stdout: '',
      stderr: `Script not found: ${scriptPath}`,
      timedOut: false,
      durationMs: Date.now() - start,
    };
  }

  // 项目目录 = 第一个位置参数（全部 15 个技能脚本的约定 args._[0]，转录自
  // mcp-server.mjs:35 的参考调用形态 `node <script> "<projectDir>" <args...>`）。
  // 此前错误地追加 `--project-dir <ws>`：脚本不认识该旗标，把它当位置参数收进
  // args._[0]，解析出 <scriptsDir>/--project-dir 幽灵目录 —— 无任何测试变红
  // （单元测试只测状态机，从不真正调用脚本）。
  const result = spawnSync('node', [scriptPath, workspace, ...args], {
    timeout: Math.min(timeoutMs, 120000),
    encoding: 'utf-8',
    cwd: scriptsDir,
  });

  return {
    script,
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.signal === 'SIGTERM' || (result.status === null && result.signal !== null),
    durationMs: Date.now() - start,
  };
}
