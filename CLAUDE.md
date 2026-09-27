# DSH CodeGraph Visualizer

## Commands
- Build: `pnpm run build`
- Test: `pnpm run test`
- Lint: `pnpm run lint`
- Typecheck: `pnpm run typecheck`
- Coverage: `pnpm run test:coverage`
- E2E: `pnpm run test:e2e`

## Verifying your work
- Run build, test, and lint before reporting done.
- Paste output as evidence.

## Conventions
- ESM only: `"type": "module"` in package.json, `.ts` extensions in imports
- Host/Client isolation: tsconfig.host.json and tsconfig.client.json separate compilation
- Branded types: NodeId, EdgeId, RepoId prevent ID mixing across boundaries
- Plugin lifecycle: ctx.effect() for side effects, return disposer for cleanup
- State management: Zustand with persist middleware, graphStore as single source of truth
- Rendering: Cytoscape.js via IRenderer interface abstraction
- Logging: scoped() logger from shared/Logger.ts, not console directly
- i18n: All user-facing text via t() from i18n/index.ts
- CSS: cg- prefix for all class names, CSS variables for theming
- Testing: vitest for unit/component, Playwright for E2E

## Things the agent gets wrong
- addEdge in DataController can silently drop edges when endpoints are missing — callers must check the return value before updating currentEdges
- SearchController Trie index is NOT auto-rebuilt when rawNodes change — must call rebuildIndex() after setRawNodes
- SQLite IN clause has a parameter limit (999/32766) — use SQLITE.MAX_IN_PARAMS batching for large node ID lists
- expandNode async callbacks (fetchFileOutline/fetchSymbolAST) must check expandGeneration before applying state to avoid stale writes
- disposeStore must clean up prefetchAbortControllers and prefetchInFlightCount to prevent memory leaks
- fuzzyScore with empty pattern returns 1 (matches everything) to stay consistent with fuzzyMatch semantics
- Routes data endpoint has no built-in size limit — must check payload size and slim if exceeding API.DATA_RESPONSE_MAX_BYTES
