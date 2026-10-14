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

/** Inline skill scripts bundled in dsh-anic/assets/skill/scripts/ (方案 C 底座). */
function inlineSkillScriptsDir(): string | null {
  // dist/host.js → ../../assets/skill/scripts (production)
  // src/host/skillInvoker.ts → ../../assets/skill/scripts (dev)
  const thisFile = typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
  for (const up of ['..', '../..', '../../..']) {
    const p = path.join(thisFile, up, 'assets', 'skill', 'scripts');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function resolveSkillScriptsDir(workspaceDir: string): string | null {
  // 方案 C 混合查找：外部优先（可升级）→ 内联底座（开箱即用）
  const candidates = [
    // 1. workspace/.dsh/skills/ai-native-iteration-cycle/scripts（外部最新，优先）
    path.join(workspaceDir, '.dsh', 'skills', 'ai-native-iteration-cycle', 'scripts'),
    // 2. Repo root (parent of dsh-anic)
    path.join(workspaceDir, '..', '.dsh', 'skills', 'ai-native-iteration-cycle', 'scripts'),
    // 3. Inline bundled skill scripts（内联底座，兜底）
    inlineSkillScriptsDir(),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
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

  const result = spawnSync('node', [scriptPath, ...args, '--project-dir', workspace], {
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
