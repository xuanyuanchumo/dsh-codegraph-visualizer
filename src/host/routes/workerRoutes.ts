import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { LAYOUT_WORKER } from '../../shared/constants.ts';
import type { IncomingMessage, ServerResponse } from '../../types/index.ts';
import { buildCorsHeaders } from '../HttpHelpers.ts';
import { withRouteMiddleware, log, type RouteContext } from './shared.ts';

/**
 * Candidate locations of the built layout worker.
 *
 * Packaged installs run the host as `dist/index.js`, so the worker sits next to it under
 * `dist/client/worker/`. When the plugin runs straight from a checkout (`pnpm dev`, and every test
 * run) the same file exists relative to the repository root instead. Both are tried in order and
 * the first hit wins, so one route serves every layout.
 */
export function workerFileCandidates(): string[] {
  const besideBundle = fileURLToPath(new URL('./client/worker/layoutWorker.js', import.meta.url));
  const fromRepoRoot = join(process.cwd(), LAYOUT_WORKER.ARTIFACT);
  return [besideBundle, fromRepoRoot];
}

/**
 * Write the worker bundle, or an honest 404 explaining that it was never built.
 *
 * Returns true when the bundle was served. The candidate list is injectable so both branches stay
 * unit-testable without depending on whether the caller has run a build.
 */
export function serveLayoutWorker(
  req: IncomingMessage,
  res: ServerResponse,
  corsConfig: RouteContext['corsConfig'],
  candidates: string[] = workerFileCandidates(),
): boolean {
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    // Honest failure: the client only retries a bounded number of times and then keeps the
    // main-thread layout, but the log must say why the worker is missing.
    log.warn('layout worker bundle missing', { tried: candidates, artifact: LAYOUT_WORKER.ARTIFACT });
    res.writeHead(404, { 'content-type': 'application/json', ...buildCorsHeaders(req, corsConfig) });
    res.end(JSON.stringify({
      success: false,
      error: 'WORKER_NOT_BUILT',
      message: `layout worker bundle not found; run the build to produce ${LAYOUT_WORKER.ARTIFACT}`,
    }));
    return false;
  }

  const source = readFileSync(found, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': String(Buffer.byteLength(source)),
    'cache-control': 'no-cache',
    ...buildCorsHeaders(req, corsConfig),
  });
  res.end(source);
  return true;
}

/**
 * Serve the layout worker bundle.
 *
 * A browser Worker is loaded from a URL, so the bundle has to be reachable over HTTP. The
 * alternative the old code assumed — that DSH exposes the plugin's own files under
 * `/plugins/<package>/...` — does not hold: no such asset route exists, so every worker request
 * answered 404 and each layout quietly fell back to the main thread. This route uses the plugin's
 * own HTTP surface, which is already the origin of every other request the client makes.
 */
export function registerLayoutWorkerRoute(rc: RouteContext): void {
  const { deps, corsConfig, rateLimiter } = rc;
  const { ctx } = deps;
  const routePath = LAYOUT_WORKER.ROUTE_PATH;

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: routePath,
    handler: withRouteMiddleware('GET', routePath, corsConfig, rateLimiter, (req, res) => {
      serveLayoutWorker(req, res, corsConfig);
    }),
  }), 'codegraph: layout worker route');
}
