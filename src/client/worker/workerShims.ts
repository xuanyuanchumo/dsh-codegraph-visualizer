/**
 * The layout worker's CommonJS feature-test stub.
 *
 * `graphlib` and `dagre` ship vendored shims that try a real CommonJS require and then fall back
 * to a *browser global* — a global a Worker does not have:
 *
 *   // graphlib/lib/lodash.js            // dagre/lib/graphlib.js
 *   var lodash;                          var graphlib;
 *   if (typeof require === 'function') { if (typeof require === 'function') {
 *     try { lodash = { ...req... }; }      try { graphlib = require('graphlib'); }
 *     catch (e) {}                         catch (e) {}
 *   }                                    }
 *   if (!lodash) lodash = window._;      if (!graphlib) graphlib = window.graphlib;
 *
 * The bundler rewrites every real `require('...')` into a direct bundled call and wraps CommonJS
 * modules as `(exports, module)` — with no `require` parameter — so inside the emitted worker
 * bundle `typeof require === 'function'` is **false** and all three shims take the browser-global
 * branch. That is what killed the worker at module scope in J0:
 *
 *   Uncaught ReferenceError: window is not defined
 *   at layoutWorker.js:34740  ->  if (!graphlib) graphlib = window.graphlib;
 *   (the first failure at `lodash = window._` is swallowed by dagre's catch and resurfaces here)
 *
 * Defining a `require` function flips only that feature test, so the shims take the branch they
 * were always meant to take and read the *bundled* modules instead of a global. Nothing is
 * actually resolved through this stub: the one string-form call left in the bundle is lodash's
 * `require('util')`, which is additionally guarded by `module.require` and wrapped in try/catch.
 *
 * Two deliberate constraints:
 *   - This module must be imported *before* cytoscape/dagre/fcose; the shims read the feature test
 *     lazily, but module evaluation order is the only thing that makes the ordering obvious.
 *   - It must not fake a `window`. The other ~40 `window` reads in the bundle are
 *     `typeof window === 'undefined'` guarded or null-safe (`_window && ...`), and installing a
 *     window would change lodash's environment detection instead of just the require branch.
 */
const globalScope = globalThis as { require?: unknown };

if (typeof globalScope.require !== 'function') {
  globalScope.require = function requireUnavailable(id: string): never {
    throw new Error(`require(${id}) is not available in the layout worker bundle`);
  };
}

export {};
