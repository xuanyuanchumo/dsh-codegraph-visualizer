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
- ctx.slots.inject() returns a disposer — must save and track it alongside other disposers, not discard the return value
- color-mix() CSS function needs rgba fallback in a separate file — every usage must have a corresponding fallback entry in color-mix-fallback.css
- @container CSS Container Queries need @supports not (container-type: inline-size) fallback for older browsers
- betterSidebar.registerTab() may not return a disposer — must guard with typeof dispose === 'function' before calling
- prefetchExpand uses requestIdleCallback/setTimeout — must save the handle and cancel it in disposeStore to prevent stale writes after dispose
- LayoutController worker timeout must auto-retry via retryWorkerInit() — never set workerInitFailed=true on timeout, or worker layout is permanently disabled
- DataController.processBatchQueue RAF callback must check this.destroyed at the top — destroy() may be called before the RAF fires
- FilterController.safeRegExp must check for nested quantifiers (e.g. (a+)+, (a*)*) — simple length checks are insufficient for ReDoS prevention
- readEdgesFromDb file scope must NOT use LIMIT/OFFSET per IN-clause batch — query all edges then slice in memory, because SQL OFFSET applies to the whole result set not per-batch
- VirtualViewportController.handleStructureChange must schedule updateVisibility via RAF, not just set indexDirty — otherwise new nodes won't be indexed until next viewport change
- assembleMultiFunction must use fetchWithTimeout (not bare fetch) and check multiAssemblyGeneration before applying state — bare fetch has no timeout and no stale-write protection
- progressiveCluster module-level caches (_dirToNodesCache/_fileToNodesCache) must be invalidated in disposeStore via invalidateExpandCostCache() — otherwise they hold stale rawNodes references
- E2E "timeout" is a symptom, never a diagnosis: locate落空 / CSS hidden / `visible=false` 不渲染 / 桩数据被装配器过滤 all surface as TimeoutError seconds later. Always read the error-context page snapshot first and confirm whether the element exists in the DOM before touching any timeout. TODO-02 was misdiagnosed as "Playwright 超时" for 8 rounds; the real causes were selector drift + dev-server stub gaps (docs/需求分析.md §59.19)
- dev-server stub graph must satisfy the view assembler: CallGraphAssembler keeps ONLY `function` nodes (CALL_NODE_TYPES), so any cycle or selectable node used by E2E must be a function — a cycle through a `class` node silently disappears and the panel never renders. Stub graph lives in ONE place (`MOCK_GRAPH`); page-inline and server-side copies must never drift apart
- helpers.ts emitNodeEvent is a silent no-op when the node is absent — use selectNodeStrict() in assertions, which throws with the available id list
- An HTTP validator must live in the SAME domain as what it validates: store.lastUpdated is a DISPLAY field written as Date.now() on the SSE/delta paths and metadata.timestamp on bootstrap — feeding it to if-none-match either never matches (full re-fetch every time) or matches falsely (a real update silently dropped). The validator must be echoed back verbatim from the response header, never re-derived on the client (docs/需求分析.md §59.20)
- A validator with no identity dimension is not a validator: String(metadata.timestamp) alone let one workspace's revision answer 304 for another workspace's request, and one resource's validator answer for a different resource. Both dimensions must be COMPILE-TIME mandatory (GraphEtagResource has no default) — "the new call site does not have to state what it validates" is the recurrence mechanism, exactly as with scopeRepoId in Round 16
- Moving an ETag check from a synchronous block into an awaited one breaks every test that reads the response synchronously: res.writeHead(304) has not run yet, so the test sees code 0 and reports a FALSE failure. Change those cases to await handler(req, res) before suspecting the code
- When "wrongly reporting unchanged" and "wrongly reporting changed" have asymmetric costs, deliberately bias toward "wrongly reporting changed": an extra 200 costs one transfer, but a false 304 silently discards a real update. This is why the host scopes the validator by the REQUESTED workspace while taking the revision from the single slot
- A test fixture must NEVER invent an external contract. RemoteWebUiIntegration.test.ts (63 assertions) and SpotlightIntegration.test.ts (40) were 100% green for two rounds while their subject was dead code, because the fixtures hand-wrote the service object the code was probing for. Fixtures may only be a structural transcription of a real contract (.d.ts field-for-field) and must cite the source path + line in the file header
- Decide whether an external service key exists by TWO-WAY evidence: a static `provide(` scan AND a real `ctx.get` call site. "A plugin README mentioned it" or "the naming convention implies it" produces永不执行的分支 and a false compatibility narrative (docs/research/dsh-多代API规范差异与兼容矩阵.md §2.3)
- A service present in BOTH generations cannot identify a generation: sidebarRightTabs / documentPreviews / slots exist in gen1 and gen2 (dsh-client-ui-slots lib/index.js is byte-identical across generations). Only services exclusive to one line work — pluginNavigation and userQuestionPanels are the only gen2-only markers found
- Platform detection must be lazily evaluated, never cached at apply(): the Electron preload writes `<html data-platform="darwin">` / `data-windows-titlebar` and the mark may arrive as late as DOMContentLoaded. Read the DOM on every call and use MutationObserver to re-evaluate. `process.versions.electron` has ZERO hits across all @deepseek-ai JS — do not use it
- DSH has no desktop client platform: dsh-client-modules only loads a client half when `dsh.client.platform === 'web'`, so web and desktop share one bundle; the only per-platform difference a plugin can observe is the DOM marks above plus the --dsh-frame-* CSS variables
- Only peerDependencies on @deepseek-ai/dsh* is enforced; `engines.dsh` and `dsh.manifestVersion` are pure declarations with no reader (dsh-package-manifest README: "Compatibility is declarative"). Declaring a range promises nothing — the peer range is the promise
- Use `write` for large rewrites, not `edit`: an edit anchored only on a comment line while the new_string re-includes the surrounding context duplicated GEN2_MAPPING/GEN3_MAPPING/UNKNOWN_MAPPING and produced TS2451 "Cannot redeclare block-scoped variable"
- `ctx.get(name)` defaults to `strict = true`, which means "the PROVIDING FIBER IS CURRENTLY ACTIVE", not "the service exists" (cordis/lib/index.js:763-772; reflect.d.ts:16). Probing it once inside a synchronous `apply()` permanently kills every service whose provider is still in state 1 (loading) at that instant — this is exactly how all 5 slash commands went unregistered while `slots` (loaded earlier) read fine. Use `ctx.get(key, false)` for existence and `ctx.inject([key], cb)` for ordering
- A capability snapshot that gates an integration is a one-instant-decides-forever defect amplifier: `if (!flags.commandUi) return;` silently removed a whole feature with NO error — only the single `client feature flags resolved` log line could disprove it. Never early-return an integration on a snapshot; let the reactive injection decide
- Only MUTUALLY EXCLUSIVE channels belong in the synchronous priority chain: BetterSidebarIntegration was briefly moved to `ctx.inject`, then deliberately reverted, because the fallbacks (slots/floating) occupy `navButtonRegistered` synchronously and would win the race before the injected callback ran — a priority inversion that would give the WORSE channel the only entry point. Async-inject only additive, non-exclusive contribution surfaces
- When an upstream defect makes your own fixed plugin look broken, prove your half first: `commandUi contributions registered {count: 5}` (new after the fix) showed registration succeeded while `/` still listed zero commands. Then attribute the residue to upstream and mark it NOT closed — never report the feature as end-to-end working (docs/需求分析.md §59.22(e))
- A plugin's contribution can be erased by a HOST-side failure in the same surface: `dsh-client-ui-commands` candidates() awaits `directory.ensureReady` (lib/client.js:898) BEFORE merging `live.contributions` (line 909), and `ensureReady` rethrows a sticky `failed` state (line 299). One `session/writer-held` from `command.list` therefore removes host commands AND plugin commands together. A plugin-owned `/` source (dsh-client-ui-skill lib/client.js:375-437) bypasses that path entirely
