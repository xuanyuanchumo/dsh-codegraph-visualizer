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
- [fill in as mistakes are made]
