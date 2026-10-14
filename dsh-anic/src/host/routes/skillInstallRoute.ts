/**
 * 技能自动安装路由（方案 C）：POST /anic/skill/install + GET /anic/skill/status
 *
 * 语义：将内联技能从 dsh-anic/assets/skill/ 复制到工作区 .dsh/skills/。
 * - 幂等：已安装且 SKILL.md 版本一致 → 200 {alreadyInstalled:true}
 * - 未安装 → 复制 → 200 {installed:true}
 * - 安装插件即用：resolveSkillScriptsDir 已有内联兜底，此路由是"显式安装到工作区"
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScoped, newRequestId } from '../logger.ts';
import { isSkillInstalled, autoInstallSkill, resolveSkillScriptsDir } from '../skillInvoker.ts';

const log = createScoped('anic:route:skill-install');
export const SKILL_INSTALL_ROUTE = '/anic/skill/install';
export const SKILL_STATUS_ROUTE = '/anic/skill/status';

interface SendFn {
  (res: unknown, status: number, body: unknown, requestId?: string): void;
}

function readSkillVersion(dir: string): string | null {
  try {
    const md = readFileSync(join(dir, 'SKILL.md'), 'utf-8');
    const m = md.match(/version[:\s]+v?([0-9]+\.[0-9]+\.[0-9]+)/i);
    return m?.[1] ?? null;
  } catch { return null; }
}

function getInlineSkillDir(): string | null {
  const scriptsDir = resolveSkillScriptsDir(process.cwd());
  if (!scriptsDir) return null;
  return join(scriptsDir, '..');
}

export function registerSkillInstallRoute(
  ctx: unknown,
  deps: { send: SendFn; getWorkspaceRoot: () => string | null },
): Array<(() => void) | null> {
  const ws = (ctx as { webServer?: { register: (r: { kind: string; path: string; handler: (req: unknown, res: unknown) => void }) => (() => void) | void } }).webServer;
  if (!ws || typeof ws.register !== 'function') return [];

  const disposers: Array<(() => void) | null> = [];

  // POST /anic/skill/install
  const d1 = ws.register({
    kind: 'exact',
    path: SKILL_INSTALL_ROUTE,
    handler: (req, res) => {
      const requestId = newRequestId();
      const r = req as { method?: string };
      if ((r?.method ?? 'GET') !== 'POST') {
        deps.send(res, 405, { error: 'POST only' }, requestId);
        return;
      }
      const root = deps.getWorkspaceRoot();
      if (!root) {
        deps.send(res, 404, { error: { code: 'ANIC_ROUTE_NO_WORKSPACE', message: 'no workspace resolvable' } }, requestId);
        return;
      }
      const alreadyInstalled = isSkillInstalled(root);
      const inlineDir = getInlineSkillDir();
      const inlineVersion = inlineDir ? readSkillVersion(inlineDir) : null;
      const installedVersion = alreadyInstalled ? readSkillVersion(join(root, '.dsh', 'skills', 'ai-native-iteration-cycle')) : null;

      if (alreadyInstalled && inlineVersion && installedVersion && inlineVersion === installedVersion) {
        deps.send(res, 200, { alreadyInstalled: true, version: installedVersion, path: join(root, '.dsh', 'skills', 'ai-native-iteration-cycle') }, requestId);
        return;
      }

      const result = autoInstallSkill(root);
      if (!result.installed) {
        deps.send(res, 500, { error: { code: 'ANIC_ROUTE_SKILL_INSTALL_FAILED', message: result.error ?? 'unknown error' } }, requestId);
        return;
      }
      log.info(`skill auto-installed to ${result.path}`, requestId);
      deps.send(res, 200, { installed: true, version: inlineVersion, path: result.path, upgraded: alreadyInstalled }, requestId);
    },
  });
  if (typeof d1 === 'function') disposers.push(d1);

  // GET /anic/skill/status
  const d2 = ws.register({
    kind: 'exact',
    path: SKILL_STATUS_ROUTE,
    handler: (req, res) => {
      const requestId = newRequestId();
      const r = req as { method?: string };
      if ((r?.method ?? 'GET') !== 'GET') {
        deps.send(res, 405, { error: 'GET only' }, requestId);
        return;
      }
      const root = deps.getWorkspaceRoot();
      if (!root) {
        deps.send(res, 404, { error: { code: 'ANIC_ROUTE_NO_WORKSPACE', message: 'no workspace resolvable' } }, requestId);
        return;
      }
      const installed = isSkillInstalled(root);
      const scriptsDir = resolveSkillScriptsDir(root);
      const inlineDir = getInlineSkillDir();
      deps.send(res, 200, {
        installed,
        installedVersion: installed ? readSkillVersion(join(root, '.dsh', 'skills', 'ai-native-iteration-cycle')) : null,
        scriptsResolved: scriptsDir !== null,
        scriptsSource: scriptsDir,
        inlineAvailable: inlineDir !== null,
        inlineVersion: inlineDir ? readSkillVersion(inlineDir) : null,
      }, requestId);
    },
  });
  if (typeof d2 === 'function') disposers.push(d2);

  return disposers;
}
