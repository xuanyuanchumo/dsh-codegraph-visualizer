/**
 * 计划同步检查（原生实现，替代技能 plan-sync-check.mjs）。
 * 比对任务清单与实际交付物，检测遗漏/超产。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface PlanSyncResult {
  tasksDeclared: number;
  tasksCompleted: number;
  deliverablesFound: string[];
  missing: string[];
  extra: string[];
  synced: boolean;
}

/** 从任务清单 Markdown 提取任务行（- [x] 或 ✓ 或 ✅ 模式）。 */
function parseTaskList(content: string): { name: string; done: boolean }[] {
  const lines = content.split('\n');
  const tasks: { name: string; done: boolean }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[([ x])\]\s*(.+)/i);
    if (m && m[1] && m[2]) {
      tasks.push({ name: m[2].trim(), done: m[1].toLowerCase() === 'x' });
    }
  }
  return tasks;
}

/** 从交付清单 Markdown 提取已交付物列表。 */
function parseDeliverables(content: string): string[] {
  const lines = content.split('\n');
  const items: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s*(.+)/);
    if (m && m[1] && m[1].trim().length > 2) {
      items.push(m[1].trim());
    }
  }
  return items;
}

export function runPlanSync(workspaceRoot: string, cycleDir?: string): PlanSyncResult {
  const cyclesDir = join(workspaceRoot, '.cycles');

  // 定位最新 cycle
  let targetCycle = cycleDir;
  if (!targetCycle) {
    const cyclesParent = join(cyclesDir, 'cycles');
    if (existsSync(cyclesParent)) {
      const dirs = readdirSync(cyclesParent).filter((d) => /^cycle-\d+$/.test(d)).sort();
      if (dirs.length > 0) targetCycle = join(cyclesParent, dirs[dirs.length - 1] ?? '');
    }
  }

  let tasksDeclared = 0;
  let tasksCompleted = 0;
  let deliverablesFound: string[] = [];

  if (targetCycle && existsSync(targetCycle)) {
    // 任务清单
    const taskListPath = join(targetCycle, '任务清单.md');
    if (existsSync(taskListPath)) {
      const tasks = parseTaskList(readFileSync(taskListPath, 'utf-8'));
      tasksDeclared = tasks.length;
      tasksCompleted = tasks.filter((t) => t.done).length;
    }

    // 交付清单
    const deliverablePath = join(targetCycle, '交付清单.md');
    if (existsSync(deliverablePath)) {
      deliverablesFound = parseDeliverables(readFileSync(deliverablePath, 'utf-8'));
    }
  }

  // 检测遗漏（已完成任务但无交付物）
  const missing: string[] = [];
  if (tasksCompleted > 0 && deliverablesFound.length === 0) {
    missing.push(`${tasksCompleted} completed tasks but no deliverables listed`);
  }

  // 检测超产（交付物多于任务）
  const extra: string[] = [];
  if (deliverablesFound.length > tasksDeclared && tasksDeclared > 0) {
    extra.push(`${deliverablesFound.length - tasksDeclared} extra deliverables beyond declared tasks`);
  }

  return {
    tasksDeclared,
    tasksCompleted,
    deliverablesFound,
    missing,
    extra,
    synced: missing.length === 0 && extra.length === 0,
  };
}
