#!/usr/bin/env node
// init-workflow.mjs — 初始化 AI-Native Iteration Cycle 工作流骨架
// 所有产物收纳到 .cycles/ 目录内，保持项目根目录干净
// 用法: node scripts/init-workflow.mjs <project-dir> --name "<项目名>" [--framework claude|codex] [--git]

import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { atomicWriteFileSync } from './lib/fs-safe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { _: [], framework: 'claude', git: false, name: '' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') args.name = argv[++i];
    else if (arg === '--framework') args.framework = argv[++i];
    else if (arg === '--git') args.git = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else args._.push(arg);
  }
  return args;
}

function scaffoldProject(projectDir, args) {
  const dir = resolve(projectDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const repoMemoryFile = args.framework === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
  const cyclesDir = join(dir, '.cycles');

  const dirs = [
    '.cycles',
    '.cycles/intent',
    '.cycles/cycles',
    '.cycles/gates',
    '.cycles/incidents',
    '.cycles/retrospectives',
    '.cycles/tech-debt',
    '.cycles/evals',
    '.cycles/archive',
  ];
  for (const d of dirs) {
    const p = join(dir, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  const templateDir = join(SKILL_ROOT, 'assets', 'templates');
  const configDir = join(SKILL_ROOT, 'assets', 'config');

  const filesToCopy = [
    [join(templateDir, 'intent.md'), join(cyclesDir, 'intent', 'intent.md')],
    [join(templateDir, 'review.md'), join(cyclesDir, 'REVIEW.md')],
    [join(configDir, 'config.example.yml'), join(cyclesDir, 'config.yml')],
    [join(configDir, 'workflow-graph.example.yaml'), join(cyclesDir, 'workflow-graph.yaml')],
  ];
  for (const [src, dst] of filesToCopy) {
    if (existsSync(src) && !existsSync(dst)) {
      atomicWriteFileSync(dst, readFileSync(src));
    }
  }

  // 修 N-6（v1.8.0）：--name 此前不落盘，config.yml 的 project.name 永远是 "my-project"。
  const configDst = join(cyclesDir, 'config.yml');
  if (args.name && existsSync(configDst)) {
    const patched = readFileSync(configDst, 'utf-8').replace(
      /name:\s*"my-project"/,
      `name: "${args.name.replace(/"/g, '\\"')}"`
    );
    atomicWriteFileSync(configDst, patched);
  }

  const repoMemoryContent = `# ${args.name || 'Project'}\n\n## Commands\n- Build: [fill in]\n- Test: [fill in]\n- Lint: [fill in]\n\n## Verifying your work\n- Run build, test, and lint before reporting done.\n- Paste output as evidence.\n\n## Conventions\n- [fill in]\n\n## Things the agent gets wrong\n- [fill in as mistakes are made]\n`;
  atomicWriteFileSync(join(dir, repoMemoryFile), repoMemoryContent);

  if (args.git && !existsSync(join(dir, '.git'))) {
    execSync('git init', { cwd: dir });
  }

  console.log(`Scaffolded AI-Native Iteration Cycle workflow in ${dir}`);
  console.log(`  All artifacts in: .cycles/`);
  console.log(`  Framework: ${args.framework} (${repoMemoryFile})`);
  console.log(`  Config: .cycles/config.yml`);
  console.log(`  Next: edit .cycles/config.yml with your project's build/test commands`);
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node init-workflow.mjs <project-dir> --name "<项目名>" [--framework claude|codex] [--git]');
  process.exit(1);
}
scaffoldProject(args._[0], args);
