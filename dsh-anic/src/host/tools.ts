/**
 * DSH tool registration — exposes dsh-anic capabilities as DSH tools
 * that other sessions/agents can invoke (M8 G-TOOL).
 * INV-24: 'tools' in inject but we probe ctx.get('tools', false) for graceful degradation.
 */
import { resolveWorkspaceRoots, type SnapshotCtx } from './snapshotRoute.ts';
import { registerSkillGatewayTools } from './toolsSkillGateway.ts';
import type { ToolsSlot } from './toolsSlot.ts';
import { resolveSkillScriptsDir, invokeSkillScript, validateWorkspace } from './skillInvoker.ts';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadFlowTracker, recentFlows, flowStats } from './runtime/flowTracker.ts';
import { analyzeSkillHealth, formatHealthSummary } from './runtime/continuousLearning.ts';
import {
  evaluatePresentCall,
  iteratePresentCall,
  statusPresentCall,
  terminalResult,
} from './presentation.ts';

interface HostContext {
  tools?: ToolsSlot;
  get?: <T = unknown>(key: string, strict?: boolean) => T | undefined;
}

/** 注册 ANIC DSH 工具（evaluate/gate/skill 等）。 */
export function registerAnicTools(ctx: unknown): (() => void) | null {
  const c = ctx as HostContext;

  // INV-24: probe tools slot, don't hard-fail if absent
  let tools: ToolsSlot | undefined;
  if (c.tools) {
    tools = c.tools;
  } else if (typeof c.get === 'function') {
    tools = c.get<ToolsSlot>('tools', false);
  }
  if (!tools?.register) return null;

  const disposers: Array<(() => void) | null> = [];

  const getRoot = (): string | null => {
    try {
      return resolveWorkspaceRoots(c as SnapshotCtx);
    } catch {
      return null;
    }
  };

  // Tool: anic_evaluate — evaluate a project
  disposers.push(tools.register({
    name: 'anic_evaluate',
    description: 'Evaluate a project using the ai-native-iteration-cycle skill (eval-runner)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory (defaults to current workspace)' },
        dimensions: { type: 'string', description: 'Comma-separated dimension IDs (e.g. E1,E2,E3)' },
      },
    },
    presentCall: evaluatePresentCall,
    presentResult: (_args, result) => terminalResult(result, 'anic_evaluate ✓'),
    handler: async (args) => {
      const ws = (args.workspace as string) ?? getRoot() ?? '';
      const check = validateWorkspace(ws);
      if (!check.ok) return { error: check.error };
      const scriptsDir = resolveSkillScriptsDir(ws);
      if (!scriptsDir) return { error: 'skill scripts not found' };
      const dimArgs = args.dimensions ? ['--dimensions', args.dimensions as string] : [];
      const result = invokeSkillScript(scriptsDir, 'eval-runner', dimArgs, ws, 60000);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
        timedOut: result.timedOut,
      };
    },
  }) ?? null);

  // Tool: anic_iterate — run one iteration cycle on a project
  disposers.push(tools.register({
    name: 'anic_iterate',
    description: 'Run one iteration cycle (eval + gate-check) on a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    presentCall: iteratePresentCall,
    presentResult: () => ({ card: 'generic' as const, title: 'anic_iterate ✓' }),
    handler: async (args) => {
      const ws = (args.workspace as string) ?? getRoot() ?? '';
      const check = validateWorkspace(ws);
      if (!check.ok) return { error: check.error };
      const scriptsDir = resolveSkillScriptsDir(ws);
      if (!scriptsDir) return { error: 'skill scripts not found' };
      const evalResult = invokeSkillScript(scriptsDir, 'eval-runner', [], ws, 60000);
      const gateResult = invokeSkillScript(scriptsDir, 'gate-check', ['--gate', 'all', '--quality', '--record'], ws, 60000);
      return {
        eval: { exitCode: evalResult.exitCode, stdout: evalResult.stdout.slice(0, 4000) },
        gate: { exitCode: gateResult.exitCode, stdout: gateResult.stdout.slice(0, 4000) },
      };
    },
  }) ?? null);

  // Tool: anic_gate_check — run gate checks on a project
  disposers.push(tools.register({
    name: 'anic_gate_check',
    description: 'Run gate checks (gate-check --gate all --quality --record) on a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
        gate: { type: 'string', description: 'Specific gate (default: all)' },
      },
    },
    handler: async (args) => {
      const ws = (args.workspace as string) ?? getRoot() ?? '';
      const check = validateWorkspace(ws);
      if (!check.ok) return { error: check.error };
      const scriptsDir = resolveSkillScriptsDir(ws);
      if (!scriptsDir) return { error: 'skill scripts not found' };
      const gate = (args.gate as string) ?? 'all';
      const result = invokeSkillScript(scriptsDir, 'gate-check', ['--gate', gate, '--quality', '--record'], ws, 60000);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 8000),
        stderr: result.stderr.slice(0, 4000),
      };
    },
  }) ?? null);

  // Tool: anic_bootstrap — self-bootstrap (evaluate dsh-anic itself)
  disposers.push(tools.register({
    name: 'anic_bootstrap',
    description: 'Self-bootstrap: evaluate dsh-anic itself using the skill (produces tech-debt proposals, does NOT self-modify code)',
    inputSchema: {
      type: 'object',
      properties: {
        maxRounds: { type: 'number', description: 'Max bootstrap rounds (default 3)' },
      },
    },
    handler: async (args) => {
      const root = getRoot();
      if (!root) return { error: 'no workspace' };
      const scriptsDir = resolveSkillScriptsDir(root);
      if (!scriptsDir) return { error: 'skill scripts not found' };
      // Run eval + gate on dsh-anic's own workspace
      const evalResult = invokeSkillScript(scriptsDir, 'eval-runner', [], root, 60000);
      const gateResult = invokeSkillScript(scriptsDir, 'gate-check', ['--gate', 'all', '--quality', '--record'], root, 60000);
      return {
        selfBootstrap: true,
        eval: { exitCode: evalResult.exitCode, stdout: evalResult.stdout.slice(0, 4000) },
        gate: { exitCode: gateResult.exitCode, stdout: gateResult.stdout.slice(0, 4000) },
        note: 'Tech-debt proposals written to .cycles/tech-debt/. No code was auto-modified (R-31).',
      };
    },
  }) ?? null);

  // Tool: anic_snapshot — get workflow snapshot
  disposers.push(tools.register({
    name: 'anic_snapshot',
    description: 'Get the workflow snapshot (nodes, edges, cycles, ledger) for a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    handler: async (args) => {
      // Delegate to the snapshot route's core logic
      const root = (args.workspace as string) ?? getRoot() ?? '';
      const check = validateWorkspace(root);
      if (!check.ok) return { error: check.error };
      // The snapshot route handles this; for tools we return a pointer
      return { snapshotUrl: `/anic/api/workflow-snapshot?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  // Tool: anic_self_check — runtime INV probes
  disposers.push(tools.register({
    name: 'anic_self_check',
    description: 'Run runtime invariant probes (INV-13/18/21/25/26) on a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    handler: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      return { selfCheckUrl: `/anic/api/self-check?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  // Tool: anic_hitl — run HITL audit (native, no skill dependency)
  disposers.push(tools.register({
    name: 'anic_hitl',
    description: 'Run HITL audit (H1 sensitive files / H2 gitignore / H3 destructive / H4 ledger integrity) on a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    handler: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      return { hitlUrl: `/anic/hitl-audit?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  // Tool: anic_status — get full org status panorama + recent flow tracker records
  disposers.push(tools.register({
    name: 'anic_status',
    description: 'Get full org status panorama (cycles + ledger + trust + autonomy + band + flows) for a project, plus recent skill invocation flow records',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
        flowLimit: { type: 'number', description: 'Max recent flow records to return (default 10, max 50)' },
      },
    },
    presentCall: statusPresentCall,
    handler: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      const flowLimit = Math.min(Math.max(typeof args.flowLimit === 'number' ? args.flowLimit : 10, 1), 50);
      // M10-a/e：FlowTracker 最近记录 + 统计 + 持续学习健康报告
      const cyclesDir = join(root, '.cycles');
      let flows: unknown[] = []; let stats: Record<string, unknown> = {};
      let health: unknown = null; let healthSummary = '';
      if (existsSync(cyclesDir)) {
        const ts = loadFlowTracker(cyclesDir);
        flows = recentFlows(ts, flowLimit); stats = flowStats(ts);
        const report = analyzeSkillHealth(ts);
        health = report; healthSummary = formatHealthSummary(report);
      }
      return { statusUrl: `/anic/org-status?workspace=${encodeURIComponent(root)}`, flows, flowStats: stats, health, healthSummary };
    },
  }) ?? null);

  // 技能调用域工具（anic_install + anic_skill 通用网关）拆分至 toolsSkillGateway.ts
  // （T3 ≤250 行模块化纪律）；disposer 一并纳入本聚合器的清理面。
  disposers.push(...registerSkillGatewayTools(tools, { getRoot, register: tools.register }));

  const cleanups = disposers.filter((d): d is () => void => typeof d === 'function');
  if (cleanups.length === 0) return null;
  return () => { for (const d of cleanups) d(); };
}
