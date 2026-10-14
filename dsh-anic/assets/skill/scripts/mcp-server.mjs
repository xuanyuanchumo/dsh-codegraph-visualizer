#!/usr/bin/env node
// mcp-server.mjs — AI-Native Iteration Cycle MCP Server
// 将确定性脚本暴露为 MCP tools，让 AI 可直接调用
// 用法: node scripts/mcp-server.mjs [--project-dir <path>]

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { _: [], projectDir: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--project-dir') args.projectDir = resolve(argv[++i]);
    else args._.push(argv[i]);
  }
  return args;
}

const args = parseArgs(process.argv);
const projectDir = args.projectDir;

function runScript(scriptName, scriptArgs = []) {
  const scriptPath = join(SKILL_ROOT, 'scripts', scriptName);
  if (!existsSync(scriptPath)) {
    return { success: false, error: `Script not found: ${scriptName}` };
  }
  try {
    const cmd = `node "${scriptPath}" "${projectDir}" ${scriptArgs.join(' ')}`;
    const output = execSync(cmd, { timeout: 120000, stdio: 'pipe', encoding: 'utf-8' });
    return { success: true, output };
  } catch (e) {
    return {
      success: false,
      error: e.stderr ? e.stderr.toString().trim() : e.message,
      exitCode: e.status,
    };
  }
}

function readYamlConfig() {
  const configPath = join(projectDir, '.cycles', 'config.yml');
  if (!existsSync(configPath)) return {};
  const content = readFileSync(configPath, 'utf-8');
  const config = {};
  const buildMatch = content.match(/build_cmd:\s*"([^"]+)"/);
  const testMatch = content.match(/test_cmd:\s*"([^"]+)"/);
  const lintMatch = content.match(/lint_cmd:\s*"([^"]+)"/);
  const autonomyMatch = content.match(/autonomy_level:\s*(L[1-4])/);
  if (buildMatch) config.build_cmd = buildMatch[1];
  if (testMatch) config.test_cmd = testMatch[1];
  if (lintMatch) config.lint_cmd = lintMatch[1];
  if (autonomyMatch) config.autonomy_level = autonomyMatch[1];
  return config;
}

const server = new Server(
  { name: "ai-native-iteration-cycle", version: "1.9.0" },
  { capabilities: { tools: {} } }
);


server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "init_workflow",
      description: "Initialize AI-Native Iteration Cycle workflow scaffold in a project directory. Creates directory structure, config files, and templates.",
      inputSchema: {
        type: "object",
        properties: {
          project_name: { type: "string", description: "Project name" },
          framework: { type: "string", enum: ["claude", "codex"], default: "claude" },
        },
        required: ["project_name"],
      },
    },
    {
      name: "init_cycle",
      description: "Initialize a new cycle workspace (cycle-{N}/) with templates for evaluation, planning, tasks, and audit.",
      inputSchema: {
        type: "object",
        properties: {
          cycle_number: { type: "number", description: "Cycle number (auto-incremented if omitted)" },
        },
      },
    },
    {
      name: "gate_check",
      description: "Run G0-G3 convergence gate checks with optional quality dimension checks. G0=evaluation baseline, G1=task completion, G2=test zero-fail, G3=build success. Quality: G0→Q1+Q5, G1→Q7, G2→Q2, G3→Q3+Q4.",
      inputSchema: {
        type: "object",
        properties: {
          gate: { type: "string", enum: ["G0", "G1", "G2", "G3", "all"], default: "all" },
          quality: { type: "boolean", description: "Enable quality dimension checks" },
          record: { type: "boolean", description: "Record each verdict into the hash-chained ledger (deduplicated; FAIL is recorded too — required for CB2 circuit breaker)" },
        },
      },
    },
    {
      name: "eval_runner",
      description: "Run E1-E8 evaluation dimensions and Q1-Q8 quality review dimensions. E1-E8=eval, Q1-Q8=quality review (functional/non-functional/design/UX/engineering).",
      inputSchema: {
        type: "object",
        properties: {
          dimensions: { type: "string", description: "Comma-separated dimensions (e.g. 'E1,E2,Q1,Q2'), default all" },
          cycle: { type: "number", description: "Cycle number (latest if omitted)" },
          quality: { type: "boolean", description: "Run only Q1-Q8 quality dimensions" },
        },
      },
    },
    {
      name: "band_detector",
      description: "Detect complexity budget violations, hotspots, and Western Electric rule violations in source code.",
      inputSchema: {
        type: "object",
        properties: {
          threshold: { type: "number", description: "Budget tolerance threshold (default 0.15)" },
          history: { type: "number", description: "Number of historical snapshots to analyze (default 10)" },
        },
      },
    },
    {
      name: "workflow_state",
      description: "Query or advance workflow state. Commands: status (show current state), advance (move to next phase), check (verify readiness to advance).",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", enum: ["status", "advance", "check"], default: "status" },
          node: { type: "string", description: "Target phase for advance command" },
        },
      },
    },
    {
      name: "gate_ledger",
      description: "Record, verify, or list gate results in the tamper-evident hash-chained ledger.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["record", "verify", "list"], default: "record" },
          gate: { type: "string", enum: ["G0", "G1", "G2", "G3"] },
          result: { type: "string", enum: ["PASS", "FAIL"] },
          detail: { type: "string", description: "Detail description" },
        },
        required: ["mode"],
      },
    },
    {
      name: "fact_base_verify",
      description: "Verify that paths and commands referenced in documentation actually exist in the repository.",
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "number", description: "Number of references to sample (default 5)" },
        },
      },
    },
    {
      name: "plan_sync_check",
      description: "Check that plan documents reference files and commands that exist in the codebase. Uses git diff for deterministic sync detection.",
      inputSchema: {
        type: "object",
        properties: {
          verbose: { type: "boolean", description: "Show unplanned changes detail" },
        },
      },
    },
    {
      name: "org_status",
      description: "Query or manage Agent organization: status (show autonomy/roles), agent (assign models), review (cycle review summary).",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", enum: ["status", "agent", "review", "auto-fallback"], default: "status" },
          role: { type: "string", description: "Agent role for assignment" },
          assign: { type: "string", description: "Model to assign to role" },
        },
      },
    },
    {
      name: "quick_validate",
      description: "Validate the AI-Native Iteration Cycle skill package integrity. Checks required files, directories, scripts, and evals.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "archive_cycle",
      description: "Archive completed cycles, clean old archives, or list cycle inventory. Commands: archive (move completed cycle to archive/), clean (remove old archives keeping N), list (show all cycles).",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", enum: ["archive", "clean", "list"], default: "list" },
          cycle: { type: "number", description: "Cycle number to archive (for archive command)" },
          keep: { type: "number", description: "Number of archives to keep (for clean command, default 5)" },
        },
      },
    },
    {
      name: "hitl_audit",
      description: "Run H1-H4 HITL automated audit checkpoints. H1=security sensitive ops, H2=destructive ops, H3=release gate, H4=gate arbitration. Circuit breaker triggers auto-downgrade.",
      inputSchema: {
        type: "object",
        properties: {
          gate: { type: "string", enum: ["H1", "H2", "H3", "H4", "all"], default: "all" },
        },
      },
    },
    {
      name: "auto_fix_loop",
      description: "Run automated fix loop: test failure → root cause diagnosis → fix → re-verify. Loops until failures=0 or max retries reached. Circuit breaker CB1 triggers on exhaustion.",
      inputSchema: {
        type: "object",
        properties: {
          max_retries: { type: "number", description: "Maximum fix retry attempts (default 3)" },
          test_cmd: { type: "string", description: "Custom test command (overrides config.yml test_cmd)" },
        },
      },
    },
    {
      name: "multi_agent_gate",
      description: "Run multi-agent gate evaluation for L4 autonomous mode. Each human gate (intent/spec/plan/pr/release) is evaluated by 3 different AI agents from different dimensions. 2/3 or 3/3 threshold for pass. Trust score >= 70% with auto_approve will auto-execute recommendation.",
      inputSchema: {
        type: "object",
        properties: {
          gate: { type: "string", enum: ["intent", "spec", "plan", "pr", "release", "all"], default: "all" },
          auto_approve: { type: "boolean", default: false, description: "Auto-execute recommendation when trust score >= 70%" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: toolArgs } = request.params;

  switch (name) {
    case "init_workflow": {
      const result = runScript('init-workflow.mjs', [
        `--name "${toolArgs.project_name || 'Project'}"`,
        toolArgs.framework ? `--framework ${toolArgs.framework}` : '',
      ]);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "init_cycle": {
      const cycleArgs = toolArgs.cycle_number ? [`--cycle ${toolArgs.cycle_number}`] : [];
      const result = runScript('init-cycle.mjs', cycleArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "gate_check": {
      const gateArgs = [`--gate ${toolArgs.gate || 'all'}`];
      if (toolArgs.quality) gateArgs.push('--quality');
      if (toolArgs.record) gateArgs.push('--record');
      const result = runScript('gate-check.mjs', gateArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "eval_runner": {
      const evalArgs = [];
      if (toolArgs.dimensions) evalArgs.push(`--dimensions ${toolArgs.dimensions}`);
      if (toolArgs.cycle) evalArgs.push(`--cycle ${toolArgs.cycle}`);
      if (toolArgs.quality) evalArgs.push('--quality');
      const result = runScript('eval-runner.mjs', evalArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "band_detector": {
      const bandArgs = [];
      if (toolArgs.threshold) bandArgs.push(`--threshold ${toolArgs.threshold}`);
      if (toolArgs.history) bandArgs.push(`--history ${toolArgs.history}`);
      const result = runScript('band-detector.mjs', bandArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "workflow_state": {
      const wsArgs = [toolArgs.command || 'status'];
      if (toolArgs.node) wsArgs.push(`--node ${toolArgs.node}`);
      const result = runScript('workflow-state.mjs', wsArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "gate_ledger": {
      const mode = toolArgs.mode || 'record';
      if (mode === 'verify') {
        const result = runScript('gate-ledger.mjs', ['--verify']);
        return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
      } else if (mode === 'list') {
        const result = runScript('gate-ledger.mjs', ['--list']);
        return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
      } else {
        const result = runScript('gate-ledger.mjs', [
          `--gate ${toolArgs.gate}`,
          `--result ${toolArgs.result}`,
          toolArgs.detail ? `--detail "${toolArgs.detail}"` : '',
        ]);
        return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
      }
    }

    case "fact_base_verify": {
      const verifyArgs = toolArgs.count ? [`--count ${toolArgs.count}`] : [];
      const result = runScript('fact-base-verify.mjs', verifyArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "plan_sync_check": {
      const psArgs = toolArgs.verbose ? ['--verbose'] : [];
      const result = runScript('plan-sync-check.mjs', psArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "org_status": {
      const osArgs = [toolArgs.command || 'status'];
      if (toolArgs.role) osArgs.push(`--role ${toolArgs.role}`);
      if (toolArgs.assign) osArgs.push(`--assign ${toolArgs.assign}`);
      const result = runScript('org-status.mjs', osArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "quick_validate": {
      const result = runScript('quick-validate.mjs', []);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "archive_cycle": {
      const cmd = toolArgs.command || 'list';
      const archArgs = [`--${cmd === 'archive' ? 'cycle' : cmd}`];
      if (cmd === 'archive' && toolArgs.cycle) archArgs.push(`${toolArgs.cycle}`);
      if (cmd === 'clean' && toolArgs.keep) archArgs.push(`--keep ${toolArgs.keep}`);
      const result = runScript('archive-cycle.mjs', archArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "hitl_audit": {
      const auditArgs = [`--gate ${toolArgs.gate || 'all'}`];
      const result = runScript('hitl-audit.mjs', auditArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "auto_fix_loop": {
      const fixArgs = [];
      if (toolArgs.max_retries) fixArgs.push(`--max-retries ${toolArgs.max_retries}`);
      if (toolArgs.test_cmd) fixArgs.push(`--test-cmd "${toolArgs.test_cmd}"`);
      const result = runScript('auto-fix-loop.mjs', fixArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    case "multi_agent_gate": {
      const magArgs = [`--gate ${toolArgs.gate || 'all'}`];
      if (toolArgs.auto_approve) magArgs.push('--auto-approve');
      const result = runScript('multi-agent-gate.mjs', magArgs);
      return { content: [{ type: "text", text: result.success ? result.output : `Error: ${result.error}` }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`AI-Native Iteration Cycle MCP Server v1.6.0 running (project: ${projectDir})`);