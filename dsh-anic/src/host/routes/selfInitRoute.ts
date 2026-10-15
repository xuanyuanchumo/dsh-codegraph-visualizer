/**
 * B 自举路由（docs/anic/12 §2.3 的 M1 落地切片）：POST /anic/self/init
 *
 * 语义：对**当前工作区**执行技能 init-workflow（自己吃自己的狗粮）。
 * - 幂等：工作区已有 canonical 配置 → 409 + 响亮（12 §2.3，拒绝重跑）。
 * - flow.selfInit 开关关闭 → 403（13 §2.2 关闭形态契约；INV-29 不涉及本路由——
 *   它不在核心链路上，允许被关）。
 * - 技能定位（12 §1.3 路径无关）：ANIC_SKILL_DIR 环境变量 → 工作区 .dsh/skills/
 *   ai-native-iteration-cycle → 仓库根 .dsh/skills/...；找不到 = 404 响亮报错，
 *   **绝不发明默认网络源**。
 * - INV-26：本路由自身错误只进日志/响应，**绝不写 `.cycles/incidents/`**。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createScoped, newRequestId } from '../logger.ts';
import { resolveSkillScriptsDir } from '../skillInvoker.ts';

const log = createScoped('anic:route:self-init');
export const SELF_INIT_ROUTE = '/anic/self/init';

export interface SelfInitCtx {
  /** 宿主会话或 CWD 推导出的工作区根（宿主侧已验证的允许根，security 先行） */
  workspaceRoot: string;
  flows: { selfInit: boolean };
}

interface SendLike {
  (res: unknown, status: number, body: unknown, requestId?: string): void;
}

/** 注册自初始化路由（POST /anic/self/init）。 */
export function registerSelfInitRoute(ctx: unknown, deps: { send: SendLike; getWorkspaceRoot: () => string | null; loadFlows: () => { selfInit: boolean } }): (() => void) | null {
  const webServer = (ctx as { webServer?: { register: (r: { kind: string; path: string; handler: (req: unknown, res: unknown) => void }) => (() => void) | void } }).webServer;
  if (!webServer || typeof webServer.register !== 'function') return null;

  const dispose = webServer.register({
    kind: 'exact',
    path: SELF_INIT_ROUTE,
    handler: (req: unknown, res: unknown) => {
      const requestId = newRequestId();
      const r = req as { method?: string } | undefined;
      if ((r?.method ?? 'GET') !== 'POST') {
        deps.send(res, 405, { error: 'POST only' }, requestId);
        return;
      }
      if (!deps.loadFlows().selfInit) {
        deps.send(res, 403, { error: { code: 'ANIC_ROUTE_SELF_INIT_DISABLED', message: 'flow.selfInit is switched off (workspace/deployment layer)' } }, requestId);
        return;
      }
      const root = deps.getWorkspaceRoot();
      if (!root) {
        deps.send(res, 404, { error: { code: 'ANIC_ROUTE_SELF_INIT_NO_WORKSPACE', message: 'no workspace resolvable' } }, requestId);
        return;
      }
      const configPath = join(root, '.cycles', 'config.yml');
      if (existsSync(configPath)) {
        deps.send(res, 409, { error: { code: 'ANIC_ROUTE_SELF_INIT_ALREADY', message: `.cycles/config.yml already exists at this workspace — self-init is refuse-to-rerun (idempotent by design)` } }, requestId);
        return;
      }
      // --name 透传（init-workflow.mjs:66 的 N-6 修复要求项目名落盘 config.yml）；
      // 缺省时保持脚本默认 "my-project"，与裸脚本调用行为一致。
      const rawBody = (req as { body?: unknown }).body;
      let bodyJson: Record<string, unknown> = {};
      if (typeof rawBody === 'string') {
        try { bodyJson = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* 非 JSON body → 缺省名 */ }
      } else if (rawBody && typeof rawBody === 'object') {
        bodyJson = rawBody as Record<string, unknown>;
      }
      const nameArg = typeof bodyJson.name === 'string' && bodyJson.name.trim() !== ''
        ? ['--name', bodyJson.name.trim()]
        : [];
      const scriptsDir = resolveSkillScriptsDir(root);
      if (!scriptsDir) {
        deps.send(res, 404, { error: { code: 'ANIC_ROUTE_SELF_INIT_SKILL_MISSING', message: 'skill scripts not found (tried ANIC_SKILL_DIR / workspace .dsh / repo .dsh)' } }, requestId);
        return;
      }
      const started = Date.now();
      const result = spawnSync(process.execPath, [join(scriptsDir, 'init-workflow.mjs'), root, ...nameArg], {
        cwd: root,
        encoding: 'utf-8',
        timeout: 60_000,
      });
      const ok = result.status === 0;
      const body = {
        ok,
        requestId,
        durationMs: Date.now() - started,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        configPath: ok ? configPath : null,
        digest: ok ? createHash('sha256').update(String(result.stdout)).digest('hex').slice(0, 16) : null,
      };
      log[ok ? 'info' : 'error'](`self-init ${ok ? 'completed' : 'failed'} in ${body.durationMs}ms`, requestId);
      deps.send(res, ok ? 200 : 500, body, requestId);
    },
  });
  return typeof dispose === 'function' ? dispose : null;
}
