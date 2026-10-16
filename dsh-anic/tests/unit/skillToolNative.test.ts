/**
 * 技能脚本 DSH 原生调用面验证（用户要求：所有功能业务内容脚本必须能在 DSH 里原生调用）。
 *
 * 证明链：
 * 1. 契约——白名单 15 脚本与内联底座 scripts/ 目录的 .mjs 集合恰好相等（不多不少，
 *    mcp-server.mjs 为传输层有意排除）；
 * 2. 行为——anic_skill 工具经 stub 宿主槽位真实 spawn 脚本（安装→调用→断言落盘产物）；
 * 3. 防漂移——schema 的 script 枚举在运行时取自 listSkillScripts()，绝无手抄第二份；
 * 4. 清理——dispose 调用每一个注册 disposer（聚合器泄漏教训：断言次数，不断言"被调过"）。
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { rmSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAnicTools } from '../../src/host/tools.ts';
import { listSkillScripts, isSkillInstalled } from '../../src/host/skillInvoker.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SCRIPTS = join(HERE, '..', '..', 'assets', 'skill', 'scripts');
const TMP = join(HERE, 'tmp-skill-tool-native');
const WS_A = join(TMP, 'ws-native');
const WS_B = join(TMP, 'ws-install');

afterAll(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 并发清理容忍 */ }
});

/** stub 宿主：tools 槽位捕获注册 + workspaceRegistry 提供 root（resolveWorkspaceRoots 第一来源）。 */
function makeStubHost(root: string) {
  const registered: Array<{ name: string; execute: (a: Record<string, unknown>) => Promise<Record<string, unknown>>; parameters: Record<string, unknown> }> = [];
  const disposers = Array.from({ length: 32 }, () => vi.fn());
  let call = 0;
  const ctx = {
    tools: {
      register: (tool: (typeof registered)[number]) => {
        registered.push(tool);
        return disposers[call++] ?? vi.fn();
      },
    },
    workspaceRegistry: { list: () => [{ path: root }] },
  };
  return { ctx, registered, disposers };
}

describe('契约：白名单 ⇄ 内联底座脚本集合恰好相等（15/15 原生可达）', () => {
  it('scripts/ 下除 mcp-server.mjs 外的每个 .mjs 都在白名单，且无白名单项缺失', () => {
    const bundled = readdirSync(BUNDLED_SCRIPTS)
      .filter((n) => n.endsWith('.mjs'))
      .map((n) => n.replace(/\.mjs$/, ''))
      .filter((n) => n !== 'mcp-server') // 传输层有意排除（16 号文档 §5.3）
      .sort();
    const whitelist = [...listSkillScripts()].sort();
    expect(whitelist).toEqual(bundled);
    expect(whitelist.length).toBe(15); // 双向钉死：既防漏也防手误新增
  });
});

describe('行为：anic_skill 原生调用（经 stub 宿主槽位）', () => {
  it('安装（anic_install 真执行）→ anic_skill 调 workflow-state 全链退出 0', async () => {
    const { ctx, registered } = makeStubHost(WS_B);
    expect(registerAnicTools(ctx)).not.toBeNull();
    const install = registered.find((t) => t.name === 'anic_install')!;
    const skill = registered.find((t) => t.name === 'anic_skill')!;

    const ir = await install.execute({ workspace: WS_B });
    expect(ir.installed).toBe(true);
    expect(ir.skillInstalled).toBe(true);
    expect(isSkillInstalled(WS_B)).toBe(true);
    expect(existsSync(join(WS_B, '.dsh', 'skills', 'ai-native-iteration-cycle', 'SKILL.md'))).toBe(true);

    // 真实用户旅程：安装 → init（脚手架 .cycles/）→ workflow-state 读取
    const init = await skill.execute({ script: 'init-workflow', workspace: WS_B });
    expect(init.exitCode).toBe(0);
    const r = await skill.execute({ script: 'workflow-state', workspace: WS_B, args: ['status'] });
    expect(r.error).toBeUndefined();
    expect(r.exitCode).toBe(0);
    expect(String(r.stdout).length).toBeGreaterThan(0);
  });

  it('args 透传：init-workflow --name 落盘 config.yml（位置参数约定全链贯通）', async () => {
    mkdirSync(WS_A, { recursive: true }); // 现实场景：空项目目录已存在（未安装技能）
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    const skill = registered.find((t) => t.name === 'anic_skill')!;
    const r = await skill.execute({ script: 'init-workflow', workspace: WS_A, args: ['--name', 'tool-e2e'] });
    expect(r.exitCode).toBe(0);
    const cfg = readFileSync(join(WS_A, '.cycles', 'config.yml'), 'utf-8');
    expect(cfg).toContain('tool-e2e');
    // workspace 是第一个位置参数（P1 回归）：工作区有产物、scripts 目录无幽灵残留
    expect(existsSync(join(WS_A, '.cycles'))).toBe(true);
    const phantom = readdirSync(BUNDLED_SCRIPTS).filter((n) => n.includes('project-dir'));
    expect(phantom).toEqual([]);
  });

  it('白名单外脚本（含传输层 mcp-server）拒绝并回显 allowed 清单', async () => {
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    const skill = registered.find((t) => t.name === 'anic_skill')!;
    for (const bad of ['mcp-server', 'rm-rf', '../../escape']) {
      const r = await skill.execute({ script: bad, workspace: WS_A });
      expect(String(r.error)).toContain('not whitelisted');
      expect(Array.isArray(r.allowed)).toBe(true);
      expect((r.allowed as string[]).length).toBe(15);
    }
  });

  it('schema 的 script 枚举运行时取自 listSkillScripts()（单一事实源防漂移）', () => {
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    const skill = registered.find((t) => t.name === 'anic_skill')!;
    const schema = skill.parameters as { properties: { script: { enum: string[] } } };
    expect(schema.properties.script.enum).toEqual(listSkillScripts());
  });

  it('工具面完整：anic_skill 注册后工具总数 ≥10 且名字唯一', () => {
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    const names = registered.map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
    for (const required of ['anic_evaluate', 'anic_skill', 'anic_install']) {
      expect(names).toContain(required);
    }
  });

  it('dispose 调用每一个注册 disposer（聚合器泄漏守卫：断言次数）', () => {
    const { ctx, registered, disposers } = makeStubHost(WS_A);
    const dispose = registerAnicTools(ctx);
    expect(dispose).not.toBeNull();
    dispose!();
    const used = disposers.slice(0, registered.length);
    for (const d of used) expect(d).toHaveBeenCalledTimes(1);
  });
});

// ── P0-TOOLS-FIELDS 回归：DSH 工具槽位的真实读取面 ──
// 宿主证据（app.asar ToolRuntime）：register() 注册时只校验 output；`parameters`
// 在**会话发起**时由 wireSchemas → schemaOf 解构读取（undefined → 整个对话抛
// `tool "<name>" parameters must be lossless JSON before schema projection`）；
// 工具体由 dispatchToolBody 调 `tool.execute(exec.arguments, exec)`。
// 旧实现用 inputSchema/handler 字段名：注册成功、日志显示"12 tools registered"，
// 但每次真实对话立即失败 —— stub 宿主从不读这两个字段，所以只有把宿主的
// **读取面**转录成断言才能抓住这类缺陷（fixture 写什么形状，stub 就只会什么形状）。
describe('契约：DSH 工具槽位字段名（parameters/execute/output，P0-TOOLS-FIELDS 回归）', () => {
  it('全部注册工具都有 parameters（无 JSON 读写丢失）且为 object 根', () => {
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    expect(registered.length).toBeGreaterThanOrEqual(12);
    for (const t of registered) {
      expect(t.parameters, `tool ${t.name} 缺 parameters`).toBeDefined();
      // 宿主 snapshotJsonValue 语义：JSON 往返必须逐字节等值（lossless）
      expect(JSON.parse(JSON.stringify(t.parameters))).toEqual(t.parameters);
      expect((t.parameters as { type?: string }).type).toBe('object');
    }
  });

  it('全部注册工具的 execute 是函数（dispatchToolBody 调 tool.execute）', () => {
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    for (const t of registered) {
      expect(typeof t.execute, `tool ${t.name} 缺 execute`).toBe('function');
    }
  });

  it('全部注册工具的 output 声明齐全（register() 唯一注册期校验）', () => {
    const { ctx, registered } = makeStubHost(WS_A);
    registerAnicTools(ctx);
    for (const t of registered) {
      const out = (t as { output?: { schema?: unknown; render?: unknown } }).output;
      expect(out, `tool ${t.name} 缺 output`).toBeDefined();
      expect(out!.schema).toBeDefined();
      expect(typeof out!.render).toBe('function');
    }
  });

  it('源码形态：工具域不再出现旧字段名 inputSchema:/handler:（漂移守卫）', () => {
    const HERE2 = dirname(fileURLToPath(import.meta.url));
    const hostDir = join(HERE2, '..', '..', 'src', 'host');
    const offenders: string[] = [];
    for (const f of readdirSync(hostDir)) {
      if (!/^tools.*\.ts$/.test(f)) continue;
      const src = readFileSync(join(hostDir, f), 'utf-8');
      // 旧字段名以冒号形式出现（inputSchema: / 四空格缩进的 handler:）
      if (/\binputSchema\s*:/.test(src)) offenders.push(`${f}: inputSchema:`);
      if (/^\s{4}handler\s*:/m.test(src)) offenders.push(`${f}: handler:`);
    }
    expect(offenders).toEqual([]);
    // 反向自检：本断言的样本由拼接构造（不落入被扫目录），正则确实能命中旧形状
    const OLD = ['inputSch' + 'ema: {', '    hand' + 'ler: async'].join('\n');
    expect(/\binputSchema\s*:/.test(OLD)).toBe(true);
    expect(/^\s{4}handler\s*:/m.test(OLD)).toBe(true);
  });
});
