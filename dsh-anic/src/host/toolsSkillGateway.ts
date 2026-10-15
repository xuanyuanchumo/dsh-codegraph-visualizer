/**
 * Skill-domain DSH tools — anic_install（原生安装引导）+ anic_skill（全白名单通用网关）。
 *
 * 拆分自 tools.ts（T3 ≤250 行模块化纪律，truthAudit T3 结构守卫实测拦截 320 行）。
 * 工具域拆分与「路由按端点拆」同构：eval/gate 命名工具留 tools.ts，
 * 技能调用域（安装 + 通用网关）独立成文件。
 *
 * 用户需求契约：**所有 15 个功能业务内容脚本必须能在 DSH 里原生调用** ——
 * anic_skill 的 script 枚举在运行时取自 listSkillScripts()（单一事实源），
 * 由 tests/unit/skillToolNative.test.ts 钉死（白名单 ⇄ 内联底座集合恰好相等）。
 */
import type { ToolRegistration, ToolsSlot } from './toolsSlot.ts';
import {
  resolveSkillScriptsDir,
  invokeSkillScript,
  validateWorkspace,
  isAllowedScript,
  listSkillScripts,
  autoInstallSkill,
  isSkillInstalled,
} from './skillInvoker.ts';

export function registerSkillGatewayTools(
  tools: ToolsSlot,
  deps: { getRoot: () => string | null; register: (tool: ToolRegistration) => (() => void) | null | undefined },
): Array<(() => void) | null> {
  const disposers: Array<(() => void) | null> = [];
  const register = deps.register; // 调用方已在槽位守卫后收窄（tools.ts `!tools?.register`）

  // Tool: anic_install — install/update the bundled skill into workspace
  // （原生执行 autoInstallSkill，不再只回 URL——「所有内容脚本能原生调用」的
  //   前置：先把技能装进工作区；installUrl 保留作浏览器入口兼容。）
  disposers.push(register({
    name: 'anic_install',
    description: 'Install or update the ai-native-iteration-cycle skill from the plugin bundle into the workspace .dsh/skills/ (idempotent by version)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    handler: async (args) => {
      const root = (args.workspace as string) ?? deps.getRoot() ?? '';
      if (!root) return { error: 'no workspace' };
      // 只做形状校验（拒绝路径遍历），不要求目录已存在——安装本身就是
      // 把技能装进（可能尚不存在的）全新工作区的引导动作，autoInstallSkill
      // 会 mkdirSync recursive；先跑 validateWorkspace 会让安装永远无法
      // bootstrap 新目录（vitest 实测 installed=undefined）。
      if (root.includes('..')) return { error: 'path traversal not allowed' };
      const r = autoInstallSkill(root);
      return {
        installed: r.installed,
        path: r.path,
        error: r.error ?? null,
        skillInstalled: isSkillInstalled(root),
        installUrl: `/anic/skill/install?workspace=${encodeURIComponent(root)}`,
      };
    },
  }) ?? null);

  // Tool: anic_skill — 全部 15 个白名单业务脚本的原生 DSH 调用网关。
  // 覆盖性契约：脚本枚举在运行时取自 listSkillScripts()（单一事实源，
  // 绝不在 schema 里手抄第二份数组——两份有序列表必然漂移）。
  // 安全模型与 HTTP 网关 /anic/skill/invoke 一致：白名单 + workspace 校验 +
  // 超时上限；stdout/stderr 截断防超大响应。
  disposers.push(register({
    name: 'anic_skill',
    description: 'Natively invoke any whitelisted ai-native-iteration-cycle skill script '
      + `(${listSkillScripts().join(', ')}). Project dir is passed as the first positional arg per script convention.`,
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Skill script name (whitelisted, without .mjs)',
          enum: listSkillScripts(),
        },
        workspace: { type: 'string', description: 'Target project directory (default: current workspace)' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra CLI args appended after the positional project dir',
        },
        timeout: { type: 'number', description: 'Timeout ms (default 60000, hard cap 120000)' },
      },
      required: ['script'],
    },
    handler: async (args) => {
      const script = String(args.script ?? '');
      if (!isAllowedScript(script)) {
        return { error: `script not whitelisted: ${script}`, allowed: listSkillScripts() };
      }
      const ws = (args.workspace as string) ?? deps.getRoot() ?? '';
      const check = validateWorkspace(ws);
      if (!check.ok) return { error: check.error };
      const scriptsDir = resolveSkillScriptsDir(ws);
      if (!scriptsDir) {
        return { error: 'skill scripts not found (run anic_install first, or set ANIC_SKILL_DIR)' };
      }
      const extraArgs = Array.isArray(args.args) ? (args.args as unknown[]).map(String) : [];
      const timeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 60000;
      const result = invokeSkillScript(scriptsDir, script, extraArgs, ws, timeout);
      return {
        script: result.script,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
      };
    },
  }) ?? null);

  return disposers;
}
