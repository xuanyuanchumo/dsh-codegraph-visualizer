# 评估报告

**循环**: cycle-1
**时间**: 2026-09-14T12:19:31.157Z
**维度**: E3, E4, E6

## 评估结果

| 维度 | 名称 | 结果 | 详情 |
|------|------|------|------|
| E3 | 测试覆盖 | PASS | > dsh-codegraph-visualizer@0.2.0 test
> vitest run


 RUN  v3.2.7 D:/Projects/TraeProjects/dsh-codegraph-visualizer

stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > should return error result when parsing without init and wasm unavailable
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

 ✓ tests/unit/HighlightController.test.ts (18 tests) 150ms
stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > init should set parser when web-tree-sitter available
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > init should be idempotent (no-op if already initialized)
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > parseFile should return error for unsupported file extension
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > parseFile should return error when parser fails to init
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > destroy should clear loaded languages
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

stdout | tests/unit/treeSitterAdapter.test.ts > TreeSitterAdapter (FR-20) > should handle parseFile with empty content
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

 ✓ tests/unit/treeSitterAdapter.test.ts (15 tests) 200ms
stdout | tests/unit/routes.test.ts > registerRoutes > GET /status returns prerequisites status
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > GET /workspace returns current path and list
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/workspace', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > GET /data returns empty graph when no lastGraphData
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/data', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > GET /data returns cached graph with etag
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/data', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > GET /data returns 304 when etag matches
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/data', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan fetches and returns graph data
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan fetches and returns graph data
[codegraph:host] scan completed { repoId: '/test/workspace', nodes: 1, edges: 0 }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan returns 403 for disallowed path
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan returns 500 on fetch error
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan returns cached data when within TTL
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan returns cached data when within TTL
[codegraph:host] scan completed { repoId: '/test/workspace', nodes: 1, edges: 0 }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /scan returns cached data when within TTL
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /init initializes graph and returns success
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/init', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /init initializes graph and returns success
[codegraph:host] init requested { path: '/test/workspace' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /init returns 403 for disallowed path
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/init', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /init returns 500 on error
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/init', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /init returns 500 on error
[codegraph:host] init requested { path: '/test/workspace' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /watch toggles watch mode
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/watch', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /watch returns 403 for disallowed path
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/watch', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /watch returns 500 on error
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/watch', ip: 'unknown' }

stdout | tests/unit/routes.test.ts > registerRoutes > GET /dependencies returns empty when no workspace
[codegraph:host] request {
  method: 'GET',
  path: '/api/v1/codegraph/dependencies',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes > GET /dependencies returns 403 when workspace path not allowed
[codegraph:host] request {
  method: 'GET',
  path: '/api/v1/codegraph/dependencies',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes > GET /dependencies returns dependency graph
[codegraph:host] request {
  method: 'GET',
  path: '/api/v1/codegraph/dependencies',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes > POST /diff returns 400 when from/to missing
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /diff returns 400 for invalid git ref
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

 ✓ tests/unit/DataController.test.ts (19 tests) 362ms
stdout | tests/unit/routes.test.ts > registerRoutes > POST /diff returns diff graph
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /diff returns empty when no workspace
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /diff returns 403 when workspace not allowed
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes > POST /tree-sitter parses content
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes > POST /tree-sitter returns 400 when filePath missing
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes > POST /tree-sitter returns 413 when content too large
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes > POST /tree-sitter returns 500 on parse error
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes - CORS > sets CORS header for matching origin
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > registerRoutes - CORS > does not set CORS header without request origin
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns AST on success
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 400 when filePath missing
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 400 when no workspace path configured
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 403 when path outside workspace
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 403 when isPathAllowed returns false
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 413 when file content too large
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 500 when AST parsing returns null
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /ast > returns 500 on file read error
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/ast', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /tree-sitter (additional) > returns 400 when filePath contains ..
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > POST /tree-sitter (additional) > returns 400 when filePath exceeds 512 characters
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > POST /tree-sitter (additional) > returns 400 when content missing
[codegraph:host] request {
  method: 'POST',
  path: '/api/v1/codegraph/tree-sitter',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > POST /scan (additional) > returns in-flight data when a scan is already running
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /scan (additional) > uses specific path when provided (not ".")
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/scan', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /scan (additional) > uses specific path when provided (not ".")
[codegraph:host] scan completed { repoId: '/custom/path', nodes: 1, edges: 0 }

stdout | tests/unit/routes.test.ts > POST /init (additional) > returns failure result when invokeUpstream returns null
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/init', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /init (additional) > returns failure result when invokeUpstream returns null
[codegraph:host] init requested { path: '/test/workspace' }

stdout | tests/unit/routes.test.ts > POST /watch (additional) > toggles watch mode off when enabled is false
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/watch', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /diff (additional) > returns 500 on fetch error
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /diff (additional) > returns 400 when both from and to missing
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > POST /diff (additional) > rejects git ref containing ..
[codegraph:host] request { method: 'POST', path: '/api/v1/codegraph/diff', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > GET /data (additional) > returns empty graph when if-none-match present but no cached data
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/data', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > GET /data (additional) > returns full data when if-none-match is older than timestamp
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/data', ip: '127.0.0.1' }

stdout | tests/unit/routes.test.ts > GET /dependencies (additional) > parses go.mod when present
[codegraph:host] request {
  method: 'GET',
  path: '/api/v1/codegraph/dependencies',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > GET /dependencies (additional) > parses package.json and Cargo.toml when present
[codegraph:host] request {
  method: 'GET',
  path: '/api/v1/codegraph/dependencies',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > GET /dependencies (additional) > returns 500 when findWorkspacePath throws
[codegraph:host] request {
  method: 'GET',
  path: '/api/v1/codegraph/dependencies',
  ip: '127.0.0.1'
}

stdout | tests/unit/routes.test.ts > registerRoutes - rate limiting > returns 429 when rate limit exceeded for /status
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '10.0.181.73' }

stdout | tests/unit/routes.test.ts > registerRoutes - CORS (additional) > does not set CORS header for non-matching origin
[codegraph:host] request { method: 'GET', path: '/api/v1/codegraph/status', ip: '127.0.0.1' }

 ✓ tests/unit/routes.test.ts (81 tests) 245ms
 ✓ tests/unit/tools.test.ts (95 tests) 186ms
stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > should register 8 tools and 6 event listeners
[codegraph:host] prerequisite status { codegraph: false, lens: false }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > should forward repo imported/scanned events as graph updated events
[codegraph:host] prerequisite status { codegraph: false, lens: false }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > request-scan should emit graph updated + graph data with merged counts
[codegraph:host] prerequisite status { codegraph: false, lens: false }
[codegraph:host] scan requested { path: '/tmp/repo' }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > request-scan should emit graph updated + graph data with merged counts
[codegraph:host] scan completed { repoId: '/tmp/repo', nodes: 1, edges: 0 }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > graph init success should emit init-result + trigger scan
[codegraph:host] prerequisite status { codegraph: false, lens: false }
[codegraph:host] init requested { path: '/tmp/repo' }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > graph init success should emit init-result + trigger scan
[codegraph:host] scan requested { path: '/tmp/repo' }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > graph init success should emit init-result + trigger scan
[codegraph:host] scan completed { repoId: '/tmp/repo', nodes: 1, edges: 0 }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > graph init failure should emit failed init-result
[codegraph:host] prerequisite status { codegraph: false, lens: false }
[codegraph:host] init requested { path: '/tmp/repo' }

 ✓ tests/unit/prerequisites.test.ts (21 tests) 778ms
   ✓ detectCodegraphCli > returns a boolean indicating whether codegraph CLI is available  745ms
 ✓ tests/unit/layoutWorker.test.ts (11 tests) 953ms
 ✓ tests/unit/adapters.test.ts (65 tests) 518ms
 ✓ tests/unit/chaos.test.ts (18 tests) 611ms
   ✓ Chaos: graphStore error recovery > should recover from error state when new data arrives  491ms
stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > should emit prerequisite status on apply
[codegraph:host] prerequisite status { codegraph: false, lens: false }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > watch toggle should close existing watcher when disabled
[codegraph:host] prerequisite status { codegraph: false, lens: false }
[codegraph:host] watch disabled 

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > watch toggle should start watching when enabled
[codegraph:host] prerequisite status { codegraph: false, lens: false }
[codegraph:host] watch enabled { path: '/tmp/repo' }

stdout | tests/unit/plugin.test.ts > apply() plugin entry (J13 lifecycle) > should register effect for cleanup
[codegraph:host] prerequisite status { codegraph: false, lens: false }

 ✓ tests/unit/plugin.test.ts (18 tests) 751ms
 ✓ tests/unit/virtualViewportAndLayout.test.ts (10 tests) 139ms
stdout | tests/unit/integration.test.ts > Integration: TreeSitter parse pipeline (FR-20) > should detect language and return error for unsupported file
[codegraph:tree-sitter-adapter] TreeSitter parser initialized 

 ✓ tests/unit/integration.test.ts (8 tests) 54ms
 ✓ tests/unit/api.test.ts (23 tests) 42ms
 ✓ tests/unit/dependencyAdapter.test.ts (14 tests) 26ms
stdout | tests/unit/watcher.test.ts > registerEventListeners > request-scan listener calls scanAndPush
[codegraph:host] scan requested { path: '/repo' }

stdout | tests/unit/watcher.test.ts > registerEventListeners > request-scan listener calls scanAndPush
[codegraph:host] scan completed { repoId: '/repo', nodes: 1, edges: 0 }

stdout | tests/unit/watcher.test.ts > registerEventListeners > graph init listener emits init-result on success
[codegraph:host] init requested { path: '/repo' }

stdout | tests/unit/watcher.test.ts > registerEventListeners > graph init listener emits init-result on success
[codegraph:host] scan requested { path: '/repo' }

stdout | tests/unit/watcher.test.ts > registerEventListeners > graph init listener emits init-result on success
[codegraph:host] scan completed { repoId: '/repo', nodes: 1, edges: 0 }

stdout | tests/unit/watcher.test.ts > registerEventListeners > graph init listener emits failed init-result when init returns null
[codegraph:host] init requested { path: '/repo' }

stdout | tests/unit/watcher.test.ts > registerEventListeners > graph init listener emits failed init-result on exception
[codegraph:host] init requested { path: '/repo' }

 ✓ tests/unit/watcher.test.ts (9 tests) 37ms
 ✓ tests/unit/HealthScorer.test.ts (71 tests) 35ms
 ✓ tests/unit/services.test.ts (51 tests) 37ms
 ✓ tests/unit/cli.test.ts (12 tests) 32ms
 ✓ tests/unit/CallChainAggregator.test.ts (11 tests) 21ms
stdout | tests/unit/mcpServer.test.ts > McpServer (FR-46) > start > should start server and set running to true
[codegraph:mcp-server] MCP server started { tools: 4 }

stdout | tests/unit/mcpServer.test.ts > McpServer (FR-46) > start > should handle close event and set running to false
[codegraph:mcp-server] MCP server started { tools: 4 }

stdout | tests/unit/mcpServer.test.ts > McpServer (FR-46) > start > should handle close event and set running to false
[codegraph:mcp-server] MCP server stopped 

 ✓ tests/unit/mcpServer.test.ts (28 tests) 29ms
 ✓ tests/unit/diffEngine.test.ts (39 tests) 29ms
 ✓ tests/unit/PathFinder.test.ts (11 tests) 2991ms
   ✓ PathFinder > findPath returns null when node count exceeds 10000  2908ms
stdout | tests/unit/logger.test.ts > Logger (log management) > should record entries at the given level/scope
[codegraph:host] hello { a: 1 }

stdout | tests/unit/logger.test.ts > Logger (log management) > should respect minLevel: debug hidden at info level
[codegraph:host] appears 

stdout | tests/unit/logger.test.ts > Logger (log management) > should cap the ring buffer at 200 entries
[codegraph:host] m0 
[codegraph:host] m1 
[codegraph:host] m2 
[codegraph:host] m3 
[codegraph:host] m4 
[codegraph:host] m5 
[codegraph:host] m6 
[codegraph:host] m7 
[codegraph:host] m8 
[codegraph:host] m9 
[codegraph:host] m10 
[codegraph:host] m11 
[codegraph:host] m12 
[codegraph:host] m13 
[codegraph:host] m14 
[codegraph:host] m15 
[codegraph:host] m16 
[codegraph:host] m17 
[codegraph:host] m18 
[codegraph:host] m19 
[codegraph:host] m20 
[codegraph:host] m21 
[codegraph:host] m22 
[codegraph:host] m23 
[codegraph:host] m24 
[codegraph:host] m25 
[codegraph:host] m26 
[codegraph:host] m27 
[codegraph:host] m28 
[codegraph:host] m29 
[codegraph:host] m30 
[codegraph:host] m31 
[codegraph:host] m32 
[codegraph:host] m33 
[codegraph:host] m34 
[codegraph:host] m35 
[codegraph:host] m36 
[codegraph:host] m37 
[codegraph:host] m38 
[codegraph:host] m39 
[codegraph:host] m40 
[codegraph:host] m41 
[codegraph:host] m42 
[codegraph:host] m43 
[codegraph:host] m44 
[codegraph:host] m45 
[codegraph:host] m46 
[codegraph:host] m47 
[codegraph:host] m48 
[codegraph:host] m49 
[codegraph:host] m50 
[codegraph:host] m51 
[codegraph:host] m52 
[codegraph:host] m53 
[codegraph:host] m54 
[codegraph:host] m55 
[codegraph:host] m56 
[codegraph:host] m57 
[codegraph:host] m58 
[codegraph:host] m59 
[codegraph:host] m60 
[codegraph:host] m61 
[codegraph:host] m62 
[codegraph:host] m63 
[codegraph:host] m64 
[codegraph:host] m65 
[codegraph:host] m66 
[codegraph:host] m67 
[codegraph:host] m68 
[codegraph:host] m69 
[codegraph:host] m70 
[codegraph:host] m71 
[codegraph:host] m72 
[codegraph:host] m73 
[codegraph:host] m74 
[codegraph:host] m75 
[codegraph:host] m76 
[codegraph:host] m77 
[codegraph:host] m78 
[codegraph:host] m79 
[codegraph:host] m80 
[codegraph:host] m81 
[codegraph:host] m82 
[codegraph:host] m83 
[codegraph:host] m84 
[codegraph:host] m85 
[codegraph:host] m86 
[codegraph:host] m87 
[codegraph:host] m88 
[codegraph:host] m89 
[codegraph:host] m90 
[codegraph:host] m91 
[codegraph:host] m92 
[codegraph:host] m93 
[codegraph:host] m94 
[codegraph:host] m95 
[codegraph:host] m96 
[codegraph:host] m97 
[codegraph:host] m98 
[codegraph:host] m99 
[codegraph:host] m100 
[codegraph:host] m101 
[codegraph:host] m102 
[codegraph:host] m103 
[codegraph:host] m104 
[codegraph:host] m105 
[codegraph:host] m106 
[codegraph:host] m107 
[codegraph:host] m108 
[codegraph:host] m109 
[codegraph:host] m110 
[codegraph:host] m111 
[codegraph:host] m112 
[codegraph:host] m113 
[codegraph:host] m114 
[codegraph:host] m115 
[codegraph:host] m116 
[codegraph:host] m117 
[codegraph:host] m118 
[codegraph:host] m119 
[codegraph:host] m120 
[codegraph:host] m121 
[codegraph:host] m122 
[codegraph:host] m123 
[codegraph:host] m124 
[codegraph:host] m125 
[codegraph:host] m126 
[codegraph:host] m127 
[codegraph:host] m128 
[codegraph:host] m129 
[codegraph:host] m130 
[codegraph:host] m131 
[codegraph:host] m132 
[codegraph:host] m133 
[codegraph:host] m134 
[codegraph:host] m135 
[codegraph:host] m136 
[codegraph:host] m137 
[codegraph:host] m138 
[codegraph:host] m139 
[codegraph:host] m140 
[codegraph:host] m141 
[codegraph:host] m142 
[codegraph:host] m143 
[codegraph:host] m144 
[codegraph:host] m145 
[codegraph:host] m146 
[codegraph:host] m147 
[codegraph:host] m148 
[codegraph:host] m149 
[codegraph:host] m150 
[codegraph:host] m151 
[codegraph:host] m152 
[codegraph:host] m153 
[codegraph:host] m154 
[codegraph:host] m155 
[codegraph:host] m156 
[codegraph:host] m157 
[codegraph:host] m158 
[codegraph:host] m159 
[codegraph:host] m160 
[codegraph:host] m161 
[codegraph:host] m162 
[codegraph:host] m163 
[codegraph:host] m164 
[codegraph:host] m165 
[codegraph:host] m166 
[codegraph:host] m167 
[codegraph:host] m168 
[codegraph:host] m169 
[codegraph:host] m170 
[codegraph:host] m171 
[codegraph:host] m172 
[codegraph:host] m173 
[codegraph:host] m174 
[codegraph:host] m175 
[codegraph:host] m176 
[codegraph:host] m177 
[codegraph:host] m178 
[codegraph:host] m179 
[codegraph:host] m180 
[codegraph:host] m181 
[codegraph:host] m182 
[codegraph:host] m183 
[codegraph:host] m184 
[codegraph:host] m185 
[codegraph:host] m186 
[codegraph:host] m187 
[codegraph:host] m188 
[codegraph:host] m189 
[codegraph:host] m190 
[codegraph:host] m191 
[codegraph:host] m192 
[codegraph:host] m193 
[codegraph:host] m194 
[codegraph:host] m195 
[codegraph:host] m196 
[codegraph:host] m197 
[codegraph:host] m198 
[codegraph:host] m199 
[codegraph:host] m200 
[codegraph:host] m201 
[codegraph:host] m202 
[codegraph:host] m203 
[codegraph:host] m204 
[codegraph:host] m205 
[codegraph:host] m206 
[codegraph:host] m207 
[codegraph:host] m208 
[codegraph:host] m209 
[codegraph:host] m210 
[codegraph:host] m211 
[codegraph:host] m212 
[codegraph:host] m213 
[codegraph:host] m214 
[codegraph:host] m215 
[codegraph:host] m216 
[codegraph:host] m217 
[codegraph:host] m218 
[codegraph:host] m219 
[codegraph:host] m220 
[codegraph:host] m221 
[codegraph:host] m222 
[codegraph:host] m223 
[codegraph:host] m224 
[codegraph:host] m225 
[codegraph:host] m226 
[codegraph:host] m227 
[codegraph:host] m228 
[codegraph:host] m229 
[codegraph:host] m230 
[codegraph:host] m231 
[codegraph:host] m232 
[codegraph:host] m233 
[codegraph:host] m234 
[codegraph:host] m235 
[codegraph:host] m236 
[codegraph:host] m237 
[codegraph:host] m238 
[codegraph:host] m239 
[codegraph:host] m240 
[codegraph:host] m241 
[codegraph:host] m242 
[codegraph:host] m243 
[codegraph:host] m244 
[codegraph:host] m245 
[codegraph:host] m246 
[codegraph:host] m247 
[codegraph:host] m248 
[codegraph:host] m249 

stdout | tests/unit/logger.test.ts > Logger (log management) > should notify subscribers with a snapshot
[codegraph:host] ping 
[codegraph:host] after-dispose 

stdout | tests/unit/logger.test.ts > Logger (log management) > clear() should empty the buffer and notify
[codegraph:host] x 

stdout | tests/unit/logger.test.ts > scoped logger factory > should create a scoped logger with all levels
[codegraph:test] dbg-msg 
[codegraph:test] info-msg 

stdout | tests/unit/logger.test.ts > scoped logger factory > should pass data through scoped logger
[codegraph:data-test] with-data { key: 'value' }

 ✓ tests/unit/logger.test.ts (8 tests) 27ms
 ✓ tests/unit/RuleEngine.test.ts (30 tests) 24ms
 ✓ tests/unit/CFGAssembler.test.ts (11 tests) 16ms
 ✓ tests/unit/HotspotAnalyzer.test.ts (15 tests) 17ms
 ✓ tests/unit/validators.test.ts (35 tests) 16ms
 ✓ tests/unit/CoreFunctionAnalyzer.test.ts (14 tests) 16ms
 ✓ tests/unit/graphStore.test.ts (48 tests) 43ms
 ✓ tests/unit/InheritanceAssembler.test.ts (10 tests) 14ms
 ✓ tests/unit/SequenceAssembler.test.ts (12 tests) 16ms
 ✓ tests/unit/toolsPure.test.ts (17 tests) 15ms
 ✓ tests/unit/PackageAssembler.test.ts (10 tests) 16ms
 ✓ tests/unit/DependencyAssembler.test.ts (17 tests) 16ms
 ✓ tests/unit/FlowchartAssembler.test.ts (10 tests) 15ms
 ✓ tests/unit/ClassAssembler.test.ts (11 tests) 15ms
 ✓ tests/unit/historyAndCache.test.ts (19 tests) 15ms
 ✓ tests/unit/CallGraphAssembler.test.ts (10 tests) 17ms
 ✓ tests/unit/clusterTypes.test.ts (12 tests) 13ms
 ✓ tests/unit/DiagramCache.test.ts (20 tests) 13ms
 ✓ tests/unit/viewModeTransition.test.ts (8 tests) 13ms
 ✓ tests/unit/i18n.test.ts (24 tests) 13ms
 ✓ tests/unit/SpatialIndex.test.ts (12 tests) 12ms
 ✓ tests/unit/clusterIndex.test.ts (6 tests) 10ms
 ✓ tests/unit/deriveName.test.ts (10 tests) 7ms
 ✓ tests/unit/pathSecurity.test.ts (7 tests) 7ms
 ✓ tests/unit/microDiagramChaos.test.ts (15 tests) 20ms
 ✓ tests/component/StatusBar.test.tsx (9 tests) 107ms
 ✓ tests/component/SequenceDiagramRenderer.test.tsx (14 tests) 366ms
 ✓ tests/component/SearchBar.test.tsx (9 tests) 435ms
 ✓ tests/component/FocusModeBar.test.tsx (6 tests) 542ms
   ✓ FocusModeBar (FR-26) component > calls onExpand, onContract, onExit when respective buttons clicked  416ms
 ✓ tests/component/HealthScoreCard.test.tsx (6 tests) 582ms
   ✓ HealthScoreCard (FR-32) component > calls onClose when close button is clicked  374ms
 ✓ tests/component/RuleConfigPanel.test.tsx (4 tests) 706ms
   ✓ RuleConfigPanel (FR-34) component > renders preset rules with checkbox state and counts violations by severity  508ms
 ✓ tests/component/PathBar.test.tsx (5 tests) 929ms
   ✓ PathBar (FR-25) component > shows suggestions matching the start query  413ms

 Test Files  54 passed (54)
      Tests  1092 passed (1092)
   Start at  20:19:16
   Duration  13.30s (transform 6.20s, setup 0ms, collect 23.49s, tests 12.30s, environment 30.94s, prepare 23.56s) |
| E4 | 代码质量 | PASS | > dsh-codegraph-visualizer@0.2.0 lint
> oxlint src/

src/client/hooks/useAnalysisPanels.ts:36:9: warning eslint(no-unused-vars): Variable 'healthScore' is declared but never used. Unused variables should start with a '_'. help: Consider removing this declaration. |
| E6 | 安全检查 | PASS | No security issues detected |

## 总结

- 通过: 3/3
- 失败: 0
