import fs from 'node:fs/promises';
import path from 'node:path';
import { VALIDATION, AST, ERROR_CODES } from '../../shared/constants.ts';
import { RepoId } from '../../types/index.ts';
import { fetchMergedGraph } from '../../tools.ts';
import { parsePackageJson, parseCargoToml, parseGoMod, dependencyGraphToGraphData } from '../../adapters/DependencyAdapter.ts';
import { TreeSitterAdapter } from '../../adapters/TreeSitterAdapter.ts';
import { computeGraphDiff, diffToGraphData } from '../../merger/DiffEngine.ts';
import { computeContentHash } from '../../shared/graphFingerprint.ts';
import {
  readBody, parseJsonBody, extractStringField,
  isSafeGitRef, sendJson, sendError,
} from '../HttpHelpers.ts';
import {
  withRouteMiddleware, resolveAndValidateRelativePath, validateWorkspacePath,
  isSafeRelativePath, checkEtag, etagHeaders, type RouteContext, log,
} from './shared.ts';

/**
 * `/dependencies` 的内容校验器（P3-R27-04 决策矩阵中唯一"按磁盘内容计算"的 GET 分析路由）。
 *
 * 身份维度刻意取**请求方工作区 + 三个 manifest 文件的原始内容**，而不是缓存图槽
 * （`resourceEtag`）——`/dependencies` 的载荷来自磁盘上的 package.json / Cargo.toml / go.mod，
 * 与 `lastGraphData` 槽不是同一份资源。用槽的 revision 会复现 P0-R16-02 家族缺陷：
 * "校验器与被校验资源无关"（图变了 ⇒ manifest 没变也 200；manifest 变了 ⇒ 图没变就假 304）。
 *
 * 哈希输入是**解析前的原始内容**（含文件名标记），比哈希响应体便宜且等价：
 * 解析器是确定性的，相同原始内容必然产出相同载荷。文件增删（ENOENT 变化）同样改变拼接串。
 */
export function computeDependenciesEtag(workspacePath: string, manifestInputs: string[]): string {
  // 与 computeGraphEtag 同一 W/"..." 弱校验器形状；computeContentHash 自带版本前缀。
  return `W/"${computeContentHash([workspacePath, ...manifestInputs].join('\u0001'))}"`;
}

export function registerDependenciesRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/dependencies';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const workspacePath = await validateWorkspacePath(ctx, deps, req);
        if (workspacePath === '__denied__') {
          sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
          return;
        }
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }

        const allDepNodes: ReturnType<typeof dependencyGraphToGraphData>['nodes'] = [];
        const allDepEdges: ReturnType<typeof dependencyGraphToGraphData>['edges'] = [];

        const depFiles: Array<{ filename: string; parser: (content: string) => ReturnType<typeof parsePackageJson> }> = [
          { filename: 'package.json', parser: parsePackageJson },
          { filename: 'Cargo.toml', parser: parseCargoToml },
          { filename: 'go.mod', parser: parseGoMod },
        ];

        // 校验器输入 = 请求方工作区 + 成功读到的每个 manifest 的原始内容（解析前）。
        // 读不到的文件不进输入：文件从"存在"变"不存在"时，manifestInputs 少一段 ⇒ 哈希变 ⇒ 200。
        const manifestInputs: string[] = [];
        for (const { filename, parser } of depFiles) {
          try {
            const filePath = path.join(workspacePath, filename);
            const content = await fs.readFile(filePath, 'utf-8');
            manifestInputs.push(`${filename}\u0000${content}`);
            const depGraph = parser(content);
            const converted = dependencyGraphToGraphData(depGraph);
            allDepNodes.push(...converted.nodes);
            allDepEdges.push(...converted.edges);
          } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Failed to read ${filename}:`, e); }
        }

        // 304 判定必须在算载荷之前（响应根本不用算）；校验值与 200 回写共用同一构造点。
        const depEtag = computeDependenciesEtag(workspacePath, manifestInputs);
        if (checkEtag(req, res, corsConfig, depEtag)) return;

        const dedupNodes = new Map<string, typeof allDepNodes[number]>();
        for (const n of allDepNodes) dedupNodes.set(n.id, n);
        const dedupEdges = new Map<string, typeof allDepEdges[number]>();
        for (const e of allDepEdges) {
          if (e.source !== e.target) dedupEdges.set(e.id, e);
        }

        sendJson(res, 200, {
          nodes: [...dedupNodes.values()],
          edges: [...dedupEdges.values()],
          metadata: {
            repoId: RepoId(workspacePath),
            timestamp: Date.now(),
            nodeCount: allDepNodes.length,
            edgeCount: allDepEdges.length,
          },
        }, req, corsConfig, etagHeaders(depEtag));
      } catch (e) {
        log.error('dependencies route failed', e);
        sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
      }
    }),
  }), 'codegraph: dependencies route');
}

export function registerDiffRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter, invokeUpstream } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/diff';

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
      try {
        const body = await readBody(req, deps.config.maxBodyBytes);
        const parsed = parseJsonBody(body);
        const fromCommit = extractStringField(parsed, 'from', VALIDATION.MAX_GIT_REF_LENGTH);
        const toCommit = extractStringField(parsed, 'to', VALIDATION.MAX_GIT_REF_LENGTH);
        if (!fromCommit || !toCommit) {
          sendError(res, 400, ERROR_CODES.COMMITS_REQUIRED, req, corsConfig);
          return;
        }
        if (!isSafeGitRef(fromCommit) || !isSafeGitRef(toCommit)) {
          sendError(res, 400, ERROR_CODES.INVALID_GIT_REF, req, corsConfig);
          return;
        }

        const workspacePath = await validateWorkspacePath(ctx, deps, req);
        if (workspacePath === '__denied__') {
          sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
          return;
        }
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }

        const beforeGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${fromCommit}`, 'both');
        const afterGraph = await fetchMergedGraph(invokeUpstream, `${workspacePath}@${toCommit}`, 'both');

        const diff = computeGraphDiff(beforeGraph.nodes, beforeGraph.edges, afterGraph.nodes, afterGraph.edges);
        const { nodes, edges } = diffToGraphData(diff);

        sendJson(res, 200, {
          nodes, edges,
          metadata: { repoId: RepoId(workspacePath), timestamp: Date.now(), nodeCount: nodes.length, edgeCount: edges.length },
        }, req, corsConfig);
      } catch (e) {
        log.error('diff route failed', e);
        sendError(res, 500, ERROR_CODES.GRAPH_DIFF_FAILED, req, corsConfig);
      }
    }),
  }), 'codegraph: diff route');
}

export function registerAstRoute(rc: RouteContext, sharedTreeSitterAdapter: TreeSitterAdapter): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/ast';

  ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath', VALIDATION.MAX_FILEPATH_LENGTH);
          if (!filePath) {
            sendError(res, 400, ERROR_CODES.FILEPATH_REQUIRED, req, corsConfig);
            return;
          }
          const realPath = await resolveAndValidateRelativePath(filePath, ctx, deps, req, res, corsConfig);
          if (!realPath) return;
          const content = await fs.readFile(realPath, 'utf-8');
          const MAX_AST_CONTENT = AST.MAX_CONTENT_BYTES;
          if (content.length > MAX_AST_CONTENT) {
            sendError(res, 413, ERROR_CODES.FILE_TOO_LARGE, req, corsConfig, `max ${MAX_AST_CONTENT} bytes`);
            return;
          }
          const astRoot = await sharedTreeSitterAdapter.parseToAst(filePath, content);
          if (!astRoot) {
            sendError(res, 500, ERROR_CODES.AST_PARSE_FAILED, req, corsConfig, `parseToAst returned null for ${filePath}`);
            return;
          }
          sendJson(res, 200, astRoot, req, corsConfig);
        } catch (e) {
          log.error('ast route failed', e);
          sendError(res, 500, ERROR_CODES.AST_PARSE_FAILED, req, corsConfig, e instanceof Error ? e.message : String(e));
        }
      }),
    }), 'codegraph: ast route');
}

export function registerTreeSitterRoute(rc: RouteContext, sharedTreeSitterAdapter: TreeSitterAdapter): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx, config } = deps;
  const routePath = '/api/v1/codegraph/tree-sitter';

  ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: withRouteMiddleware('POST', routePath, corsConfig, rateLimiter, async (req, res) => {
        try {
          const body = await readBody(req, config.maxBodyBytes);
          const parsed = parseJsonBody(body);
          const filePath = extractStringField(parsed, 'filePath');
          const content = extractStringField(parsed, 'content');
          if (!filePath || !content) {
            sendError(res, 400, ERROR_CODES.FILEPATH_AND_CONTENT_REQUIRED, req, corsConfig);
            return;
          }
          if (!isSafeRelativePath(filePath, VALIDATION.MAX_FILEPATH_LENGTH)) {
            sendError(res, 400, ERROR_CODES.INVALID_FILEPATH, req, corsConfig);
            return;
          }
          const MAX_TREE_SITTER_CONTENT = AST.MAX_TREE_SITTER_CONTENT_BYTES;
          if (content.length > MAX_TREE_SITTER_CONTENT) {
            sendError(res, 413, ERROR_CODES.CONTENT_TOO_LARGE, req, corsConfig, `max ${MAX_TREE_SITTER_CONTENT} bytes, got ${content.length}`);
            return;
          }
          const result = await sharedTreeSitterAdapter.parseFile(filePath, content);
          // P0-6: contentHash lets a caller recognise an identical parse request (and lets a client
          // key its AST cache on content rather than on the file path alone).
          sendJson(res, 200, { ...result, contentHash: computeContentHash(content) }, req, corsConfig);
        } catch (e) {
          log.error('tree-sitter route failed', e);
          sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
        }
      }),
    }), 'codegraph: tree-sitter route');
}