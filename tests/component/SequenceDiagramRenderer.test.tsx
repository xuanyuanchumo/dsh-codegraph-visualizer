/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

import { SequenceDiagramRenderer } from '../../src/client/renderer/SequenceDiagramRenderer.tsx';
import { makeNode, makeEdge } from '../helpers.ts';

function makeParticipantNode(id: string, name: string, type: string, lifelineStart = 0, lifelineEnd = 10) {
  return makeNode(id, name, 'function', '/src/test.ts', 0, {
    participantType: type,
    lifelineStart,
    lifelineEnd,
    isCreated: false,
    isDestroyed: false,
  });
}

function makeFragmentNode(id: string, fragType: string, startMsg: number, endMsg: number, condition?: string) {
  return makeNode(id, `${fragType}${condition ? ` [${condition}]` : ''}`, 'type', '/src/test.ts', 0, {
    isFragment: true,
    fragmentType: fragType,
    startMessage: startMsg,
    endMessage: endMsg,
    operands: [{ startMessage: startMsg, endMessage: endMsg }],
    ...(condition ? { condition } : {}),
  });
}

function makeMessageEdge(id: string, source: string, target: string, seqNum: number, methodName: string, extra: Record<string, unknown> = {}) {
  return makeEdge(id, source, target, 'call', {
    sequenceNumber: seqNum,
    methodName,
    arguments: [],
    isAsync: false,
    isSelfCall: false,
    isReturn: false,
    isCreate: false,
    lineNumber: 1,
    ...extra,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SequenceDiagramRenderer component', () => {
  it('renders empty state when no participants', () => {
    const { container } = render(
      <SequenceDiagramRenderer nodes={[]} edges={[]} theme="dark" onNodeTap={vi.fn()} />
    );
    expect(container.querySelector('.seq-empty-state')).toBeTruthy();
  });

  it('renders participant boxes when participants exist', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'db', 'instance'),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={[]} theme="light" />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const participantGroups = container.querySelectorAll('.seq-participant-group');
    expect(participantGroups.length).toBe(2);
  });

  it('renders messages between participants', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'db', 'instance'),
    ];
    const edges = [
      makeMessageEdge('m1', 'p1', 'p2', 0, 'query'),
      makeMessageEdge('m2', 'p2', 'p1', 1, 'result', { isReturn: true }),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="dark" />
    );
    const messageGroups = container.querySelectorAll('.seq-message-group');
    expect(messageGroups.length).toBe(2);
  });

  it('renders self-call messages as loops', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
    ];
    const edges = [
      makeMessageEdge('m1', 'p1', 'p1', 0, 'internalCall', { isSelfCall: true }),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="light" />
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it('renders combined fragments', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'db', 'instance'),
      makeFragmentNode('f1', 'alt', 0, 0, 'x > 0'),
    ];
    const edges = [
      makeMessageEdge('m1', 'p1', 'p2', 0, 'save'),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="dark" />
    );
    const fragmentGroups = container.querySelectorAll('.seq-fragment-group');
    expect(fragmentGroups.length).toBe(1);
  });

  it('renders destroy marker (X) for destroyed participants', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'temp', 'instance', 0, 0),
    ];
    nodes[1]!.properties['isDestroyed'] = true;
    const edges = [
      makeMessageEdge('m1', 'p1', 'p2', 0, 'create', { isCreate: true }),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="light" />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders zoom controls', () => {
    const nodes = [makeParticipantNode('p1', 'myFunc', 'self')];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={[]} theme="dark" />
    );
    const zoomControls = container.querySelector('.seq-zoom-controls');
    expect(zoomControls).toBeTruthy();
    const buttons = container.querySelectorAll('.seq-zoom-btn');
    expect(buttons.length).toBe(3);
  });

  it('renders zoom indicator', () => {
    const nodes = [makeParticipantNode('p1', 'myFunc', 'self')];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={[]} theme="light" />
    );
    const indicator = container.querySelector('.seq-zoom-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toContain('100');
  });

  it('calls onNodeTap when participant is clicked', () => {
    const onNodeTap = vi.fn();
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'db', 'instance'),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={[]} theme="dark" onNodeTap={onNodeTap} />
    );
    const participantGroups = container.querySelectorAll('.seq-participant-group');
    fireEvent.click(participantGroups[0]!);
    expect(onNodeTap).toHaveBeenCalledWith('p1');
  });

  it('highlights message on hover', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'db', 'instance'),
    ];
    const edges = [makeMessageEdge('m1', 'p1', 'p2', 0, 'query')];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="light" />
    );
    const messageGroups = container.querySelectorAll('.seq-message-group');
    expect(messageGroups.length).toBe(1);
    fireEvent.mouseEnter(messageGroups[0]!);
    const lines = container.querySelectorAll('.seq-message-line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('renders async message with open arrow head', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'api', 'external'),
    ];
    const edges = [
      makeMessageEdge('m1', 'p1', 'p2', 0, 'fetch', { isAsync: true }),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="dark" />
    );
    const polygons = container.querySelectorAll('polygon');
    expect(polygons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders create marker (new) for created participants', () => {
    const nodes = [
      makeParticipantNode('p1', 'factory', 'self'),
      makeParticipantNode('p2', 'obj', 'instance'),
    ];
    nodes[1]!.properties['isCreated'] = true;
    const edges = [
      makeMessageEdge('m1', 'p1', 'p2', 0, 'create', { isCreate: true }),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="light" />
    );
    const texts = container.querySelectorAll('text');
    const newText = Array.from(texts).find((t) => t.textContent === 'new');
    expect(newText).toBeTruthy();
  });

  it('handles theme switching between light and dark', () => {
    const nodes = [makeParticipantNode('p1', 'myFunc', 'self')];
    const { container: lightContainer } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={[]} theme="light" />
    );
    const lightBg = lightContainer.querySelector('.sequence-diagram-container');
    expect(lightBg).toBeTruthy();
    cleanup();

    const { container: darkContainer } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={[]} theme="dark" />
    );
    const darkBg = darkContainer.querySelector('.sequence-diagram-container');
    expect(darkBg).toBeTruthy();
  });

  it('renders activation bars', () => {
    const nodes = [
      makeParticipantNode('p1', 'myFunc', 'self'),
      makeParticipantNode('p2', 'db', 'instance'),
    ];
    const edges = [
      makeMessageEdge('m1', 'p1', 'p2', 0, 'query'),
      makeMessageEdge('m2', 'p2', 'p1', 1, 'result', { isReturn: true }),
    ];
    const { container } = render(
      <SequenceDiagramRenderer nodes={nodes} edges={edges} theme="dark" />
    );
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(2);
  });
});