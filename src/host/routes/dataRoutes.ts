import { VALIDATION, BOOTSTRAP, ERROR_CODES, API, EDGES_AGGREGATION, SYMBOL_AST } from '../../shared/constants.ts';
import type { GraphEdge, GraphNode, GraphData } from '../../types/index.ts';
import { RepoId, NodeId, EdgeId } from '../../types/index.ts';
import {
  resolveDbPath, readTopLevelNodesFromDb, readNodeChildrenFromDb, readFileOutlineFromDb, readSymbolASTFromDb, readEdgesFromDb, readEdgesForNodesFromDb, countEdgesInDb, FILTERED_EDGE_KINDS,
} from '../../adapters/CodeGraphAdapter.ts';
import { mapDbNodesToGraphNodes, mapDbEdgesToGraphEdges } from '../DbMapper.ts';
import { buildCorsHeaders, sendJson, sendError } from '../HttpHelpers.ts';
import {
  withRouteMiddleware, resolveWorkspaceFromRequest, checkEtag, slimGraphData,
  triggerBackgroundBuild, type RouteContext,
} from './shared.ts';

interface GraphIndex {
  parentIdToChildren: Map<string, GraphNode[]>;
  filePathToNodeIds: Map<string, Set<string>>;
  nodeIdToFilePath: Map<string, string>;
  rootNodes: GraphNode[];
}

let _indexCacheFor: GraphData | null = null;
let _indexCache: GraphIndex | null = null;

function getGraphIndex(data: GraphData): GraphIndex {
  if (_indexCacheFor === data && _indexCache) return _indexCache;
  _indexCacheFor = data;

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

  _indexCache = { parentIdToChildren, filePathToNodeIds, nodeIdToFilePath, rootNodes };
  return _indexCache;
}

export function registerDataRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/data';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const lastGraphData = deps.getLastGraphData();
      if (lastGraphData && checkEtag(req, res, corsConfig, String(lastGraphData.metadata.timestamp))) {
        return;
      }
      if (lastGraphData) {
        const payload = JSON.stringify(lastGraphData);
        if (payload.length > API.DATA_RESPONSE_MAX_BYTES) {
          const slimmed = slimGraphData(lastGraphData, API.DATA_RESPONSE_SLIM_NODES);
          const slimPayload = JSON.stringify(slimmed);
          const dataHeaders = buildCorsHeaders(req, corsConfig);
          dataHeaders['content-type'] = 'application/json';
          dataHeaders['etag'] = String(lastGraphData.metadata.timestamp);
          dataHeaders['x-truncated'] = '1';
          res.writeHead(200, dataHeaders);
          res.end(slimPayload);
        } else {
          const dataHeaders = buildCorsHeaders(req, corsConfig);
          dataHeaders['content-type'] = 'application/json';
          dataHeaders['etag'] = String(lastGraphData.metadata.timestamp);
          res.writeHead(200, dataHeaders);
          res.end(payload);
        }
      } else {
        sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
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
      const workspacePath = resolveWorkspaceFromRequest(req, ctx, deps);

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

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
          }, req, corsConfig);
          return;
        }
      }

      const lastGraphData = deps.getLastGraphData();
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
          },
        }, req, corsConfig);
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
      }, req, corsConfig);
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
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const nodeId = url.searchParams.get('nodeId');
      if (!nodeId || nodeId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cursor = url.searchParams.get('cursor') ?? null;
      const limit = parseInt(url.searchParams.get('limit') ?? String(BOOTSTRAP.CHILDREN_PAGE_SIZE), 10) || BOOTSTRAP.CHILDREN_PAGE_SIZE;

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      const workspacePath = resolveWorkspaceFromRequest(req, ctx, deps);
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
          }, req, corsConfig);
          return;
        }
      }

      const lastGraphData = deps.getLastGraphData();
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
        }, req, corsConfig);
        return;
      }

      sendJson(res, 200, { nodes: [], edges: [], cursor: null, total: 0 }, req, corsConfig);
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
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
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

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      const workspacePath = resolveWorkspaceFromRequest(req, ctx, deps);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readFileOutlineFromDb(dbPath, nodeId);
        if (dbResult && dbResult.nodes.length > 0) {
          const symbols = mapDbNodesToGraphNodes(dbResult.nodes, nodeId);
          const symbolIds = new Set(symbols.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...symbolIds]);
          const symbolEdges = mapDbEdgesToGraphEdges(dbEdges);
          sendJson(res, 200, { symbols, edges: symbolEdges }, req, corsConfig);
          return;
        }
      }

      const lastGraphData = deps.getLastGraphData();
      if (!lastGraphData) {
        sendJson(res, 200, { symbols: [], edges: [] }, req, corsConfig);
        return;
      }

      const symbols = getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? [];
      const symbolIds = new Set(symbols.map((n) => n.id));
      const symbolEdges = lastGraphData.edges.filter(
        (e) => symbolIds.has(e.source) && symbolIds.has(e.target),
      );

      sendJson(res, 200, { symbols, edges: symbolEdges }, req, corsConfig);
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
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
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

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      const budget = Math.min(
        parseInt(url.searchParams.get('budget') ?? String(SYMBOL_AST.MAX_NODES), 10),
        SYMBOL_AST.MAX_NODES,
      );

      const workspacePath = resolveWorkspaceFromRequest(req, ctx, deps);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
        const dbResult = readSymbolASTFromDb(dbPath, nodeId);
        if (dbResult && dbResult.nodes.length > 0) {
          const allAstNodes = mapDbNodesToGraphNodes(dbResult.nodes, nodeId);
          const hasMore = allAstNodes.length > budget;
          const astNodes = hasMore ? allAstNodes.slice(0, budget) : allAstNodes;
          const astNodeIds = new Set(astNodes.map((n) => n.id));
          const dbEdges = readEdgesForNodesFromDb(dbPath, [...astNodeIds]);
          const astEdges = mapDbEdgesToGraphEdges(dbEdges);
          sendJson(res, 200, { astNodes, astEdges, sourceLines: [], hasMore }, req, corsConfig);
          return;
        }
      }

      const lastGraphData = deps.getLastGraphData();
      if (!lastGraphData) {
        sendJson(res, 200, { astNodes: [], astEdges: [], sourceLines: [], hasMore: false }, req, corsConfig);
        return;
      }

      const allAstNodes = getGraphIndex(lastGraphData).parentIdToChildren.get(nodeId) ?? [];
      const hasMore = allAstNodes.length > budget;
      const astNodes = hasMore ? allAstNodes.slice(0, budget) : allAstNodes;
      const astNodeIds = new Set(astNodes.map((n) => n.id));
      const astEdges = lastGraphData.edges.filter(
        (e) => astNodeIds.has(e.source) && astNodeIds.has(e.target),
      );

      sendJson(res, 200, { astNodes, astEdges, sourceLines: [], hasMore }, req, corsConfig);
    }),
  }), 'codegraph: symbol AST route');
}

export function registerEdgesRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/edges';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const fromId = url.searchParams.get('from') ?? '';
      const scope = url.searchParams.get('scope') ?? 'file';
      const cursor = parseInt(url.searchParams.get('cursor') ?? '0', 10);
      const limit = Math.min(parseInt(url.searchParams.get('limit') ?? String(EDGES_AGGREGATION.PAGE_SIZE), 10), EDGES_AGGREGATION.PAGE_SIZE);
      const aggregated = url.searchParams.get('aggregated') === '1';

      if (!fromId || fromId.length > VALIDATION.MAX_PATH_LENGTH) {
        sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
        return;
      }

      const cachedData = deps.getLastGraphData();
      if (cachedData && checkEtag(req, res, corsConfig, String(cachedData.metadata.timestamp))) {
        return;
      }

      const workspacePath = resolveWorkspaceFromRequest(req, ctx, deps);
      if (workspacePath) {
        const dbPath = resolveDbPath(workspacePath);
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
          }, req, corsConfig);
          return;
        }
      }

      const lastGraphData = deps.getLastGraphData();
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

          if (!aggregated && filteredEdges.length > EDGES_AGGREGATION.THRESHOLD) {
            const nodeIdToFilePath = index.nodeIdToFilePath;
            const filePairCounts = new Map<string, number>();
            for (const e of filteredEdges) {
              const srcFile = nodeFilePaths.get(e.source) ?? nodeIdToFilePath.get(e.source) ?? '?';
              const tgtFile = nodeFilePaths.get(e.target) ?? nodeIdToFilePath.get(e.target) ?? '?';
              const pairKey = srcFile < tgtFile ? `${srcFile}\0${tgtFile}` : `${tgtFile}\0${srcFile}`;
              filePairCounts.set(pairKey, (filePairCounts.get(pairKey) ?? 0) + 1);
            }
            const aggregatedEdges = [...filePairCounts.entries()].map(([pairKey, count]) => {
              const [fileA, fileB] = pairKey.split('\0');
              return {
                id: EdgeId(`agg:${pairKey}`),
                source: NodeId(fromId),
                target: NodeId(fileA === fromId ? (fileB ?? fromId) : (fileA ?? fromId)),
                type: 'dependency' as const,
                properties: { aggregated: true, count, filePair: pairKey },
              };
            });
            sendJson(res, 200, {
              edges: aggregatedEdges,
              total: aggregatedEdges.length,
              cursor: 0,
              hasMore: false,
              aggregated: true,
            }, req, corsConfig);
            return;
          }
        }

        const total = filteredEdges.length;
        const pagedEdges = filteredEdges.slice(cursor, cursor + limit);
        const hasMore = cursor + limit < total;

        sendJson(res, 200, { edges: pagedEdges, total, cursor: cursor + limit, hasMore }, req, corsConfig);
        return;
      }

      sendJson(res, 200, { edges: [], total: 0, cursor: 0, hasMore: false }, req, corsConfig);
    }),
  }), 'codegraph: edges route');
}