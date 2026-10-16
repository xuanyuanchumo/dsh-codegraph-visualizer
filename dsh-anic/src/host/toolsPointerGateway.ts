/**
 * 指针型 DSH 工具——返回路由 URL 供前端/大模型进一步查询。
 *
 * 拆分自 tools.ts（T3 ≤250 行模块化纪律）。
 * anic_snapshot / anic_self_check / anic_hitl 三个工具的共同模式：
 * 校验 workspace → 返回对应路由 URL。无副作用，无脚本调用。
 */
import type { ToolRegistration } from './toolsSlot.ts';
import { makeToolOutput } from './toolsSlot.ts';
import { validateWorkspace } from './skillInvoker.ts';

/** 注册指针型 DSH 工具（anic_snapshot/anic_self_check/anic_hitl）。 */
export function registerPointerTools(
  register: (tool: ToolRegistration) => (() => void) | null | undefined,
  getRoot: () => string | null,
): Array<(() => void) | null> {
  const disposers: Array<(() => void) | null> = [];

  // Tool: anic_snapshot — get workflow snapshot
  disposers.push(register({
    name: 'anic_snapshot',
    description: 'Get the workflow snapshot (nodes, edges, cycles, ledger) for a project',
    output: makeToolOutput(),
    parameters: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    execute: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      const check = validateWorkspace(root);
      if (!check.ok) return { error: check.error };
      return { snapshotUrl: `/anic/api/workflow-snapshot?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  // Tool: anic_self_check — runtime INV probes
  disposers.push(register({
    name: 'anic_self_check',
    description: 'Run runtime invariant probes (INV-13/18/21/25/26) on a project',
    output: makeToolOutput(),
    parameters: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    execute: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      return { selfCheckUrl: `/anic/api/self-check?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  // Tool: anic_hitl — run HITL audit (native, no skill dependency)
  disposers.push(register({
    name: 'anic_hitl',
    description: 'Run HITL audit (H1 sensitive files / H2 gitignore / H3 destructive / H4 ledger integrity) on a project',
    output: makeToolOutput(),
    parameters: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Target project directory' },
      },
    },
    execute: async (args) => {
      const root = (args.workspace as string) ?? getRoot() ?? '';
      return { hitlUrl: `/anic/hitl-audit?workspace=${encodeURIComponent(root)}` };
    },
  }) ?? null);

  return disposers;
}
