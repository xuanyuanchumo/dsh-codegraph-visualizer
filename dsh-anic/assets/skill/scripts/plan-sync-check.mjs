#!/usr/bin/env node
// plan-sync-check.mjs — 确定性计划同步检查：基于 git diff 检测计划与代码的同步状态
// 用法:
//   检查: node plan-sync-check.mjs <project-dir>
//   详细: node plan-sync-check.mjs <project-dir> --verbose

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

function parseArgs(argv) {
  const args = { _: [], verbose: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--verbose') args.verbose = true;
    else args._.push(argv[i]);
  }
  return args;
}

function extractFilePaths(content) {
  const paths = new Set();
  const patterns = [
    /`([^`]+\.(ts|tsx|js|jsx|py|go|rs|java|json|yaml|yml|md))`/g,
    /\b(src\/[^\s)]+\.(ts|tsx|js|jsx))\b/g,
    /\b(lib\/[^\s)]+\.(ts|js|py|go|rs))\b/g,
    /\b(app\/[^\s)]+\.(ts|tsx|js|jsx|py))\b/g,
    /\b(pages\/[^\s)]+\.(ts|tsx|js|jsx))\b/g,
    /\b(components\/[^\s)]+\.(ts|tsx|js|jsx))\b/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      paths.add(match[1]);
    }
  }
  return [...paths];
}

function extractCommands(content) {
  const cmds = new Set();
  const pattern = /`(pnpm|npm|yarn|cargo|make|python|node|go)\s+[^`]+`/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    cmds.add(match[0].replace(/`/g, ''));
  }
  return [...cmds];
}

function getGitChangedFiles(projectDir) {
  try {
    const output = execSync('git diff --name-only HEAD~1', {
      cwd: projectDir,
      timeout: 5000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    try {
      const output = execSync('git status --porcelain', {
        cwd: projectDir,
        timeout: 5000,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return output.trim().split('\n').filter(Boolean).map(line => line.substring(3));
    } catch {
      return [];
    }
  }
}

function getGitTrackedFiles(projectDir) {
  try {
    const output = execSync('git ls-files', {
      cwd: projectDir,
      timeout: 5000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return new Set(output.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

function checkPlanSync(projectDir, verbose) {
  const issues = [];
  const planFiles = [];
  const changedFiles = getGitChangedFiles(projectDir);
  const trackedFiles = getGitTrackedFiles(projectDir);

  const intentDir = join(projectDir, '.cycles', 'intent');
  if (existsSync(intentDir)) {
    const intentFiles = readdirSync(intentDir).filter(f => f.endsWith('.md'));
    for (const f of intentFiles) {
      planFiles.push({ path: join(intentDir, f), content: readFileSync(join(intentDir, f), 'utf-8') });
    }
  }

  const cyclesDir = join(projectDir, '.cycles', 'cycles');
  if (existsSync(cyclesDir)) {
    const cycleDirs = readdirSync(cyclesDir).filter(e => e.startsWith('cycle-'));
    for (const cd of cycleDirs) {
      const planPath = join(cyclesDir, cd, '当前循环总规划.md');
      if (existsSync(planPath)) {
        planFiles.push({ path: planPath, content: readFileSync(planPath, 'utf-8') });
      }
      const taskPath = join(cyclesDir, cd, '任务清单.md');
      if (existsSync(taskPath)) {
        planFiles.push({ path: taskPath, content: readFileSync(taskPath, 'utf-8') });
      }
    }
  }

  const allReferencedFiles = new Set();
  const allReferencedCmds = new Set();

  for (const plan of planFiles) {
    const filePaths = extractFilePaths(plan.content);
    const commands = extractCommands(plan.content);

    for (const fp of filePaths) {
      allReferencedFiles.add(fp);
      const fullPath = join(projectDir, fp);
      if (!existsSync(fullPath)) {
        if (trackedFiles.size > 0 && !trackedFiles.has(fp)) {
          issues.push({ type: 'missing_file', file: fp, source: plan.path, severity: 'ERROR' });
        } else {
          issues.push({ type: 'missing_file', file: fp, source: plan.path, severity: 'WARN' });
        }
      }
    }

    for (const cmd of commands) {
      allReferencedCmds.add(cmd);
      const binary = cmd.split(' ')[0];
      try {
        execSync(`${binary} --version`, { timeout: 3000, stdio: 'pipe' });
      } catch {
        issues.push({ type: 'missing_command', command: cmd, source: plan.path, severity: 'ERROR' });
      }
    }
  }

  for (const changed of changedFiles) {
    if (changed.startsWith('.cycles/')) continue;
    if (!allReferencedFiles.has(changed) && verbose) {
      issues.push({
        type: 'unplanned_change',
        file: changed,
        source: 'git diff',
        severity: 'INFO',
      });
    }
  }

  return {
    planFiles: planFiles.length,
    referencedFiles: allReferencedFiles.size,
    referencedCmds: allReferencedCmds.size,
    changedFiles: changedFiles.length,
    issues,
  };
}

const args = parseArgs(process.argv);
if (args._.length === 0) {
  console.error('Usage: node plan-sync-check.mjs <project-dir> [--verbose]');
  process.exit(1);
}

const projectDir = resolve(args._[0]);

const result = checkPlanSync(projectDir, args.verbose);

console.log(`Plan-Sync Check Report`);
console.log(`  Plan files scanned: ${result.planFiles}`);
console.log(`  Referenced files: ${result.referencedFiles}`);
console.log(`  Referenced commands: ${result.referencedCmds}`);
console.log(`  Git changed files: ${result.changedFiles}`);
console.log(`  Issues found: ${result.issues.length}`);
console.log(``);

const errors = result.issues.filter(i => i.severity === 'ERROR');
const warns = result.issues.filter(i => i.severity === 'WARN');
const infos = result.issues.filter(i => i.severity === 'INFO');

if (errors.length > 0) {
  console.log(`ERRORS (${errors.length}):`);
  for (const i of errors) {
    const label = i.type === 'missing_file' ? i.file : i.command;
    console.log(`  [ERROR] ${label} (referenced in: ${i.source.replace(projectDir + '/', '')})`);
  }
  console.log(``);
}

if (warns.length > 0) {
  console.log(`WARNINGS (${warns.length}):`);
  for (const i of warns) {
    console.log(`  [WARN] ${i.file} (referenced in: ${i.source.replace(projectDir + '/', '')})`);
  }
  console.log(``);
}

if (args.verbose && infos.length > 0) {
  console.log(`UNPLANNED CHANGES (${infos.length}):`);
  for (const i of infos) {
    console.log(`  [INFO] ${i.file} (changed but not referenced in plan)`);
  }
  console.log(``);
}

if (errors.length > 0) {
  console.error(`${errors.length} plan-sync error(s) found. Update plan documents or create missing files.`);
  process.exit(1);
} else if (warns.length > 0) {
  console.log(`${warns.length} warning(s). Review plan references.`);
} else {
  console.log(`All plan references are in sync with the codebase.`);
}