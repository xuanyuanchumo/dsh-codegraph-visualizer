import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import cytoscape, { type Core } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import dagre from 'cytoscape-dagre';
import { LayoutController } from '../../src/client/renderer/LayoutController.ts';
import type { LayoutType } from '../../src/shared/viewModeUtils.ts';

/**
 * Round 9 regression: the incremental layout used to hand Cytoscape a collection of *new* nodes
 * only. The built-in `cose` layout (the default) indexes every node's compound parent inside that
 * collection, so a freshly loaded child of an already-rendered file node made the lookup undefined
 * and threw `Cannot read properties of undefined (reading 'children')`. The throw happened inside a
 * requestAnimationFrame callback, escaping CytoscapeRenderer.safeCallVoid, and surfaced as an
 * uncaught console error — exactly what Round 8's J0 recorded. The old LayoutController tests could
 * not see it: they drive a mocked `cy` whose `layout()` is a stub, so no real layout ever ran.
 *
 * The fix flattens compound membership for the duration of the incremental layout (restoring it
 * right after), so measure the shape the layout actually receives, not just the outcome.
 */

const ROOT = path.resolve(__dirname, '../..');
const LAYOUTS: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
const SPATIAL_LAYOUTS: LayoutType[] = ['cose', 'fcose', 'dagre'];

/** A compound graph shaped like the real one: a file node with children, two of them brand new. */
function createCompoundGraph(): Core {
  const cy = cytoscape({ headless: true, elements: [] as never[] });
  cy.add([
    { group: 'nodes', data: { id: 'file' } },
    { group: 'nodes', data: { id: 'old1', parent: 'file' } },
    { group: 'nodes', data: { id: 'new1', parent: 'file' } },
    { group: 'nodes', data: { id: 'new2', parent: 'file' } },
    { group: 'edges', data: { id: 'e1', source: 'new1', target: 'old1' } },
    { group: 'edges', data: { id: 'e2', source: 'new2', target: 'old1' } },
  ] as never[]);
  return cy;
}

/**
 * Record, per layout creation, how many of the new nodes were still inside a compound.
 * `cy.layout()` builds a core layout (the preset placement), while `eles.layout()` funnels through
 * `cy.makeLayout()`, so both seams have to be watched to see the spatial layout of the new nodes.
 */
function observeLayoutShape(cy: Core, newIds: string[]): Array<{ name: string; parented: number }> {
  const seen: Array<{ name: string; parented: number }> = [];
  const record = (options: { name?: string }): void => {
    seen.push({
      name: String(options?.name),
      parented: newIds.filter((id) => cy.getElementById(id).parent().nonempty()).length,
    });
  };
  const coreLayout = cy.layout.bind(cy);
  const makeLayout = cy.makeLayout.bind(cy);
  vi.spyOn(cy, 'layout').mockImplementation(((options: { name?: string }) => {
    record(options);
    return coreLayout(options as never);
  }) as never);
  vi.spyOn(cy, 'makeLayout').mockImplementation(((options: { name?: string }) => {
    record(options);
    return makeLayout(options as never);
  }) as never);
  return seen;
}

describe('LayoutController incremental layout with compound parents (real cytoscape)', () => {
  beforeEach(() => {
    cytoscape.use(dagre);
    cytoscape.use(fcose);
    // The unit environment is `node`: there is no rAF, and running the callback synchronously turns
    // any layout throw into a failure of the call under test instead of a silent async escape.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(LAYOUTS)('lays out %s without throwing when a new child outlives its compound parent', (layout) => {
    const cy = createCompoundGraph();
    const controller = new LayoutController(cy);
    const calls = observeLayoutShape(cy, ['new1', 'new2']);

    expect(() => controller.applyIncrementalLayout(layout, new Set(['new1', 'new2']))).not.toThrow();

    // The preset placement keeps compound membership, the spatial layout must not see it.
    expect(calls.length).toBe(SPATIAL_LAYOUTS.includes(layout) ? 2 : 1);
    expect(calls[0]).toEqual({ name: 'preset', parented: 2 });
    if (SPATIAL_LAYOUTS.includes(layout)) expect(calls[1]!.parented).toBe(0);

    // Nothing was lost, and the compound structure is back the way it was.
    expect(cy.nodes().length).toBe(4);
    for (const node of cy.nodes()) {
      const position = node.position();
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    expect(cy.getElementById('file').children().map((n) => n.id()).sort()).toEqual(['new1', 'new2', 'old1']);
    expect(cy.getElementById('new1').parent().first().id()).toBe('file');
    expect(cy.getElementById('old1').parent().first().id()).toBe('file');
  });

  it('flattens compound membership for the layout and restores it afterwards', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/client/renderer/LayoutController.ts'), 'utf-8');
    // Ratchet for the fix itself: without the detach, the built-in cose layout throws again.
    expect(source).toMatch(/this\.detachCompoundLinks\(newNodes\)/);
    expect(source).toMatch(/node\.move\(\{ parent: null \}\)/);
    expect(source).toMatch(/this\.restoreCompoundLinks\(detached\)/);
  });

  it('swallows a layout throw inside the requestAnimationFrame callback', () => {
    const cy = createCompoundGraph();
    const controller = new LayoutController(cy);
    const internals = controller as unknown as { runIncrementalLayout: (...args: unknown[]) => void };
    const spy = vi.spyOn(internals, 'runIncrementalLayout').mockImplementation(() => {
      throw new Error('layout exploded');
    });

    expect(() => controller.applyIncrementalLayout('cose', new Set(['new1']))).not.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
    // The failure must not leave the controller stuck on a stale handle: a later call still runs.
    expect(() => controller.applyIncrementalLayout('cose', new Set(['new2']))).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(2);
    // And a swallowed failure leaves the compound structure untouched.
    expect(cy.getElementById('new1').parent().first().id()).toBe('file');
  });
});
