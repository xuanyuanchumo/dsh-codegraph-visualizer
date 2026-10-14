// tasks.mjs — P0-P3 任务表行解析唯一实现（进化 iteration-4，修 N-1 的根因面）
// 背景：gate-check.mjs checkG1（v1.8.0 重写）与 archive-cycle.mjs isCycleComplete（v1.8.3 重写）
// 都要回答"这个 cycle 的任务是否全部完成"。原先 archive-cycle 用整文件 includes('待办')——
// 与 G1 修复前的自陷同族（模板图例"待办 → 进行中 → 完成"会让永远完不成的模板被判 in-progress）。
// 两处判定必须共享同一实现，否则"G1 说完成、归档说没完成"的分叉迟早出现。
//
// 任务行 = 以 | 开头、≥6 单元格、首列非空（排除模板占位行）、首列 ≠ '任务'（排除表头）、
// 末列是合法状态值（待办|进行中|完成）。图例/状态约定等说明文字不参与判定。

export const TASK_STATUS_RE = /^(待办|进行中|完成)$/;

export function parseTaskRows(content) {
  const rows = [];
  for (const line of String(content).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 6) continue;
    if (!cells[0] || cells[0].replace(/`/g, '').trim() === '') continue; // 模板占位行（首列空）
    if (cells[0] === '任务') continue; // 表头
    if (!TASK_STATUS_RE.test(cells[cells.length - 1])) continue;
    rows.push(cells);
  }
  return rows;
}

export function summarizeTaskRows(content) {
  const rows = parseTaskRows(content);
  const pending = rows.filter(cells => cells[cells.length - 1] !== '完成');
  return { total: rows.length, pendingCount: pending.length, allCompleted: rows.length > 0 && pending.length === 0 };
}
