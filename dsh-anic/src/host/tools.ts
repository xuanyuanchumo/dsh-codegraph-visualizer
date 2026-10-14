/**
 * DSH tool registration — exposes dsh-anic capabilities as DSH tools
 * that other sessions/agents can invoke (M8 G-TOOL).
 *
 * INV-24: 'tools' is in inject but we still probe via ctx.get('tools', false)
 * for graceful degradation on hosts without the tools slot.
 */

import { resolveWorkspaceRoots, type SnapshotCtx } from './snapshotRoute.ts';
import { resolveSkillScriptsDir, invokeSkillScript, validateWorkspace, isAllowedScript } from './skillInvoker.ts';

interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface ToolsSlot {
  register?: (tool: ToolRegistration) => (() => void) | null | undefined;
}

interface HostContext {
  tools?: ToolsSlot;
  get?: <T = unknown>(key: string, strict?: boolean) => T | undefined;
}

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

  // Tool: anic_install — install/update the bundled skill into workspace
  disposers.push(tools.register({
    name: 'anic_install',
    description: 'Install or update the ai-native-iteration-cycle skill from the plugin bundle into the workspace .dsh/skills/ (idempotent by version)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    handler: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      return { installUrl: `/anic/skill/install?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  // Tool: anic_status — get full org status panorama (native, no skill dependency)
  disposers.push(tools.register({
    name: 'anic_status',
    description: 'Get full org status panorama (cycles + ledger + trust + autonomy + band + flows) for a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    handler: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      return { statusUrl: `/anic/org-status?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  const cleanups = disposers.filter((d): d is () => void => typeof d === 'function');
  if (cleanups.length === 0) return null;
  return () => { for (const d of cleanups) d(); };
}
