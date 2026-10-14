#!/usr/bin/env node
// workflow-state.mjs — 工作流图运行时：支持 status/advance/check 命令推进图节点
// 用法:
//   状态: node workflow-state.mjs <project-dir> status
//   推进: node workflow-state.mjs <project-dir> advance [--node <node-id>]
//   检查: node workflow-state.mjs <project-dir> check

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listCycleDirNames } from './lib/cycle.mjs';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

function parseArgs(argv) {
  const args = { _: [], node: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--node') args.node = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

const PHASES = [
  { id: 'plan', name: 'Plan（规划）', gates: ['G0'] },
  { id: 'design', name: 'Design（设计）', gates: ['G0'] },
  { id: 'build', name: 'Build（构建）', gates: ['G1'] },
  { id: 'test', name: 'Test（测试）', gates: ['G2'] },
  { id: 'deploy', name: 'Deploy（部署）', gates: ['G3'] },
  { id: 'maintain', name: 'Maintain（维护）', gates: [] },
];

function loadWorkflowGraph(projectDir) {
  const graphPath = join(projectDir, '.cycles', 'workflow-graph.yaml');
  if (!existsSync(graphPath)) return null;
  return readFileSync(graphPath, 'utf-8');
}

function loadState(projectDir) {
  const statePath = join(projectDir, '.cycles', 'workflow-state.json');
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

function saveState(projectDir, state) {
  const cyclesDir = join(projectDir, '.cycles');
  if (!existsSync(cyclesDir)) mkdirSync(cyclesDir, { recursive: true });
  // v1.8.3：原子写（S-6 家族收尾——半写的 workflow-state.json 会让状态机下次启动解析失败）
  atomicWriteFileSync(join(cyclesDir, 'workflow-state.json'), JSON.stringify(state, null, 2));
}

function initState(projectDir) {
  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  let currentCycle = null;
  // v1.8.3：数值序（原 .sort() 字典序在 cycle-10 之后会把 currentCycle 指到 cycle-9）
  const cycleDirs = listCycleDirNames(cyclesDir);
  if (cycleDirs.length > 0) currentCycle = cycleDirs[cycleDirs.length - 1];
  return {
    currentPhase: 'plan',
    currentCycle,
    phaseHistory: [],
    nodeStatus: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getCycleArtifacts(projectDir, cycleName) {
  if (!cycleName) return {};
  const cyclePath = join(projectDir, '.cycles', 'cycles', cycleName);
  if (!existsSync(cyclePath)) return {};

  const artifacts = {};
  const files = [
    ['项目评估报告.md', 'eval'],
    ['当前循环总规划.md', 'plan'],
    ['任务清单.md', 'tasks'],
    ['当前循环页面状态.md', 'pageState'],
    ['审计日志.md', 'audit'],
    ['交付清单.md', 'delivery'],
    ['非功能验证报告.md', 'nonFunc'],
  ];
  for (const [filename, key] of files) {
    artifacts[key] = existsSync(join(cyclePath, filename));
  }

  const testDir = join(cyclePath, 'test-reports');
  artifacts.testReports = existsSync(testDir) && readdirSync(testDir).filter(e => e.endsWith('.md')).length > 0;

  return artifacts;
}

function inferPhase(artifacts) {
  if (artifacts.eval && !artifacts.plan) return 'plan';
  if (artifacts.plan && !artifacts.tasks) return 'design';
  if (artifacts.tasks && !artifacts.testReports) return 'build';
  if (artifacts.testReports) return 'test';
  return 'plan';
}

function getGateResults(projectDir) {
  const gatesDir = join(projectDir, '.cycles', 'gates');
  if (!existsSync(gatesDir)) return { passed: [], failed: [] };

  const ledgerPath = join(gatesDir, 'ledger.json');
  if (!existsSync(ledgerPath)) return { passed: [], failed: [] };

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf-8'));
  const passed = ledger.entries.filter(e => e.result === 'PASS').map(e => e.gate);
  const failed = ledger.entries.filter(e => e.result === 'FAIL').map(e => e.gate);
  return { passed, failed };
}

function cmdStatus(projectDir) {
  let state = loadState(projectDir);
  if (!state) {
    state = initState(projectDir);
    saveState(projectDir, state);
  }

  const artifacts = getCycleArtifacts(projectDir, state.currentCycle);
  const inferredPhase = inferPhase(artifacts);
  if (inferredPhase !== state.currentPhase) {
    state.currentPhase = inferredPhase;
    state.updatedAt = new Date().toISOString();
    saveState(projectDir, state);
  }

  const gateResults = getGateResults(projectDir);
  const currentPhaseIdx = PHASES.findIndex(p => p.id === state.currentPhase);
  const currentPhase = PHASES[currentPhaseIdx];

  console.log(`=== AI-Native Iteration Cycle Workflow State ===`);
  console.log(`Project: ${projectDir}`);
  console.log(``);

  if (state.currentCycle) {
    console.log(`Current Cycle: ${state.currentCycle}`);
  } else {
    console.log(`No cycles initialized. Run init-workflow + init-cycle to start.`);
  }

  console.log(``);
  console.log(`Current Phase: ${currentPhase.name} (${state.currentPhase})`);
  console.log(`  Artifacts:`);
  for (const [key, exists] of Object.entries(artifacts)) {
    console.log(`    ${exists ? '[x]' : '[ ]'} ${key}`);
  }

  console.log(``);
  console.log(`Phase Progress:`);
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];
    const marker = i === currentPhaseIdx ? '>>>' : i < currentPhaseIdx ? ' [x]' : ' [ ]';
    console.log(`  ${marker} ${phase.name}`);
    if (phase.gates.length > 0) {
      for (const g of phase.gates) {
        const passed = gateResults.passed.includes(g);
        const failed = gateResults.failed.includes(g);
        const status = passed ? 'PASS' : failed ? 'FAIL' : 'PENDING';
        console.log(`        ${g}: ${status}`);
      }
    }
  }

  console.log(``);
  console.log(`Gates:`);
  console.log(`  Passed: ${gateResults.passed.length} ${gateResults.passed.length > 0 ? `(${gateResults.passed.join(', ')})` : ''}`);
  console.log(`  Failed: ${gateResults.failed.length} ${gateResults.failed.length > 0 ? `(${gateResults.failed.join(', ')})` : ''}`);

  console.log(``);
  console.log(`=== End of State Report ===`);
}

function cmdAdvance(projectDir, targetNode) {
  let state = loadState(projectDir);
  if (!state) {
    state = initState(projectDir);
  }

  const currentIdx = PHASES.findIndex(p => p.id === state.currentPhase);
  if (currentIdx === -1) {
    console.error(`Invalid current phase: ${state.currentPhase}`);
    process.exit(1);
  }

  let nextIdx;
  if (targetNode) {
    nextIdx = PHASES.findIndex(p => p.id === targetNode);
    if (nextIdx === -1) {
      console.error(`Unknown phase: ${targetNode}. Valid phases: ${PHASES.map(p => p.id).join(', ')}`);
      process.exit(1);
    }
  } else {
    nextIdx = currentIdx + 1;
  }

  if (nextIdx <= currentIdx) {
    console.error(`Cannot advance backwards or to same phase. Current: ${state.currentPhase}, Target: ${PHASES[nextIdx].id}`);
    process.exit(1);
  }

  if (nextIdx >= PHASES.length) {
    console.log(`Already at final phase (${PHASES[currentIdx].name}). No more phases to advance.`);
    return;
  }

  const currentPhase = PHASES[currentIdx];
  const nextPhase = PHASES[nextIdx];

  const gateResults = getGateResults(projectDir);
  for (const g of currentPhase.gates) {
    if (!gateResults.passed.includes(g)) {
      console.error(`Cannot advance: gate ${g} for phase ${currentPhase.name} has not passed.`);
      console.error(`  Passed gates: ${gateResults.passed.join(', ') || 'none'}`);
      process.exit(1);
    }
  }

  state.phaseHistory.push({
    phase: state.currentPhase,
    exitedAt: new Date().toISOString(),
  });
  state.currentPhase = nextPhase.id;
  state.updatedAt = new Date().toISOString();
  saveState(projectDir, state);

  console.log(`Advanced from ${currentPhase.name} to ${nextPhase.name}.`);

  if (nextPhase.gates.length > 0) {
    console.log(`  Next gates to pass: ${nextPhase.gates.join(', ')}`);
  }
}

function cmdCheck(projectDir) {
  let state = loadState(projectDir);
  if (!state) {
    state = initState(projectDir);
    saveState(projectDir, state);
  }

  const artifacts = getCycleArtifacts(projectDir, state.currentCycle);
  const inferredPhase = inferPhase(artifacts);
  const gateResults = getGateResults(projectDir);
  const currentPhase = PHASES.find(p => p.id === state.currentPhase);

  const checks = [];

  for (const g of currentPhase.gates) {
    if (gateResults.passed.includes(g)) {
      checks.push({ gate: g, status: 'PASS', message: 'Gate passed' });
    } else if (gateResults.failed.includes(g)) {
      checks.push({ gate: g, status: 'FAIL', message: 'Gate failed — must fix before advancing' });
    } else {
      checks.push({ gate: g, status: 'PENDING', message: 'Gate not yet evaluated' });
    }
  }

  if (inferredPhase !== state.currentPhase) {
    checks.push({
      gate: 'PHASE_SYNC',
      status: 'WARN',
      message: `State says ${state.currentPhase} but artifacts suggest ${inferredPhase}`,
    });
  }

  console.log(`Workflow Check Report`);
  console.log(`  Current phase: ${currentPhase.name}`);
  console.log(`  Inferred phase: ${PHASES.find(p => p.id === inferredPhase).name}`);
  console.log(``);

  let allPass = true;
  for (const c of checks) {
    console.log(`  [${c.status}] ${c.gate}: ${c.message}`);
    if (c.status === 'FAIL') allPass = false;
  }

  console.log(``);
  if (allPass) {
    console.log(`All checks passed. Ready to advance.`);
  } else {
    console.error(`Some checks failed. Fix issues before advancing.`);
    process.exit(1);
  }
}

const args = parseArgs(process.argv);
if (args._.length < 2) {
  console.error('Usage: node workflow-state.mjs <project-dir> status|advance|check [--node <node-id>]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);
const command = args._[1];

switch (command) {
  case 'status':
    cmdStatus(projectDir);
    break;
  case 'advance':
    cmdAdvance(projectDir, args.node);
    break;
  case 'check':
    cmdCheck(projectDir);
    break;
  default:
    console.error(`Unknown command: ${command}. Use status, advance, or check.`);
    process.exit(1);
}