/**
 * FlowTracker 集成测试：anic_skill → FlowTracker → anic_status 端到端。
 *
 * 验证 M10-a 每流程状态跟踪的完整链路：
 * 1. anic_skill 工具调用 → FlowRecord 创建 + 持久化
 * 2. anic_status 工具查询 → flows + flowStats 返回
 * 3. flow-tracker.json 文件落盘可查
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerSkillGatewayTools } from '../../src/host/toolsSkillGateway.ts';
import type { ToolsSlot } from '../../src/host/toolsSlot.ts';
import { autoInstallSkill, resolveSkillScriptsDir, listSkillScripts } from '../../src/host/skillInvoker.ts';
import { loadFlowTracker, recentFlows, flowStats } from '../../src/host/runtime/flowTracker.ts';

let tempDir: string;
let workspace: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'flow-int-'));
  workspace = join(tempDir, 'project');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Stub ToolsSlot：收集注册的工具，供测试直接调用 handler。 */
function makeStubTools(): { tools: ToolsSlot; registrations: Map<string, any> } {
  const registrations = new Map<string, any>();
  const tools: ToolsSlot = {
    register: (reg) => {
      if (!reg) return undefined;
      registrations.set(reg.name, reg);
      return () => { registrations.delete(reg.name); };
    },
  };
  return { tools, registrations };
}

describe('FlowTracker 集成 — anic_skill → flow-tracker.json → anic_status', () => {
  it('anic_skill 调用后 .cycles/flow-tracker.json 落盘且可查', async () => {
    // 安装技能到工作区
    autoInstallSkill(workspace);
    const scriptsDir = resolveSkillScriptsDir(workspace);
    expect(scriptsDir).toBeTruthy();

    // 注册工具
    const { tools, registrations } = makeStubTools();
    const disposers = registerSkillGatewayTools(tools, { getRoot: () => workspace, register: tools.register });

    const skillTool = registrations.get('anic_skill');
    expect(skillTool).toBeDefined();

    // 调用 anic_skill 执行 init-workflow
    const result = await skillTool.handler({
      script: 'init-workflow',
      workspace,
      args: ['--name', 'flow-test-project'],
      timeout: 30000,
    });

    // 验证返回值包含 flowId
    expect(result.flowId).toBeDefined();
    expect(result.flowId).toMatch(/^init-workflow-/);
    expect(result.exitCode).toBe(0);

    // 验证 flow-tracker.json 落盘
    const trackerPath = join(workspace, '.cycles', 'flow-tracker.json');
    expect(existsSync(trackerPath)).toBe(true);

    // 验证文件内容
    const raw = JSON.parse(readFileSync(trackerPath, 'utf-8'));
    expect(raw.flows).toHaveLength(1);
    expect(raw.flows[0].script).toBe('init-workflow');
    expect(raw.flows[0].status).toBe('DONE');
    expect(raw.flows[0].exitCode).toBe(0);

    // 清理
    for (const d of disposers) if (typeof d === 'function') d();
  });

  it('多次 anic_skill 调用 → flowStats 统计正确', async () => {
    autoInstallSkill(workspace);
    const { tools, registrations } = makeStubTools();
    const disposers = registerSkillGatewayTools(tools, { getRoot: () => workspace, register: tools.register });
    const skillTool = registrations.get('anic_skill');

    // 调用两次 init-workflow（幂等）+ 一次 workflow-state
    await skillTool.handler({ script: 'init-workflow', workspace, args: ['--name', 'p1'], timeout: 30000 });
    await skillTool.handler({ script: 'init-workflow', workspace, args: ['--name', 'p1'], timeout: 30000 });
    await skillTool.handler({ script: 'workflow-state', workspace, args: ['status'], timeout: 10000 });

    // 查询 flowStats
    const cyclesDir = join(workspace, '.cycles');
    const state = loadFlowTracker(cyclesDir);
    const stats = flowStats(state);

    expect(stats['init-workflow'].total).toBe(2);
    expect(stats['init-workflow'].done).toBe(2);
    expect(stats['workflow-state'].total).toBe(1);

    // recentFlows 逆序
    const recent = recentFlows(state, 3);
    expect(recent).toHaveLength(3);
    expect(recent[0].script).toBe('workflow-state');
    expect(recent[1].script).toBe('init-workflow');

    for (const d of disposers) if (typeof d === 'function') d();
  });

  it('白名单外脚本被拒绝且不创建 FlowRecord', async () => {
    autoInstallSkill(workspace);
    const { tools, registrations } = makeStubTools();
    const disposers = registerSkillGatewayTools(tools, { getRoot: () => workspace, register: tools.register });
    const skillTool = registrations.get('anic_skill');

    const result = await skillTool.handler({ script: 'evil-script', workspace, args: [] });
    expect(result.error).toContain('not whitelisted');
    expect(result.allowed).toEqual(listSkillScripts());

    // 不应有 flow-tracker.json
    const trackerPath = join(workspace, '.cycles', 'flow-tracker.json');
    expect(existsSync(trackerPath)).toBe(false);

    for (const d of disposers) if (typeof d === 'function') d();
  });
});
