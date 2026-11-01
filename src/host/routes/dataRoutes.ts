import { VALIDATION, BOOTSTRAP, ERROR_CODES, API, EDGES_AGGREGATION, FILE_OUTLINE } from '../../shared/constants.ts';
import type { GraphEdge, GraphNode, GraphData } from '../../types/index.ts';
import { RepoId, NodeId, EdgeId } from '../../types/index.ts';
import {
  resolveDbPath, readTopLevelNodesFromDb, readNodeChildrenFromDb, readFileOutlineFromDb, readSymbolASTFromDb, readEdgesFromDb, readIncidentEdgesWithFilePathsFromDb, readEdgesForNodesFromDb, countEdgesInDb, FILTERED_EDGE_KINDS,
} from '../../adapters/CodeGraphAdapter.ts';
import { mapDbNodesToGraphNodes, mapDbEdgesToGraphEdges } from '../DbMapper.ts';
import { computeGraphEtag } from '../../shared/graphFingerprint.ts';
import {
  etagKeyForChildren, etagKeyForOutline, etagKeyForAst, etagKeyForEdges, resolveAstBudget,
} from '../../shared/graphFingerprint.ts';
import { buildCorsHeaders, sendJson, sendError } from '../HttpHelpers.ts';
import {
  withRouteMiddleware, resolveWorkspaceFromRequest, returnIfEtagMatch, etagGuard, etagHeaders, slimGraphData,
  triggerBackgroundBuild, getWorkspaceScopedGraphData, type RouteContext,
} from './shared.ts';

interface GraphIndex {
  parentIdToChildren: Map<string, GraphNode[]>;
  filePathToNodeIds: Map<string, Set<string>>;
  nodeIdToFilePath: Map<string, string>;
  rootNodes: GraphNode[];
}

const _indexCache = new WeakMap<GraphData, GraphIndex>();

function getGraphIndex(data: GraphData): GraphIndex {
  const cached = _indexCache.get(data);
  if (cached) return cached;

  const parentIdToChildren = new Map<string, GraphNode[]>();
  const filePathToNodeIds = new Map<string, Set<string>>();
  const nodeIdToFilePath = new Map<string, string>();
  const rootNodes: GraphNode[] = [];

  for (const n of data.nodes) {
    if (n.parentId) {
      const siblings = parentIdToChildren.get(n.parentId);
      if (siblings) siblings.push(n);
      else parentIdToChildren.set(n.parentId, [n]);
    } else {
      rootNodes.push(n);
    }
    const fp = n.filePath;
    if (fp) {
      const ids = filePathToNodeIds.get(fp);
      if (ids) ids.add(n.id);
      else filePathToNodeIds.set(fp, new Set([n.id]));
    }
    nodeIdToFilePath.set(n.id, n.filePath);
  }

  for (const children of parentIdToChildren.values()) {
    children.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  const index: GraphIndex = { parentIdToChildren, filePathToNodeIds, nodeIdToFilePath, rootNodes };
  _indexCache.set(data, index);
  return index;
}

export function registerDataRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/data';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      if (returnIfEtagMatch(req, res, corsConfig, deps, 'graph')) return;
      const lastGraphData = deps.getLastGraphData();
      if (lastGraphData) {
        // 校验值必须与 returnIfEtagMatch 算出的完全一致，否则客户端拿到 200 里的 etag 再发回来时永远
        // 匹配不上，"增量取数"退化成每次都全量重取。
        const etag = computeGraphEtag(lastGraphData.metadata.repoId, lastGraphData.metadata.timestamp, 'graph');
        const payload = JSON.stringify(lastGraphData);
        if (payload.length > API.DATA_RESPONSE_MAX_BYTES) {
          const slimmed = slimGraphData(lastGraphData, API.DATA_RESPONSE_SLIM_NODES);
          const slimPayload = JSON.stringify(slimmed);
          const dataHeaders = buildCorsHeaders(req, corsConfig);
          dataHeaders['content-type'] = 'application/json';
          dataHeaders['etag'] = etag;
          dataHeaders['x-truncated'] = '1';
          res.writeHead(200, dataHeaders);
          res.end(slimPayload);
        } else {
          const dataHeaders = buildCorsHeaders(req, corsConfig);
          dataHeaders['content-type'] = 'application/json';
          dataHeaders['etag'] = etag;
          res.writeHead(200, dataHeaders);
          res.end(payload);
        }
      } else {
        // 槽为空时**没有**校验值可算（`resourceEtag` 返回 null），所以这里显式传 `etagHeaders(null)`
        // 表示"本响应刻意不带校验器"，而不是忘了写。全仓 `sendJson(res, 200, ...)` 一律带 etag 参数，
        // 这条统一形状由 `tests/unit/etagContract.test.ts` 的源码扫描兜底。
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig, etagHeaders(null));
      }
    }),
  }), 'codegraph: data route');
}

export function registerBootstrapRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/bootstrap';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);

      // `/bootstrap` 没有请求参数（工作区已在 repoId 维度里），故不传请求键。
      const etagDecision = etagGuard(req, res, corsConfig, deps, 'bootstrap', workspacePath);
      if (etagDecision.handled) return;
      const etagHeader = etagHeaders(etagDecision.etag);

      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readTopLevelNodesFromDb(dbPath, BOOTSTRAP.TOP_LEVEL_NODE_LIMIT);
        if (dbResult && dbResult.nodes.length > 0) {
          const topLevelNodes = mapDbNodesToGraphNodes(dbResult.nodes);
          const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...topLevelIds]);
          const rootEdges = mapDbEdgesToGraphEdges(dbEdges);
          sendJson(res, 200, {
            rootNodes: topLevelNodes,
            topLevelNodes,
            topLevelTotal: dbResult.total,
            edges: rootEdges,
            indexStatus: 'ready',
            metadata: {
              repoId: RepoId(workspacePath),
              timestamp: Date.now(),
              totalNodeCount: dbResult.total,
              totalEdgeCount: countEdgesInDb(dbPath),
            },
          }, req, corsConfig, etagHeader);
          return;
        }
      }

      // P0-B：内存回落必须按请求方工作区限定。host 只有一个图槽，无条件下落会把
      // 另一个工作区的顶层节点连同它的 repoId 一起发给本客户端，覆盖画布身份。
      const lastGraphData = getWorkspaceScopedGraphData(deps, workspacePath);
      if (lastGraphData && lastGraphData.nodes.length > 0) {
        const allRootNodes = getGraphIndex(lastGraphData).rootNodes;
        const topLevelNodes = allRootNodes.slice(0, BOOTSTRAP.TOP_LEVEL_NODE_LIMIT);
        const topLevelIds = new Set(topLevelNodes.map((n) => n.id));
        const rootEdges = lastGraphData.edges.filter(
          (e) => topLevelIds.has(e.source) && topLevelIds.has(e.target),
        );

        sendJson(res, 200, {
          rootNodes: topLevelNodes,
          topLevelNodes,
          topLevelTotal: allRootNodes.length,
          edges: rootEdges,
          indexStatus: 'ready',
          metadata: {
            repoId: lastGraphData.metadata.repoId,
            timestamp: lastGraphData.metadata.timestamp,
            totalNodeCount: lastGraphData.metadata.totalNodeCount ?? lastGraphData.nodes.length,
            totalEdgeCount: lastGraphData.metadata.totalEdgeCount ?? lastGraphData.edges.length,
            // cycle-130 · T2：图层来源透传（客户端 StatusBar 来源徽章的数据面）。
            ...(lastGraphData.metadata.graphLayer ? { graphLayer: lastGraphData.metadata.graphLayer } : {}),
          },
        }, req, corsConfig, etagHeader);
        return;
      }

      if (workspacePath) {
        triggerBackgroundBuild(deps, invokeUpstream, workspacePath);
      }

      sendJson(res, 200, {
        rootNodes: [],
        topLevelNodes: [],
        topLevelTotal: 0,
        edges: [],
        indexStatus: 'building',
        metadata: {
          repoId: RepoId(workspacePath ?? 'empty'),
          timestamp: Date.now(),
          totalNodeCount: 0,
          totalEdgeCount: 0,
        },
      }, req, corsConfig, etagHeader);
    }),
  }), 'codegraph: bootstrap route');
}

export function registerNodeChildrenRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/children';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const nodeId = url.searchParams.get('nodeId');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cursor = url.searchParams.get('cursor') ?? null;
      const limit = parseInt(url.searchParams.get('limit') ?? String(BOOTSTRAP.CHILDREN_PAGE_SIZE), 10) || BOOTSTRAP.CHILDREN_PAGE_SIZE;

      // 先解析工作区、再校验 ETag：反序会让校验值缺少身份维度（`?workspace=` 还没读），
      // 客户端切到别的工作区时会因槽里还留着旧图而收到 304，静默保留错误画布。
      const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);

      // 请求键含 nodeId、cursor 与 limit：三者任一不同都会产生不同载荷，
      // 少一个就会让客户端拿 A 的校验值问 B 时收到假 304（P3-R18-02）。
      const etagKey = etagKeyForChildren(nodeId, cursor, limit);
      const etagDecision = etagGuard(req, res, corsConfig, deps, 'children', workspacePath, etagKey);
      if (etagDecision.handled) return;
      const etagHeader = etagHeaders(etagDecision.etag);

      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readNodeChildrenFromDb(dbPath, nodeId, cursor, limit);
        if (dbResult && dbResult.nodes.length > 0) {
          const page = mapDbNodesToGraphNodes(dbResult.nodes, nodeId);
          const childIds = page.map((n) => n.id);
          const dbEdges = readEdgesForNodesFromDb(dbPath, childIds);
          const childEdges = mapDbEdgesToGraphEdges(dbEdges);

          const lastNode = dbResult.nodes[dbResult.nodes.length - 1];
          sendJson(res, 200, {
            nodes: page,
            edges: childEdges,
            cursor: dbResult.nodes.length < limit || !lastNode ? null : lastNode.id,
            total: dbResult.total,
          }, req, corsConfig, etagHeader);
          return;
        }
      }

      const lastGraphData = getWorkspaceScopedGraphData(deps, workspacePath);
      if (lastGraphData && lastGraphData.nodes.length > 0) {
        const children = getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? [];
        const startIdx = cursor ? Math.max(0, children.findIndex((n) => n.id > cursor)) : 0;
        const page = children.slice(startIdx, startIdx + limit);
        const childIds = new Set(page.map((n) => n.id));
        const childEdges = lastGraphData.edges.filter(
          (e) => childIds.has(e.source) && childIds.has(e.target),
        );

        const lastChild = page[page.length - 1];
        sendJson(res, 200, {
          nodes: page,
          edges: childEdges,
          cursor: page.length < limit || !lastChild ? null : lastChild.id,
          total: children.length,
        }, req, corsConfig, etagHeader);
        return;
      }

      sendJson(res, 200, { nodes: [], edges: [], cursor: null, total: 0 }, req, corsConfig, etagHeader);
    }),
  }), 'codegraph: node children route');
}

export function registerFileOutlineRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/files';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const match = url.pathname.match(/^\/api\/v1\/codegraph\/files\/([^/]+)\/outline$/);
      if (!match) {
        sendError(res, 404, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }
      const nodeId = decodeURIComponent(match[1] ?? '');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      // 先解析工作区、再校验 ETag（理由同 /children）。
      const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);

      // 请求键含 nodeId：`outline(fileA)` 与 `outline(fileB)` 必须算出不同校验值。
      const etagDecision = etagGuard(
        req, res, corsConfig, deps, 'outline', workspacePath, etagKeyForOutline(nodeId),
      );
      if (etagDecision.handled) return;
      const etagHeader = etagHeaders(etagDecision.etag);

      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readFileOutlineFromDb(dbPath, nodeId);
        if (dbResult && dbResult.nodes.length > 0) {
          const symbols = mapDbNodesToGraphNodes(dbResult.nodes, nodeId).slice(0, FILE_OUTLINE.MAX_SYMBOLS);
          const symbolIds = new Set(symbols.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...symbolIds]);
          const symbolEdges = mapDbEdgesToGraphEdges(dbEdges);
          sendJson(res, 200, { symbols, edges: symbolEdges }, req, corsConfig, etagHeader);
          return;
        }
      }

      const lastGraphData = getWorkspaceScopedGraphData(deps, workspacePath);
      if (!lastGraphData) {
        sendJson(res, 200, { symbols: [], edges: [] }, req, corsConfig, etagHeader);
        return;
      }

      const symbols = (getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? []).slice(0, FILE_OUTLINE.MAX_SYMBOLS);
      const symbolIds = new Set(symbols.map((n) => n.id));
      const symbolEdges = lastGraphData.edges.filter(
        (e) => symbolIds.has(e.source) && symbolIds.has(e.target),
      );

      sendJson(res, 200, { symbols, edges: symbolEdges }, req, corsConfig, etagHeader);
    }),
  }), 'codegraph: file outline route');
}

export function registerSymbolASTRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/symbols';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const match = url.pathname.match(/^\/api\/v1\/codegraph\/symbols\/([^/]+)\/ast$/);
      if (!match) {
        sendError(res, 404, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }
      const nodeId = decodeURIComponent(match[1] ?? '');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      // 先解析工作区、再校验 ETag（理由同 /children）。
      const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);

      // 单符号预算：`budget` 是每页节点上限，`cursor` 是分段加载的起点。
      // 两者共同实现 docs/图谱按需加载.md 的「超限时折叠为摘要 / 分段加载」：
      // 只截断而不给 cursor，客户端就无法取回被折叠的部分，只能永久丢失。
      const budget = resolveAstBudget(url.searchParams.get('budget'));
      const cursor = Math.max(parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0, 0);

      // 请求键含 nodeId、cursor 与 budget：budget 直接决定这一页切多少节点，
      // 不同预算的响应绝不能共用校验值。
      const etagDecision = etagGuard(
        req, res, corsConfig, deps, 'ast', workspacePath, etagKeyForAst(nodeId, cursor, budget),
      );
      if (etagDecision.handled) return;
      const etagHeader = etagHeaders(etagDecision.etag);

      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readSymbolASTFromDb(dbPath, nodeId);
        if (dbResult && dbResult.nodes.length > 0) {
          const allAstNodes = mapDbNodesToGraphNodes(dbResult.nodes, nodeId);
          const astNodes = allAstNodes.slice(cursor, cursor + budget);
          const nextCursor = cursor + astNodes.length;
          const hasMore = nextCursor < allAstNodes.length;
          const astNodeIds = new Set(astNodes.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...astNodeIds]);
          const astEdges = mapDbEdgesToGraphEdges(dbEdges);
          sendJson(res, 200, { astNodes, astEdges, sourceLines: [], total: allAstNodes.length, cursor: nextCursor, hasMore }, req, corsConfig, etagHeader);
          return;
        }
      }

      // P0-B：`/ast` 的 `nodeId` 是**另一个工作区**的节点 id 时，在 A 的图里查表只会得到空数组，
      // 客户端表现为「展开成功但一个符号都没有」。必须按请求方工作区限定回落槽。
      const lastGraphData = getWorkspaceScopedGraphData(deps, workspacePath);
      if (!lastGraphData) {
        sendJson(res, 200, { astNodes: [], astEdges: [], sourceLines: [], total: 0, cursor: 0, hasMore: false }, req, corsConfig, etagHeader);
        return;
      }

      const allAstNodes = getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? [];
      const astNodes = allAstNodes.slice(cursor, cursor + budget);
      const nextCursor = cursor + astNodes.length;
      const hasMore = nextCursor < allAstNodes.length;
      const astNodeIds = new Set(astNodes.map((n) => n.id));
      const astEdges = lastGraphData.edges.filter(
        (e) => astNodeIds.has(e.source) && astNodeIds.has(e.target),
      );

      sendJson(res, 200, { astNodes, astEdges, sourceLines: [], total: allAstNodes.length, cursor: nextCursor, hasMore }, req, corsConfig, etagHeader);
    }),
  }), 'codegraph: symbol AST route');
}

/**
 * 把同一文件对之间的多条边折叠成一条合成边（`properties.aggregated === true`）。
 *
 * DB 路径与内存路径共用本函数：两条路径此前各有一套（DB 路径干脆没有），
 * 而聚合语义一旦分叉就会静默漂移——`total`、`hasMore`、`filePair` 三处任一不一致，
 * 前端「展开明细」都会拿不到正确游标。
 *
 * `filePathOf` 是注入的：DB 路径用一次 `IN` 查询得到的映射，内存路径用图索引，
 * 两者都不保证覆盖全部端点，因此缺失时退化为 `'?'` 而不是丢弃该边。
 */
function buildFilePairAggregate(
  fromId: string,
  edges: ReadonlyArray<{ source: string; target: string }>,
  filePathOf: (nodeId: string) => string | undefined,
): GraphEdge[] {
  const filePairCounts = new Map<string, number>();
  for (const e of edges) {
    const srcFile = filePathOf(e.source) ?? '?';
    const tgtFile = filePathOf(e.target) ?? '?';
    const pairKey = srcFile < tgtFile ? `${srcFile}\0${tgtFile}` : `${tgtFile}\0${srcFile}`;
    filePairCounts.set(pairKey, (filePairCounts.get(pairKey) ?? 0) + 1);
  }
  return [...filePairCounts.entries()].map(([pairKey, count]) => {
    const [fileA, fileB] = pairKey.split('\0');
    return {
      id: EdgeId(`agg:${pairKey}`),
      source: NodeId(fromId),
      target: NodeId(fileA === fromId ? (fileB ?? fromId) : (fileA ?? fromId)),
      type: 'dependency' as const,
      properties: { aggregated: true, count, filePair: pairKey },
    };
  });
}

export function registerEdgesRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/edges';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const fromId = url.searchParams.get('from') ?? '';
      const scope = url.searchParams.get('scope') ?? 'file';
      const cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10);
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? String(EDGES_AGGREGATION.PAGE_SIZE), 10), EDGES_AGGREGATION.PAGE_SIZE);
      // `detail=1` 请求未聚合的原始边（前端「展开聚合边」用它拉明细）。
      // `aggregated=1` 是历史写法，语义相同（1 = 不要聚合），保留以免破坏既有调用方；
      // 两者极性都反直觉，新代码一律用 `detail`。
      const detailRequested = url.searchParams.get('detail') === '1'
        || url.searchParams.get('aggregated') === '1';
      // 只有文件作用域才有「跨文件边聚合」的概念：符号作用域的邻接边本来就不按文件折叠。
      const mayAggregate = scope !== 'symbol' && !detailRequested;

      if (!fromId || fromId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      // 先解析工作区、再校验 ETag（理由同 /children）。
      const workspacePath = await resolveWorkspaceFromRequest(req, ctx, deps);

      // 请求键覆盖全部改变载荷的参数：fromId / scope / cursor / limit / detail。
      // `detail` 尤其关键——它决定这一页是聚合摘要还是原始边，两者绝不能共用校验值。
      // 键多算几个维度只会多回一次 200（安全方向），少算一个就会产生假 304。
      const etagDecision = etagGuard(
        req, res, corsConfig, deps, 'edges', workspacePath,
        etagKeyForEdges(fromId, scope, cursor, limit, detailRequested),
      );
      if (etagDecision.handled) return;
      const etagHeader = etagHeaders(etagDecision.etag);

      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        // DB-first: when DB is readable, its answer is authoritative — empty edges means
        // no edges exist, NOT "fall back to memory". This intentionally differs from
        // other routes (bootstrap/children/outline/ast) which use `dbResult.nodes.length > 0`
        // to fall back to memory when DB has no nodes. See CLAUDE.md for rationale.
        if (mayAggregate) {
          // 聚合必须在分页之前完成：同一个文件对会被拆到多页里，逐页聚合必然算错。
          // 因此聚合路径一次性取回全集（含端点文件映射），再决定聚合还是切片。
          const full = readIncidentEdgesWithFilePathsFromDb(dbPath, fromId, scope as 'file' | 'symbol');
          if (full) {
            const allEdges = full.edges;
            if (allEdges.length > EDGES_AGGREGATION.THRESHOLD) {
              const aggregatedEdges = buildFilePairAggregate(
                fromId, allEdges, (id) => full.filePathByNodeId.get(id),
              );
              sendJson(res, 200, {
                edges: aggregatedEdges,
                total: aggregatedEdges.length,
                cursor: 0,
                hasMore: false,
                aggregated: true,
              }, req, corsConfig, etagHeader);
              return;
            }
            const pagedEdges = mapDbEdgesToGraphEdges(allEdges.slice(cursor, cursor + limit));
            sendJson(res, 200, {
              edges: pagedEdges,
              total: allEdges.length,
              cursor: cursor + pagedEdges.length,
              hasMore: cursor + limit < allEdges.length,
            }, req, corsConfig, etagHeader);
            return;
          }
        }
        const dbResult = readEdgesFromDb(dbPath, fromId, scope as 'file' | 'symbol', cursor, limit);
        if (dbResult) {
          const pagedEdges = mapDbEdgesToGraphEdges(
            dbResult.edges.filter((e) => e.source !== e.target && !FILTERED_EDGE_KINDS.has(e.kind)),
          );
          sendJson(res, 200, {
            edges: pagedEdges,
            total: dbResult.total,
            cursor: cursor + pagedEdges.length,
            hasMore: cursor + limit < dbResult.total,
          }, req, corsConfig, etagHeader);
          return;
        }
      }

      // P0-B：`/edges` 的内存回落同样按请求方工作区限定。`fromId` 属于别的工作区时，
      // 在 A 的边集里过滤只会得到空列表，客户端表现为「这个文件没有任何边」——
      // 与「DB 确实没有边」不可区分。
      const lastGraphData = getWorkspaceScopedGraphData(deps, workspacePath);
      if (lastGraphData && lastGraphData.nodes.length > 0) {
        let filteredEdges: GraphEdge[];
        if (scope === 'symbol') {
          filteredEdges = lastGraphData.edges.filter((e) => e.source === fromId || e.target === fromId);
        } else {
          const index = getGraphIndex(lastGraphData);
          const nodeIds = new Set<string>();
          const nodeFilePaths = new Map<string, string>();
          const fpNodeIds = index.filePathToNodeIds.get(fromId);
          if (fpNodeIds) {
            for (const id of fpNodeIds) {
              nodeIds.add(id);
              nodeFilePaths.set(id, fromId);
            }
          }
          const selfFp = index.nodeIdToFilePath.get(fromId);
          if (selfFp !== undefined && !nodeIds.has(fromId)) {
            nodeIds.add(fromId);
            nodeFilePaths.set(fromId, selfFp);
          }
          filteredEdges = lastGraphData.edges.filter(
            (e) => nodeIds.has(e.source) || nodeIds.has(e.target),
          );

          if (mayAggregate && filteredEdges.length > EDGES_AGGREGATION.THRESHOLD) {
            const nodeIdToFilePath = index.nodeIdToFilePath;
            const aggregatedEdges = buildFilePairAggregate(
              fromId,
              filteredEdges,
              (id) => nodeFilePaths.get(id) ?? nodeIdToFilePath.get(id),
            );
            sendJson(res, 200, {
              edges: aggregatedEdges,
              total: aggregatedEdges.length,
              cursor: 0,
              hasMore: false,
              aggregated: true,
            }, req, corsConfig, etagHeader);
            return;
          }
        }

        const total = filteredEdges.length;
        const pagedEdges = filteredEdges.slice(cursor, cursor + limit);
        const hasMore = cursor + limit < total;

        sendJson(res, 200, { edges: pagedEdges, total, cursor: cursor + limit, hasMore }, req, corsConfig, etagHeader);
        return;
      }

      sendJson(res, 200, { edges: [], total: 0, cursor: 0, hasMore: false }, req, corsConfig, etagHeader);
    }),
  }), 'codegraph: edges route');
}