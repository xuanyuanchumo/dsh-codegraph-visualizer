import type { Core } from 'cytoscape';

/**
 * 缓存里读不出边类型时使用的类型占位符。
 * 不抛错、不丢边——退化输入只降低精度（spec §八：退化输入不制造异常）。
 */
export const UNKNOWN_EDGE_TYPE = 'unknown';

/** 结构化最小边契约：cytoscape 的 EdgeSingular 满足它，测试桩也只需实现这几项。 */
interface EdgeLike {
  id(): string;
  source(): { id(): string };
  target(): { id(): string };
  data?: (key: string) => unknown;
}

function legacyKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function typedKey(source: string, target: string, edgeType: string): string {
  return `${source}->${target}->${edgeType}`;
}

function readEdgeType(edge: EdgeLike): string {
  // 桩对象 / 老数据可能没有 data()，也可能没有 type 字段：一律降级为 'unknown'
  const raw = edge.data?.('type');
  return typeof raw === 'string' && raw.length > 0 ? raw : UNKNOWN_EDGE_TYPE;
}

/**
 * 邻接缓存：把 cytoscape 的边集合投影成 forward / backward / undirected 三张邻接表，
 * 外加一张 `edgeIdMap` 供 CycleDetector 之类按「节点对」回查边 id。
 *
 * ## edgeIdMap 的双键契约（cycle-107 · C-2）
 *
 * - **旧键** `${source}->${target}`：该节点对**最后一次写入**的边 id。保留它是因为
 *   CycleDetector / PathFinder 等既有调用方只按节点对查找，语义与旧实现逐字一致
 *   （旧实现逐边 `set` 覆盖，最后一个写入者胜出）。
 * - **新键** `${source}->${target}->${edgeType}`：精确到边类型的边 id，同端不同类型的
 *   多重边不再互相覆盖。`edgeType` 取自 cytoscape 的 `edge.data('type')`，缺失时为 `'unknown'`。
 *
 * ## 增量 patch
 *
 * `addEdge` / `removeEdge` 直接改三张邻接表与 edgeIdMap，**不会**把缓存置为 invalid：
 * 调用方在做增量布局 / 增量筛选时不必为一条边重建全图。`invalidate()` 仍保留为降级路径
 * （例如批量变更后无法追踪单条边时，标记失效并在下次访问时全量重建）。
 *
 * `version` 每次实际变更（patch / rebuild / destroy）后递增，读取方可用它判断缓存内容
 * 是否已经变化；`invalidate()` 只表示「下次访问要重建」，本身不改动内容，因此不递增。
 */
export class AdjacencyCache {
  private forward: Map<string, Set<string>> = new Map();
  private backward: Map<string, Set<string>> = new Map();
  private undirected: Map<string, Set<string>> = new Map();
  /** 双键：旧键（节点对）+ 新键（节点对+类型）。 */
  private edgeIdMap: Map<string, string> = new Map();
  /** `s->t` → 该节点对的全部边 id（插入序；末项即旧键的值）。 */
  private pairEdgeIds: Map<string, string[]> = new Map();
  /** `s->t->type` → 同端同型的全部边 id（插入序；末项即新键的值）。 */
  private typedEdgeIds: Map<string, string[]> = new Map();
  /** 边 id → 边类型（removeEdge 未显式给类型时用）。 */
  private edgeTypeById: Map<string, string> = new Map();
  private valid = false;
  private revision = 0;

  /** 内容版本号（单调递增；patch / rebuild / destroy 都会递增）。 */
  get version(): number {
    return this.revision;
  }

  getVersion(): number {
    return this.revision;
  }

  invalidate(): void {
    this.valid = false;
  }

  isValid(): boolean {
    return this.valid;
  }

  /**
   * 增量插入一条边（不触发全量重建，也不改动 `isValid()`）。
   *
   * 同一个 `(source,target)` 的多条边（任意类型）在邻接表里共用一个目标项，
   * 因此邻接项只在「该节点对没有任何边」时才可能被移除（见 `removeEdge`）。
   */
  addEdge(source: string, target: string, edgeId: string, edgeType?: string): void {
    this.applyEdge(source, target, edgeId, edgeType ?? UNKNOWN_EDGE_TYPE);
    this.revision++;
  }

  /**
   * 增量删除一条边（不触发全量重建）。
   *
   * - 必须给出 `edgeId` 才能定位到具体那一条；不给时删除该节点对**最后写入**的边；
   * - 只有该节点对再无其它边（含其它类型的多重边）时，才移除邻接表里的目标项；
   * - 返回后 `isValid()` 保持不变——调用方可以在已失效的缓存上 patch，
   *   但下次访问仍会全量重建（patch 不是「补全」的替代品）。
   *
   * @returns 是否真的删掉了一条边（未命中返回 false，且不改 version）。
   */
  removeEdge(source: string, target: string, edgeId?: string, edgeType?: string): boolean {
    const changed = this.removeEdgeInternal(source, target, edgeId, edgeType);
    if (changed) this.revision++;
    return changed;
  }

  private rebuild(cy: Core): void {
    this.clearData();

    cy.edges().forEach((edge) => {
      const typedEdge = edge as unknown as EdgeLike;
      this.applyEdge(
        typedEdge.source().id(),
        typedEdge.target().id(),
        typedEdge.id(),
        readEdgeType(typedEdge),
      );
    });

    this.valid = true;
    this.revision++;
  }

  getForwardAdjacency(cy: Core): Map<string, Set<string>> {
    if (!this.valid) this.rebuild(cy);
    return this.forward;
  }

  getBackwardAdjacency(cy: Core): Map<string, Set<string>> {
    if (!this.valid) this.rebuild(cy);
    return this.backward;
  }

  getDirectedAdjacency(cy: Core): { forward: Map<string, Set<string>>; backward: Map<string, Set<string>> } {
    if (!this.valid) this.rebuild(cy);
    return { forward: this.forward, backward: this.backward };
  }

  getUndirectedAdjacency(cy: Core): Map<string, Set<string>> {
    if (!this.valid) this.rebuild(cy);
    return this.undirected;
  }

  /**
   * 边 id 查找表，见类注释的「双键契约」。
   *
   * 旧键 `a->b` 指向该节点对最后写入的边（既有调用方零改动），
   * 新键 `a->b->call` 才能区分同端的不同类型边。
   */
  getEdgeIdMap(cy: Core): Map<string, string> {
    if (!this.valid) this.rebuild(cy);
    return this.edgeIdMap;
  }

  destroy(): void {
    this.clearData();
    this.valid = false;
    this.revision++;
  }

  private applyEdge(source: string, target: string, edgeId: string, edgeType: string): void {
    this.addNeighbor(this.forward, source, target);
    this.addNeighbor(this.backward, target, source);
    this.addNeighbor(this.undirected, source, target);
    this.addNeighbor(this.undirected, target, source);

    const pair = legacyKey(source, target);
    pushId(this.pairEdgeIds, pair, edgeId);
    pushId(this.typedEdgeIds, typedKey(source, target, edgeType), edgeId);
    this.edgeTypeById.set(edgeId, edgeType);

    // 旧键与新键都遵循「最后写入者胜出」，与逐边重建完全一致
    this.edgeIdMap.set(pair, edgeId);
    this.edgeIdMap.set(typedKey(source, target, edgeType), edgeId);
  }

  private removeEdgeInternal(
    source: string,
    target: string,
    edgeId: string | undefined,
    edgeType: string | undefined,
  ): boolean {
    const pair = legacyKey(source, target);
    const pairIds = this.pairEdgeIds.get(pair);
    if (!pairIds || pairIds.length === 0) return false;

    const removeIndex = edgeId === undefined ? pairIds.length - 1 : pairIds.lastIndexOf(edgeId);
    if (removeIndex < 0) return false;

    const removedId = pairIds[removeIndex]!;
    pairIds.splice(removeIndex, 1);

    const resolvedType =
      edgeType ?? this.edgeTypeById.get(removedId) ?? UNKNOWN_EDGE_TYPE;
    this.edgeTypeById.delete(removedId);

    const precise = typedKey(source, target, resolvedType);
    const typedIds = this.typedEdgeIds.get(precise);
    if (typedIds) {
      const typedIndex = typedIds.lastIndexOf(removedId);
      if (typedIndex >= 0) typedIds.splice(typedIndex, 1);
      if (typedIds.length === 0) {
        this.typedEdgeIds.delete(precise);
        this.edgeIdMap.delete(precise);
      } else {
        this.edgeIdMap.set(precise, typedIds[typedIds.length - 1]!);
      }
    }

    if (pairIds.length === 0) {
      this.pairEdgeIds.delete(pair);
      this.edgeIdMap.delete(pair);
      // 多重边语义：只有该节点对再无其它边时才移除邻接项
      this.removeNeighbor(this.forward, source, target);
      this.removeNeighbor(this.backward, target, source);
      // undirected 是**无序对**的并集：反向边 (target->source) 仍存在时必须保留这一项，
      // 否则一条反向边会让无向邻接表少一条边（forward/backward 是有序的，不受影响）。
      if (source !== target && this.pairEdgeIds.has(legacyKey(target, source))) {
        // 反向边仍在：无向项保留
      } else {
        this.removeNeighbor(this.undirected, source, target);
        this.removeNeighbor(this.undirected, target, source);
      }
    } else {
      this.edgeIdMap.set(pair, pairIds[pairIds.length - 1]!);
    }

    return true;
  }

  private addNeighbor(map: Map<string, Set<string>>, node: string, neighbor: string): void {
    let set = map.get(node);
    if (!set) {
      set = new Set();
      map.set(node, set);
    }
    set.add(neighbor);
  }

  private removeNeighbor(map: Map<string, Set<string>>, node: string, neighbor: string): void {
    const set = map.get(node);
    if (!set) return;
    set.delete(neighbor);
    if (set.size === 0) map.delete(node);
  }

  private clearData(): void {
    this.forward.clear();
    this.backward.clear();
    this.undirected.clear();
    this.edgeIdMap.clear();
    this.pairEdgeIds.clear();
    this.typedEdgeIds.clear();
    this.edgeTypeById.clear();
  }
}

function pushId(map: Map<string, string[]>, key: string, edgeId: string): void {
  const list = map.get(key);
  if (list) list.push(edgeId);
  else map.set(key, [edgeId]);
}
