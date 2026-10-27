import fs from 'node:fs/promises';
import path from 'node:path';
import { VALIDATION, AST, ERROR_CODES } from '../../shared/constants.ts';
import { RepoId } from '../../types/index.ts';
import { parsePackageJson, parseCargoToml, parseGoMod, dependencyGraphToGraphData } from '../../adapters/DependencyAdapter.ts';
import { TreeSitterAdapter } from '../../adapters/TreeSitterAdapter.ts';
import { computeContentHash } from '../../shared/graphFingerprint.ts';
import { fileChangesToDiffNodes } from '../../shared/gitFileDiff.ts';
import { collectGitChurn } from '../gitChurn.ts';
import { collectGitFileDiff } from '../gitDiff.ts';
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

/**
 * `/churn` 的校验器（研究报告 §六 #11 的取数面）。
 *
 * 身份维度 = **请求方工作区 + HEAD 提交**。刻意不用缓存图的 revision：
 * 变更频率只取决于 git 历史，与 `lastGraphData` 槽无关——拿槽的 revision 会复现
 * P0-R16-02 家族缺陷「校验器与被校验资源无关」（换图但 git 没变 ⇒ 假 200；
 * 有新提交但图没变 ⇒ 假 304，用户永远看不到新的变更频率）。
 */
export function computeChurnEtag(workspacePath: string, revision: string | null, available: boolean): string {
  // 采集失败也要有一个稳定的校验值：否则每次重试都 200，客户端无从判断「还是失败」。
  return `W/"${computeContentHash([workspacePath, revision ?? 'none', String(available)].join('\u0001'))}"`;
}

/**
 * `GET /api/v1/codegraph/churn` — 工作区的 git 变更频率（研究报告 §六 #11）。
 *
 * 返回 `ChurnResult` 原样（`available` / `error` 都在载荷里）：**采集失败必须可见**，
 * 客户端据此显示「未获取到变更频率（仅按依赖关系排序）」，而不是把它当「所有文件 0 次变更」。
 * 这与 `fetchGraphDiff` 失败返回 `null`（而不是空 diff）是同一条纪律。
 */
export function registerChurnRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = '/api/v1/codegraph/churn';

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
          const noWorkspace = { byFile: {}, commitCount: 0, revision: null, truncated: false, available: false, error: 'no workspace' };
          const etag = computeChurnEtag('', null, false);
          if (checkEtag(req, res, corsConfig, etag)) return;
          sendJson(res, 200, noWorkspace, req, corsConfig, etagHeaders(etag));
          return;
        }

        const result = await collectGitChurn(workspacePath);
        const etag = computeChurnEtag(workspacePath, result.revision, result.available);
        if (checkEtag(req, res, corsConfig, etag)) return;
        sendJson(res, 200, result, req, corsConfig, etagHeaders(etag));
      } catch (e) {
        log.error('churn route failed', e);
        sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, req, corsConfig);
      }
    }),
  }), 'codegraph: churn route');
}

/**
 * `POST /api/v1/codegraph/diff` —— 两个 git 引用之间的**文件级**图差异。
 *
 * ## 这一版修掉了两个真机 P0（cycle-105）
 *
 * ### P0-D：旧实现恒返回空 diff（假成功）
 *
 * 旧代码是 `fetchMergedGraph(invoke, `${workspacePath}@${fromCommit}`, 'both')`，即把
 * 「工作区路径 + `@` + 提交号」当成仓库标识去查 `.codegraph/codegraph.db`。该路径永远
 * 不存在，于是 `nodes: []` 而 HTTP 仍回 200。真机实测：两个真实提交之间改了 42 个文件，
 * 面板却显示「没有结构变更」。
 *
 * 根因是**数据面缺一个维度**：`codegraph.db` 索引的是当前工作树，`nodes`/`edges`/`files`
 * 三张表都没有 revision 列。所以「按提交取图」不可实现，不是实现得不好。
 *
 * 修法：改用 `git diff --raw --no-renames -z` 拿变更文件清单，产出**文件级** diff 节点，
 * id 用 `file:<相对路径>`——与画布上文件节点的 id 完全同一命名空间（探针实测 433/433），
 * 因此 `HighlightController.applyDiffMarkers` 的 `getElementById` 能真正命中。
 *
 * 刻意**不**退回「拿 tree-sitter 现场解析两个提交」：tree-sitter 的节点 id 是位置化的
 * （`${filePath}:${label}:${row}`），DB 的 id 是语义化的（`file:...` / `import:<hash>`），
 * 两者不可能对齐——那只是把「标记命中不了」挪个地方。
 *
 * ### P0-E：workspace 从 body 读不到（跨工作区泄漏）
 *
 * 客户端把 workspace 放在 JSON body，而 `resolveWorkspaceFromRequest` 只读 query，
 * 于是回落到宿主列表第一个工作区。真机实测请求 A 仓库却拿到 B 仓库的 repoId。
 * 修法见 `shared.ts` 的 `resolveWorkspaceFromRequest`：现在同时接受 body 里的 workspace。
 *
 * ## 失败语义
 *
 * git 不可用 / 引用不存在 / 超时 ⇒ 回 **500 `GRAPH_DIFF_FAILED`** 并带上原因，
 * 绝不回「空 diff + 200」。后者会让用户把一次失败读成「两版本完全一样」。
 */
export function registerDiffRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
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

        // P0-E：把 body 里的 workspace 一并交给解析器。不传这一项就会静默回落到
        // 宿主列表第一个工作区——真机上表现为「对比了另一个项目」。
        const bodyWorkspace = extractStringField(parsed, 'workspace', VALIDATION.MAX_PATH_LENGTH);
        const workspacePath = await validateWorkspacePath(ctx, deps, req, bodyWorkspace);
        if (workspacePath === '__denied__') {
          sendError(res, 403, ERROR_CODES.WORKSPACE_PATH_NOT_ALLOWED, req, corsConfig);
          return;
        }
        if (!workspacePath) {
          sendJson(res, 200, { nodes: [], edges: [], metadata: { repoId: RepoId('empty'), timestamp: 0, nodeCount: 0, edgeCount: 0 } }, req, corsConfig);
          return;
        }

        // P0-D：真正的数据面是 git 的文件清单，不是 codegraph.db（后者没有 revision 维度）。
        const collected = await collectGitFileDiff(workspacePath, fromCommit, toCommit);
        if (!collected.available) {
          // 失败必须可见：把 git 给出的原因原样带回客户端。
          sendJson(res, 500, {
            success: false,
            error: ERROR_CODES.GRAPH_DIFF_FAILED,
            message: collected.error ?? 'git diff failed',
            from: fromCommit,
            to: toCommit,
          }, req, corsConfig);
          return;
        }

        const nodes = fileChangesToDiffNodes(collected.changes);

        sendJson(res, 200, {
          nodes,
          // 文件级 diff 不产边：`git diff --raw` 只给文件清单，不给「哪两个文件之间新增了
          // 依赖」。硬编一条边等于编造数据。节点上的 `diffStatus` 已足够让画布亮起来。
          edges: [],
          metadata: {
            repoId: RepoId(workspacePath),
            timestamp: Date.now(),
            nodeCount: nodes.length,
            edgeCount: 0,
            // 三个字段刻意放在 metadata 里而不是顶层：客户端 `fetchGraphDiff` 只读
            // `nodes`/`edges`，其余信息（截断、粒度、回显的引用）由面板从顶层读。
          },
          // 显式告诉客户端「这份 diff 是文件级的」——面板据此把文案从
          // 「结构变更」改成「文件变更」，避免用户以为符号级也对比过了。
          granularity: 'file',
          truncated: collected.truncated,
          from: fromCommit,
          to: toCommit,
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