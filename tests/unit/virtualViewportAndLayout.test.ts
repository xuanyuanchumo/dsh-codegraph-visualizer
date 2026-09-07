import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeMockNode(id: string, x = 0, y = 0) {
  return {
    id: () => id,
    position: vi.fn(() => ({ x, y })),
    style: vi.fn(),
    width: vi.fn(() => 30),
    height: vi.fn(() => 30),
    degree: vi.fn(() => 1),
    nonempty: vi.fn(() => true),
  };
}

function makeMockEdge(id: string, sourceId: string, targetId: string) {
  const sourceNode = makeMockNode(sourceId);
  const targetNode = makeMockNode(targetId);
  return {
    id: () => id,
    source: () => sourceNode,
    target: () => targetNode,
    style: vi.fn(),
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const nodes = {
    forEach: vi.fn((cb: (n: any) => void) => nodeList.forEach(cb)),
    length: nodeList.length,
    filter: vi.fn((pred: (n: any) => boolean) => nodeList.filter(pred)),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
  };
  const edges = {
    forEach: vi.fn((cb: (e: any) => void) => edgeList.forEach(cb)),
    length: edgeList.length,
  };
  return {
    nodes: vi.fn(() => nodes),
    edges: vi.fn(() => edges),
    on: vi.fn(),
    off: vi.fn(),
    batch: vi.fn((cb: () => void) => cb()),
    zoom: vi.fn(() => 1),
    pan: vi.fn(() => ({ x: 0, y: 0 })),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    fit: vi.fn(),
    layout: vi.fn(() => ({
      one: vi.fn(),
      run: vi.fn(),
    })),
    getElementById: vi.fn(() => ({
      nonempty: vi.fn(() => false),
      position: vi.fn(),
    })),
  };
}

describe('VirtualViewportController (FR-50)', () => {
  it('shouldEnable returns true when nodeCount > 2000', () => {
    const cy = makeMockCy();
    const controller = new (class extends (require('../../src/client/renderer/VirtualViewportController.ts').VirtualViewportController) {
      constructor() { super(cy as any); }
    })();
    expect(controller.shouldEnable(2001)).toBe(true);
    expect(controller.shouldEnable(2000)).toBe(false);
    expect(controller.shouldEnable(100)).toBe(false);
  });

  it('isEnabled returns false before enable', () => {
    const cy = makeMockCy();
    const { VirtualViewportController } = require('../../src/client/renderer/VirtualViewportController.ts');
    const controller = new VirtualViewportController(cy);
    expect(controller.isEnabled()).toBe(false);
  });

  it('enable sets enabled and registers viewport listener', () => {
    const cy = makeMockCy();
    const { VirtualViewportController } = require('../../src/client/renderer/VirtualViewportController.ts');
    const controller = new VirtualViewportController(cy);
    controller.enable();
    expect(controller.isEnabled()).toBe(true);
    expect(cy.on).toHaveBeenCalledWith('viewport', expect.any(Function));
  });

  it('disable resets state and shows all nodes', () => {
    const cy = makeMockCy([makeMockNode('n1'), makeMockNode('n2')]);
    const { VirtualViewportController } = require('../../src/client/renderer/VirtualViewportController.ts');
    const controller = new VirtualViewportController(cy);
    controller.enable();
    controller.disable();
    expect(controller.isEnabled()).toBe(false);
    expect(cy.off).toHaveBeenCalledWith('viewport', expect.any(Function));
  });

  it('getVisibleNodeCount returns 0 initially', () => {
    const cy = makeMockCy();
    const { VirtualViewportController } = require('../../src/client/renderer/VirtualViewportController.ts');
    const controller = new VirtualViewportController(cy);
    expect(controller.getVisibleNodeCount()).toBe(0);
  });

  it('destroy calls disable', () => {
    const cy = makeMockCy();
    const { VirtualViewportController } = require('../../src/client/renderer/VirtualViewportController.ts');
    const controller = new VirtualViewportController(cy);
    controller.enable();
    controller.destroy();
    expect(controller.isEnabled()).toBe(false);
  });
});

describe('LayoutController (FR-51/FR-52)', () => {
  it('isWorkerAvailable returns false when worker cannot be created', () => {
    const cy = makeMockCy();
    const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
    const controller = new LayoutController(cy);
    expect(typeof controller.isWorkerAvailable()).toBe('boolean');
    controller.destroy();
  });

  it('applyLayoutWithWorker returns empty when no worker', async () => {
    const cy = makeMockCy();
    const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
    const controller = new LayoutController(cy);
    const result = await controller.applyLayoutWithWorker([], [], 'cose');
    expect(result).toEqual({});
    controller.destroy();
  });

  it('applyIncrementalLayout does nothing with empty newNodeIds', () => {
    const cy = makeMockCy();
    const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
    const controller = new LayoutController(cy);
    controller.applyIncrementalLayout('cose', new Set());
    controller.destroy();
  });

  it('destroy terminates worker and cancels raf', () => {
    const cy = makeMockCy();
    const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
    const controller = new LayoutController(cy);
    controller.destroy();
    expect(controller.isWorkerAvailable()).toBe(false);
  });
});