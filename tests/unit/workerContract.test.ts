import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { LAYOUT_WORKER, RENDERER } from '../../src/shared/constants.ts';
import { serveLayoutWorker, workerFileCandidates, registerLayoutWorkerRoute } from '../../src/host/routes/workerRoutes.ts';

/**
 * The layout worker is loaded by URL, so four separate places have to agree on one path:
 *
 *   1. the client builds the Worker from `LAYOUT_WORKER.ROUTE_PATH` (not from a literal),
 *   2. the host registers exactly that path and serves the file from disk,
 *   3. the build emits exactly one self-contained file at `LAYOUT_WORKER.ARTIFACT`,
 *   4. the publish allowlist ships that artifact.
 *
 * When they drift the failure is silent: the Worker constructor does not throw for an unreachable
 * URL, the error only arrives asynchronously, and the graph quietly falls back to a main-thread
 * layout after a handshake timeout. Round 6 found the worker bundle was never built at all while
 * the client requested `/plugins/dsh-codegraph-visualizer/worker/layoutWorker.js` — a path no DSH
 * host serves — so every attempt 404'd and the retry loop had no upper bound.
 */

const ROOT = process.cwd();
const WORK = mkdtempSync(join(tmpdir(), 'cg-worker-contract-'));

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function makeReq(url: string): IncomingMessage {
  return { method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; state: { code: number; headers: Record<string, string>; body: string } } {
  const state = { code: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    writeHead: (code: number, headers?: Record<string, string>) => {
      state.code = code;
      if (headers) Object.assign(state.headers, headers);
    },
    end: (data?: string) => {
      if (data) state.body = data;
    },
  };
  return { res: res as unknown as ServerResponse, state };
}

describe('layout worker contract', () => {
  it('declares a route path and an artifact that the client and the host share', () => {
    expect(LAYOUT_WORKER.ROUTE_PATH).toBe('/api/v1/codegraph/worker/layoutWorker.js');
    expect(LAYOUT_WORKER.ROUTE_PATH.startsWith('/api/v1/codegraph/')).toBe(true);
    expect(LAYOUT_WORKER.ARTIFACT).toBe('dist/client/worker/layoutWorker.js');
    expect(LAYOUT_WORKER.SOURCE_ENTRY).toBe('src/client/worker/layoutWorker.ts');
    expect(existsSync(join(ROOT, LAYOUT_WORKER.SOURCE_ENTRY))).toBe(true);
  });

  it('keeps the retry budget bounded and the handshake cheaper than a full layout', () => {
    expect(Number.isInteger(RENDERER.WORKER_MAX_INIT_RETRIES)).toBe(true);
    expect(RENDERER.WORKER_MAX_INIT_RETRIES).toBeGreaterThan(0);
    expect(RENDERER.WORKER_MAX_INIT_RETRIES).toBeLessThanOrEqual(5);
    expect(RENDERER.WORKER_HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(RENDERER.WORKER_HANDSHAKE_TIMEOUT_MS).toBeLessThan(RENDERER.LAYOUT_TIMEOUT_MS);
  });

  it('builds the client worker URL from the shared constant and never from a literal', () => {
    const source = read('src/client/renderer/LayoutController.ts');
    expect(source).toContain('LAYOUT_WORKER.ROUTE_PATH');
    // The old code pointed at a plugin asset path that no host serves.
    expect(source).not.toContain("plugins/dsh-codegraph-visualizer");
    expect(source).not.toMatch(/new Worker\(\s*['"`]/);
    // The emitted bundle is a self-contained IIFE, so the Worker must not be constructed as a module.
    expect(source).not.toMatch(/new Worker\([^)]*type:\s*['"`]module/);
  });

  it('never resets the retry budget while constructing a worker', () => {
    const source = read('src/client/renderer/LayoutController.ts');
    // The regression: a reset inside the construction branch made `WORKER_MAX_INIT_RETRIES`
    // unreachable, so an async error event rebuilt the worker forever.
    //
    // Slice with indexOf instead of a `[^}]*` regex: the construction branch contains arrow
    // functions, so a regex stops at the first inner `}` and would silently stop guarding the
    // very line that matters (the mutation check caught exactly that).
    const constructionStart = source.indexOf('if (this.worker) {');
    const messageStart = source.indexOf('this.worker.onmessage');
    const errorStart = source.indexOf('this.worker.onerror');
    expect(constructionStart).toBeGreaterThan(-1);
    expect(messageStart).toBeGreaterThan(constructionStart);
    expect(errorStart).toBeGreaterThan(messageStart);

    const constructionBranch = source.slice(constructionStart, messageStart);
    expect(constructionBranch).not.toContain('workerRetryCount = 0');

    // The reset belongs to the message handler, which only runs after a real reply.
    const messageBranch = source.slice(messageStart, errorStart);
    expect(messageBranch).toContain('workerRetryCount = 0');
  });

  it('registers the shared path on the host and serves the bundle from disk', () => {
    const registrations: Array<{ kind: string; path: string }> = [];
    const ctx = {
      effect: (cb: () => unknown) => cb(),
      webServer: { register: vi.fn((registration: { kind: string; path: string }) => { registrations.push(registration); }) },
    };
    const rc = { deps: { ctx }, corsConfig: { origins: [] }, rateLimiter: {}, invokeUpstream: vi.fn() };

    registerLayoutWorkerRoute(rc as never);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.kind).toBe('exact');
    expect(registrations[0]!.path).toBe(LAYOUT_WORKER.ROUTE_PATH);

    // 200 path: an existing bundle is served as JavaScript.
    const bundlePath = join(WORK, 'layoutWorker.js');
    writeFileSync(bundlePath, 'self.onmessage = () => self.postMessage({ positions: {} });', 'utf8');
    const ok = makeRes();
    expect(serveLayoutWorker(makeReq(LAYOUT_WORKER.ROUTE_PATH), ok.res, { origins: [] } as never, [bundlePath])).toBe(true);
    expect(ok.state.code).toBe(200);
    expect(ok.state.headers['content-type']).toContain('text/javascript');
    expect(ok.state.headers['content-length']).toBe(String(Buffer.byteLength(ok.state.body)));
    expect(ok.state.body).toContain('postMessage');

    // 404 path: a missing bundle must say so instead of answering with an empty 200.
    const missing = makeRes();
    expect(serveLayoutWorker(makeReq(LAYOUT_WORKER.ROUTE_PATH), missing.res, { origins: [] } as never, [join(WORK, 'nope.js')])).toBe(false);
    expect(missing.state.code).toBe(404);
    expect(JSON.parse(missing.state.body)).toMatchObject({ success: false, error: 'WORKER_NOT_BUILT' });
  });

  it('looks for the artifact both beside the host bundle and at the repository root', () => {
    const candidates = workerFileCandidates();
    expect(candidates).toHaveLength(2);
    // Packaged installs resolve next to dist/index.js; a checkout resolves from the working directory.
    expect(candidates[0]!.replace(/\\/g, '/')).toContain('/client/worker/layoutWorker.js');
    expect(candidates[1]).toBe(join(resolve(ROOT), LAYOUT_WORKER.ARTIFACT));
  });

  it('emits exactly one self-contained worker file and cleans stale chunks before building', () => {
    const buildScript = read('scripts/build-client.mjs');
    expect(buildScript).toContain(LAYOUT_WORKER.SOURCE_ENTRY);
    expect(buildScript).toContain('dist/client/worker');
    expect(buildScript).toContain('--format iife');
    // A second emitted file would mean the worker grew a dynamic import and stopped being loadable
    // as a classic Worker, so the build fails loudly.
    expect(buildScript).toMatch(/layout worker must stay a single self-contained file/);

    const pkg = JSON.parse(read('package.json')) as { files: string[]; scripts: Record<string, string> };
    expect(pkg.scripts.build).toContain('run clean');
    expect(pkg.scripts.clean).toContain('clean-dist.mjs');
    expect(pkg.files).toContain('dist');

    const cleanScript = read('scripts/clean-dist.mjs');
    expect(cleanScript).toContain("'dist'");
    // Deleting the wrong tree is the one mistake this script must make impossible.
    expect(cleanScript).toContain('dsh-codegraph-visualizer');
  });

  it('installs the CommonJS feature test before the vendored shims can reach for browser globals', () => {
    const worker = read(LAYOUT_WORKER.SOURCE_ENTRY);
    const shimImport = "import './workerShims.ts';";
    // Module evaluation order is the entire mechanism, so the stub import has to be the first
    // import in the entry — anything above it could evaluate the shims first.
    expect(worker.indexOf(shimImport)).toBe(worker.search(/^import\s/m));

    const shims = read('src/client/worker/workerShims.ts');
    // It augments the scope instead of resolving anything: a real `require(...)` body went through
    // the bundler, so the only consumer of this function is a `typeof require === 'function'` test.
    expect(shims).toContain('globalThis');
    expect(shims).toContain('typeof');
    expect(shims).toContain('require');
    // Faking a window would change lodash's environment detection rather than the require branch.
    expect(shims).not.toMatch(/(?:globalThis|self)\s*\.\s*window/);
  });

  it('puts the stub ahead of every browser-global fallback in the emitted bundle', () => {
    const artifact = join(ROOT, LAYOUT_WORKER.ARTIFACT);
    // The artifact only exists after a build; the source-level check above still guards the order.
    if (!existsSync(artifact)) return;
    const bundle = readFileSync(artifact, 'utf8');
    const stub = bundle.indexOf('requireUnavailable');
    expect(stub).toBeGreaterThan(-1);
    // The stub has to be emitted before the libraries whose vendored shims read it, and cytoscape
    // is the first of them in dependency order. The bundler's own doc comment above the code also
    // mentions `window.graphlib`, so compare against a code region rather than the raw string.
    const firstLibrary = bundle.indexOf('//#region node_modules/.pnpm/cytoscape@');
    expect(firstLibrary).toBeGreaterThan(-1);
    expect(stub).toBeLessThan(firstLibrary);
    // A window alias would change lodash's environment detection; only the require test may flip.
    expect(bundle).not.toMatch(/globalScope\.window\s*=/);
  });
});
