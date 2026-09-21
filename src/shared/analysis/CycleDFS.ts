import type { AdjacencyMap } from './AdjacencyList.ts';

export interface CycleDetectionResult {
  cycles: string[][];
}

export function detectCyclesDFS(adjacency: AdjacencyMap): string[][] {
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
          const cycleKey = [...cycleNodes, target].sort().join('|');
          if (!seenCycleKeys.has(cycleKey)) {
            seenCycleKeys.add(cycleKey);
            cycles.push([...cycleNodes, target]);
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
    if (!visited.has(id)) enter(id);
  }

  return cycles;
}