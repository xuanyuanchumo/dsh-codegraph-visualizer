import type { AdjacencyMap } from './AdjacencyList.ts';
import { boothMinimalRotation } from '../../xuanji/ops/booth.ts';

/**
 * Booth 最小旋转 / 最小旋转判定由璇玑库提供，此处**只做 re-export**。
 *
 * 契约（cycle-107 · C-1）：宿主不得复制库实现。引用相等性由
 * `tests/unit/CycleDFS.test.ts` 直接断言（`behaves === libBooth`），
 * 任何「顺手复制一份」的回归都会让该用例立刻变红。
 */
export {
  boothMinimalRotation,
  isMinimalRotation,
  minimalRotationIndex,
} from '../../xuanji/ops/booth.ts';

/**
 * 有向环存在性判定同样由璇玑库提供（早终止变体，O(V+E)）。
 *
 * 语义与旧宿主实现逐字等价：遇到第一个 back edge 立即返回 true，不枚举环列表。
 * `RuleEngine` 用它做「无环即早退」，避免在无环图上白跑一次全量 DFS。
 */
export { hasCycleInAdjacency as hasCycle } from '../../xuanji/ops/cycle-existence.ts';

export interface CycleDetectionResult {
  cycles: string[][];
}

export const MAX_CYCLES_DEFAULT = 1000;

/**
 * 枚举环（DFS + booth 规范代表元去重）。
 *
 * 去重键仍然建立在库的 `boothMinimalRotation` 之上：同一个环从不同节点起读
 * 会被规范成同一把键，因此 `a→b→a` 与 `b→a→b` 只产出一次。
 *
 * 行为契约保持不变（cycle-107 · C-1）：返回值仍是闭合路径
 * `[...cycleNodes, cycleStart]`，顺序与最大环数截断语义均与旧实现一致。
 */
export function detectCyclesDFS(adjacency: AdjacencyMap, maxCycles: number = MAX_CYCLES_DEFAULT): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  const enter = (start: string): void => {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
      { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
    ];
    visited.add(start);
    inStack.add(start);
    path.push(start);
    pathIndex.set(start, 0);

    while (frames.length > 0) {
      if (cycles.length >= maxCycles) return;
      const frame = frames[frames.length - 1]!;
      if (frame.next >= frame.neighbors.length) {
        inStack.delete(frame.id);
        path.pop();
        pathIndex.delete(frame.id);
        frames.pop();
        continue;
      }
      const target = frame.neighbors[frame.next++]!;
      if (inStack.has(target)) {
        const cycleStart = pathIndex.get(target);
        if (cycleStart !== undefined) {
          const cycleNodes = path.slice(cycleStart);
          const cycleKey = boothMinimalRotation(cycleNodes).join('|');
          if (!seenCycleKeys.has(cycleKey)) {
            seenCycleKeys.add(cycleKey);
            cycles.push([...cycleNodes, target]);
            if (cycles.length >= maxCycles) return;
          }
        }
      } else if (!visited.has(target)) {
        visited.add(target);
        inStack.add(target);
        path.push(target);
        pathIndex.set(target, path.length - 1);
        frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
      }
    }
  };

  for (const id of adjacency.keys()) {
    if (cycles.length >= maxCycles) break;
    if (!visited.has(id)) enter(id);
  }

  return cycles;
}
