import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ThemeType } from './IRenderer.ts';
import { getThemeColors, readCssVarCached } from './styles/ThemeStylesheet.ts';
import { useT } from '../i18n/index.ts';
import { COLORS } from '../../shared/constants.ts';

interface SequenceDiagramRendererProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  theme: ThemeType;
  onNodeTap?: (nodeId: string) => void;
}

interface ParticipantInfo {
  id: string;
  name: string;
  type: string;
  className?: string | undefined;
  lifelineStart: number;
  lifelineEnd: number;
  isCreated: boolean;
  isDestroyed: boolean;
  x: number;
}

interface MessageInfo {
  id: string;
  sequenceNumber: number;
  source: string;
  target: string;
  methodName: string;
  arguments: string[];
  isAsync: boolean;
  isSelfCall: boolean;
  isReturn: boolean;
  isCreate: boolean;
  lineNumber: number;
  y: number;
}

interface FragmentInfo {
  id: string;
  type: string;
  condition?: string | undefined;
  loopConstraint?: string | undefined;
  startMessage: number;
  endMessage: number;
  operands: Array<{ guardCondition?: string | undefined; startMessage: number; endMessage: number }>;
}

const LAYOUT = {
  PARTICIPANT_BOX_WIDTH: 140,
  PARTICIPANT_BOX_HEIGHT: 36,
  PARTICIPANT_GAP: 40,
  LIFELINE_TOP_OFFSET: 50,
  MESSAGE_HEIGHT: 44,
  MESSAGE_LABEL_HEIGHT: 16,
  ACTIVATION_WIDTH: 10,
  ARROW_HEAD_SIZE: 8,
  SELF_CALL_WIDTH: 30,
  SELF_CALL_HEIGHT: 24,
  FRAGMENT_LABEL_HEIGHT: 22,
  FRAGMENT_PADDING: 8,
  SVG_PADDING_X: 20,
  SVG_PADDING_TOP: 10,
  MIN_LIFELINE_EXTENSION: 40,
};

function extractParticipants(nodes: GraphNode[]): ParticipantInfo[] {
  return nodes
    .filter((n) => n.properties['participantType'] && !n.properties['isFragment'])
    .map((n) => ({
      id: n.id,
      name: n.label,
      type: (n.properties['participantType'] as string) ?? 'instance',
      className: n.properties['className'] as string | undefined,
      lifelineStart: (n.properties['lifelineStart'] as number) ?? 0,
      lifelineEnd: (n.properties['lifelineEnd'] as number) ?? 0,
      isCreated: (n.properties['isCreated'] as boolean) ?? false,
      isDestroyed: (n.properties['isDestroyed'] as boolean) ?? false,
      x: 0,
    }))
    .sort((a, b) => a.lifelineStart - b.lifelineStart);
}

function extractMessages(edges: GraphEdge[]): MessageInfo[] {
  return edges
    .filter((e) => e.properties['sequenceNumber'] !== undefined)
    .map((e) => ({
      id: e.id,
      sequenceNumber: (e.properties['sequenceNumber'] as number) ?? 0,
      source: e.source,
      target: e.target,
      methodName: (e.properties['methodName'] as string) ?? '',
      arguments: (e.properties['arguments'] as string[]) ?? [],
      isAsync: (e.properties['isAsync'] as boolean) ?? false,
      isSelfCall: (e.properties['isSelfCall'] as boolean) ?? false,
      isReturn: (e.properties['isReturn'] as boolean) ?? false,
      isCreate: (e.properties['isCreate'] as boolean) ?? false,
      lineNumber: (e.properties['lineNumber'] as number) ?? 0,
      y: 0,
    }))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

function extractFragments(nodes: GraphNode[]): FragmentInfo[] {
  return nodes
    .filter((n) => n.properties['isFragment'])
    .map((n) => ({
      id: n.id,
      type: (n.properties['fragmentType'] as string) ?? 'alt',
      condition: n.properties['condition'] as string | undefined,
      loopConstraint: n.properties['loopConstraint'] as string | undefined,
      startMessage: (n.properties['startMessage'] as number) ?? 0,
      endMessage: (n.properties['endMessage'] as number) ?? 0,
      operands: (n.properties['operands'] as Array<{ guardCondition?: string; startMessage: number; endMessage: number }>) ?? [],
    }));
}

function getParticipantColor(type: string, isDark: boolean): string {
  const tc = getThemeColors(isDark ? 'dark' : 'light');
  switch (type) {
    case 'class': return tc.nodeClass;
    case 'module': return tc.nodeModule;
    case 'external': return tc.edgeDependency;
    case 'instance': return tc.nodeFunction;
    case 'callback': return tc.edgeCall;
    case 'self': return tc.nodeType;
    default: return tc.nodeDefault;
  }
}

function formatArguments(args: string[]): string {
  if (!args || args.length === 0) return '';
  if (args.length <= 2) return `(${args.join(', ')})`;
  return `(${args.slice(0, 2).join(', ')}, +${args.length - 2})`;
}

function truncateLabel(text: string, maxWidth: number): string {
  const charWidth = 7;
  const maxChars = Math.floor(maxWidth / charWidth);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

export const SequenceDiagramRenderer: React.FC<SequenceDiagramRendererProps> = ({
  nodes,
  edges,
  theme,
  onNodeTap,
}) => {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredParticipant, setHoveredParticipant] = useState<string | null>(null);
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const pinchStartDistanceRef = useRef(0);
  const pinchStartZoomRef = useRef(1);

  const isDark = theme === 'dark';

  const colors = useMemo(() => {
    const tc = getThemeColors(theme);
    return {
      bg: readCssVarCached('--cg-surface', isDark ? COLORS.PACKAGE_DARK : '#f9fafb'),
      text: tc.text,
      textSecondary: readCssVarCached('--cg-text-secondary', isDark ? '#cfd3d6' : '#61666b'),
      lifeline: readCssVarCached('--cg-border-strong', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
      lifelineDashed: readCssVarCached('--cg-border', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'),
      activation: tc.edgeCall,
      activationBorder: readCssVarCached('--cg-accent', isDark ? '#6366f1' : COLORS.PACKAGE_LIGHT),
      syncArrow: tc.text,
      asyncArrow: tc.edgeImport,
      returnArrow: tc.edgeExtend,
      selfCallArrow: tc.nodeType,
      createArrow: tc.edgeCall,
      fragmentBg: readCssVarCached('--cg-accent-soft', isDark ? 'rgba(99,102,241,0.12)' : 'rgba(38,49,72,0.1)'),
      fragmentBorder: readCssVarCached('--cg-accent-hover', isDark ? '#5457e5' : '#1a2230'),
      fragmentLabelBg: readCssVarCached('--cg-surface-active', isDark ? '#333335' : '#e5e7eb'),
      participantBg: readCssVarCached('--cg-surface-hover', isDark ? '#2a2a2c' : '#f3f4f6'),
      participantBorder: readCssVarCached('--cg-border-strong', isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'),
      gridLine: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      highlightBg: readCssVarCached('--cg-accent-soft', isDark ? 'rgba(99,102,241,0.12)' : 'rgba(38,49,72,0.1)'),
    };
  }, [isDark, theme]);

  const { participants, messages, fragments, dimensions } = useMemo(() => {
    const rawParticipants = extractParticipants(nodes);
    const rawMessages = extractMessages(edges);
    const rawFragments = extractFragments(nodes);

    const participantCount = rawParticipants.length;
    const participantSpacing = LAYOUT.PARTICIPANT_BOX_WIDTH + LAYOUT.PARTICIPANT_GAP;
    const totalWidth = participantCount * LAYOUT.PARTICIPANT_BOX_WIDTH + (participantCount - 1) * LAYOUT.PARTICIPANT_GAP + LAYOUT.SVG_PADDING_X * 2;

    const participantsWithX = rawParticipants.map((p, i) => ({
      ...p,
      x: LAYOUT.SVG_PADDING_X + i * participantSpacing + LAYOUT.PARTICIPANT_BOX_WIDTH / 2,
    }));

    const lifelineTop = LAYOUT.SVG_PADDING_TOP + LAYOUT.LIFELINE_TOP_OFFSET;
    const messagesWithY = rawMessages.map((m, i) => ({
      ...m,
      y: lifelineTop + i * LAYOUT.MESSAGE_HEIGHT + LAYOUT.MESSAGE_LABEL_HEIGHT,
    }));

    const lastMessageY = messagesWithY.length > 0
      ? messagesWithY[messagesWithY.length - 1]!.y
      : lifelineTop;
    const lifelineBottom = lastMessageY + LAYOUT.MIN_LIFELINE_EXTENSION;

    const fragmentBottomExtra = rawFragments.length > 0 ? LAYOUT.FRAGMENT_LABEL_HEIGHT * 2 : 0;
    const totalHeight = lifelineBottom + LAYOUT.MIN_LIFELINE_EXTENSION + fragmentBottomExtra;

    return {
      participants: participantsWithX,
      messages: messagesWithY,
      fragments: rawFragments,
      dimensions: { width: totalWidth, height: totalHeight, lifelineTop, lifelineBottom },
    };
  }, [nodes, edges]);

  const participantMap = useMemo(() => {
    const map = new Map<string, ParticipantInfo>();
    for (const p of participants) map.set(p.id, p);
    return map;
  }, [participants]);

  const messageYBySeq = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of messages) map.set(m.sequenceNumber, m.y);
    return map;
  }, [messages]);

  const activations = useMemo(() => {
    const result: Array<{ participantId: string; startY: number; endY: number }> = [];
    const activeStacks = new Map<string, number[]>();
    for (const msg of messages) {
      if (!msg.isReturn && !msg.isCreate) {
        const stack = activeStacks.get(msg.target) ?? [];
        stack.push(msg.y);
        activeStacks.set(msg.target, stack);
      }
      if (msg.isReturn) {
        const stack = activeStacks.get(msg.source);
        if (stack && stack.length > 0) {
          const startY = stack.pop()!;
          result.push({ participantId: msg.source, startY, endY: msg.y });
          activeStacks.set(msg.source, stack);
        }
      }
    }
    for (const [participantId, stack] of activeStacks) {
      for (const startY of stack) {
        result.push({ participantId, startY, endY: dimensions.lifelineBottom });
      }
    }
    return result;
  }, [messages, dimensions.lifelineBottom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, panX: pan.x, panY: pan.y };
    } else if (e.touches.length === 2) {
      isDraggingRef.current = false;
      const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
      const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
      pinchStartDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartZoomRef.current = zoom;
    }
  }, [pan, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDraggingRef.current) {
      const dx = e.touches[0]!.clientX - dragStartRef.current.x;
      const dy = e.touches[0]!.clientY - dragStartRef.current.y;
      setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
    } else if (e.touches.length === 2 && pinchStartDistanceRef.current > 0) {
      const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
      const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchStartDistanceRef.current;
      setZoom(Math.max(0.3, Math.min(3, pinchStartZoomRef.current * scale)));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    pinchStartDistanceRef.current = 0;
  }, []);

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleParticipantClick = useCallback((participantId: string) => {
    onNodeTap?.(participantId);
  }, [onNodeTap]);

  const handleMessageClick = useCallback((messageId: string) => {
    setSelectedMessage((prev) => prev === messageId ? null : messageId);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleNativeWheel = (e: WheelEvent) => { e.preventDefault(); };
    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, []);

  useEffect(() => {
    setSelectedMessage(null);
  }, [nodes, edges]);

  if (participants.length === 0) {
    return (
      <div ref={containerRef} className="cg-sequence-diagram-container" style={{ background: colors.bg }}>
        <div className="cg-seq-empty-state">
          {t('sequence.noData')}
        </div>
      </div>
    );
  }

  const svgWidth = dimensions.width;
  const svgHeight = dimensions.height;

  return (
    <div
      ref={containerRef}
      className="cg-sequence-diagram-container"
      role="application"
      aria-label={t('sequence.ariaLabel', { participants: participants.length, messages: messages.length })}
      style={{
        background: colors.bg,
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        style={{
          position: 'absolute',
          top: `${pan.y}px`,
          left: `${pan.x}px`,
          transformOrigin: '0 0',
          transform: `scale(${zoom})`,
        }}
      >
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          style={{ display: 'block' }}
        >
          {messages.map((m) => (
            <line
              key={`grid-${m.id}`}
              x1={0}
              y1={m.y}
              x2={svgWidth}
              y2={m.y}
              stroke={colors.gridLine}
              strokeWidth={1}
            />
          ))}

          {fragments.map((frag) => {
            const startY = messageYBySeq.get(frag.startMessage);
            const endY = messageYBySeq.get(frag.endMessage);
            if (startY === undefined || endY === undefined) return null;

            const fragTop = startY - LAYOUT.MESSAGE_LABEL_HEIGHT - LAYOUT.FRAGMENT_PADDING;
            const fragBottom = endY + LAYOUT.MESSAGE_LABEL_HEIGHT + LAYOUT.FRAGMENT_PADDING;
            const fragHeight = fragBottom - fragTop;
            const fragWidth = svgWidth - LAYOUT.SVG_PADDING_X * 2;
            const fragX = LAYOUT.SVG_PADDING_X;

            const label = frag.type === 'loop'
              ? `loop${frag.loopConstraint ? ` [${frag.loopConstraint}]` : ''}`
              : `${frag.type}${frag.condition ? ` [${frag.condition}]` : ''}`;

            return (
              <g key={`frag-${frag.id}`} className="cg-seq-fragment-group">
                <rect
                  x={fragX}
                  y={fragTop}
                  width={fragWidth}
                  height={fragHeight}
                  fill={colors.fragmentBg}
                  stroke={colors.fragmentBorder}
                  strokeWidth={1.5}
                  rx={2}
                />
                <rect
                  x={fragX}
                  y={fragTop}
                  width={Math.max(label.length * 7 + 16, 50)}
                  height={LAYOUT.FRAGMENT_LABEL_HEIGHT}
                  fill={colors.fragmentLabelBg}
                  stroke={colors.fragmentBorder}
                  strokeWidth={1}
                  rx={2}
                />
                <text
                  x={fragX + 8}
                  y={fragTop + 14}
                  fill={colors.text}
                  fontSize={11}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {label}
                </text>
                {frag.operands.length > 1 && frag.operands.slice(1).map((op, idx) => {
                  const opY = messageYBySeq.get(op.startMessage);
                  if (opY === undefined) return null;
                  return (
                    <g key={`frag-${frag.id}-op-${idx}`}>
                      <line
                        x1={fragX}
                        y1={opY - LAYOUT.MESSAGE_LABEL_HEIGHT - LAYOUT.FRAGMENT_PADDING}
                        x2={fragX + fragWidth}
                        y2={opY - LAYOUT.MESSAGE_LABEL_HEIGHT - LAYOUT.FRAGMENT_PADDING}
                        stroke={colors.fragmentBorder}
                        strokeWidth={1}
                        strokeDasharray="4,2"
                      />
                      {op.guardCondition && (
                        <text
                          x={fragX + 8}
                          y={opY - LAYOUT.MESSAGE_LABEL_HEIGHT - LAYOUT.FRAGMENT_PADDING + 14}
                          fill={colors.textSecondary}
                          fontSize={10}
                          fontFamily="monospace"
                        >
                          [{op.guardCondition}]
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {participants.map((p) => {
            const lifelineTop = dimensions.lifelineTop;
            const lifelineBottom = p.isDestroyed
              ? messageYBySeq.get(p.lifelineEnd) ?? dimensions.lifelineBottom
              : dimensions.lifelineBottom;

            return (
              <g key={`lifeline-${p.id}`}>
                <line
                  x1={p.x}
                  y1={lifelineTop}
                  x2={p.x}
                  y2={lifelineBottom}
                  stroke={colors.lifelineDashed}
                  strokeWidth={1}
                  strokeDasharray="4,4"
                />
                {p.isDestroyed && (
                  <g>
                    <line
                      x1={p.x - 6}
                      y1={lifelineBottom - 6}
                      x2={p.x + 6}
                      y2={lifelineBottom + 6}
                      stroke={colors.returnArrow}
                      strokeWidth={2}
                    />
                    <line
                      x1={p.x - 6}
                      y1={lifelineBottom + 6}
                      x2={p.x + 6}
                      y2={lifelineBottom - 6}
                      stroke={colors.returnArrow}
                      strokeWidth={2}
                    />
                  </g>
                )}
              </g>
            );
          })}

          {activations.map((act, idx) => {
            const p = participantMap.get(act.participantId);
            if (!p) return null;
            return (
              <rect
                key={`act-${idx}`}
                x={p.x - LAYOUT.ACTIVATION_WIDTH / 2}
                y={act.startY - LAYOUT.MESSAGE_LABEL_HEIGHT / 2}
                width={LAYOUT.ACTIVATION_WIDTH}
                height={Math.max(act.endY - act.startY + LAYOUT.MESSAGE_LABEL_HEIGHT, 10)}
                fill={colors.activation}
                stroke={colors.activationBorder}
                strokeWidth={1}
                rx={1}
              />
            );
          })}

          {messages.map((msg) => {
            const sourceP = participantMap.get(msg.source);
            const targetP = participantMap.get(msg.target);
            if (!sourceP || !targetP) return null;

            const arrowColor = msg.isReturn
              ? colors.returnArrow
              : msg.isAsync
                ? colors.asyncArrow
                : msg.isSelfCall
                  ? colors.selfCallArrow
                  : msg.isCreate
                    ? colors.createArrow
                    : colors.syncArrow;

            const lineStyle = msg.isReturn ? '4,3' : 'none';
            const isHighlighted = hoveredMessage === msg.id || selectedMessage === msg.id;

            if (msg.isSelfCall || msg.source === msg.target) {
              const loopX = sourceP.x + LAYOUT.ACTIVATION_WIDTH / 2;
              const loopStartY = msg.y - LAYOUT.SELF_CALL_HEIGHT / 2;
              const loopEndY = msg.y + LAYOUT.SELF_CALL_HEIGHT / 2;
              const loopWidth = LAYOUT.SELF_CALL_WIDTH;

              return (
                <g
                  key={`msg-${msg.id}`}
                  className="cg-seq-message-group"
                  onClick={() => handleMessageClick(msg.id)}
                  onMouseEnter={() => setHoveredMessage(msg.id)}
                  onMouseLeave={() => setHoveredMessage(null)}
                >
                  <title>{`${msg.methodName}(${msg.arguments})`}{msg.lineNumber ? ` :${msg.lineNumber}` : ''}</title>
                  {isHighlighted && (
                    <rect
                      x={loopX - 2}
                      y={loopStartY - 2}
                      width={loopWidth + 4}
                      height={loopEndY - loopStartY + 4}
                      fill={colors.highlightBg}
                      rx={2}
                    />
                  )}
                  <path
                    d={`M ${loopX} ${loopStartY} L ${loopX + loopWidth} ${loopStartY} L ${loopX + loopWidth} ${loopEndY} L ${loopX + LAYOUT.ARROW_HEAD_SIZE} ${loopEndY}`}
                    fill="none"
                    stroke={arrowColor}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                  />
                  <polygon
                    points={`${loopX},${loopEndY} ${loopX + LAYOUT.ARROW_HEAD_SIZE},${loopEndY - 4} ${loopX + LAYOUT.ARROW_HEAD_SIZE},${loopEndY + 4}`}
                    fill={arrowColor}
                  />
                  <text
                    x={loopX + loopWidth + 4}
                    y={msg.y - 2}
                    fill={colors.text}
                    fontSize={11}
                    fontFamily="monospace"
                  >
                    {truncateLabel(msg.methodName, 100)}
                  </text>
                  <text
                    x={loopX + loopWidth + 4}
                    y={msg.y + 10}
                    fill={colors.textSecondary}
                    fontSize={9}
                    fontFamily="monospace"
                  >
                    {formatArguments(msg.arguments)}
                  </text>
                </g>
              );
            }

            const sourceX = sourceP.x;
            const targetX = targetP.x;
            const isRightToLeft = targetX < sourceX;
            const adjustedSourceX = isRightToLeft ? sourceX - LAYOUT.ACTIVATION_WIDTH / 2 : sourceX + LAYOUT.ACTIVATION_WIDTH / 2;
            const adjustedTargetX = isRightToLeft ? targetX + LAYOUT.ACTIVATION_WIDTH / 2 : targetX - LAYOUT.ACTIVATION_WIDTH / 2;

            const arrowEndX = adjustedTargetX;
            const arrowStartX = adjustedSourceX;

            const arrowHeadDir = isRightToLeft ? -1 : 1;
            const arrowHeadPoints = msg.isAsync
              ? `${arrowEndX},${msg.y} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y - 4} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y + 4}`
              : `${arrowEndX},${msg.y} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y - LAYOUT.ARROW_HEAD_SIZE / 2} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y + LAYOUT.ARROW_HEAD_SIZE / 2}`;

            const labelX = (arrowStartX + arrowEndX) / 2;
            const labelY = msg.y - 4;
            const seqLabel = `${msg.sequenceNumber}: ${truncateLabel(msg.methodName, 120)}`;
            const argLabel = formatArguments(msg.arguments);

            return (
              <g
                key={`msg-${msg.id}`}
                className="cg-seq-message-group"
                onClick={() => handleMessageClick(msg.id)}
                onMouseEnter={() => setHoveredMessage(msg.id)}
                onMouseLeave={() => setHoveredMessage(null)}
              >
                <title>{`${msg.methodName}(${msg.arguments})`}{msg.lineNumber ? ` :${msg.lineNumber}` : ''}</title>
                {isHighlighted && (
                  <rect
                    x={Math.min(arrowStartX, arrowEndX) - 4}
                    y={msg.y - 10}
                    width={Math.abs(arrowEndX - arrowStartX) + 8}
                    height={20}
                    fill={colors.highlightBg}
                    rx={2}
                  />
                )}
                <line
                  className="cg-seq-message-line"
                  x1={arrowStartX}
                  y1={msg.y}
                  x2={arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE}
                  y2={msg.y}
                  stroke={arrowColor}
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  strokeDasharray={lineStyle}
                />
                <polygon
                  points={arrowHeadPoints}
                  fill={msg.isAsync ? 'none' : arrowColor}
                  stroke={arrowColor}
                  strokeWidth={1.5}
                />
                <text
                  x={labelX}
                  y={labelY}
                  fill={colors.text}
                  fontSize={11}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {seqLabel}
                </text>
                {argLabel && (
                  <text
                    x={labelX}
                    y={labelY + 12}
                    fill={colors.textSecondary}
                    fontSize={9}
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {argLabel}
                  </text>
                )}
              </g>
            );
          })}

          {participants.map((p) => {
            const color = getParticipantColor(p.type, isDark);
            const boxX = p.x - LAYOUT.PARTICIPANT_BOX_WIDTH / 2;
            const boxY = LAYOUT.SVG_PADDING_TOP;
            const isHovered = hoveredParticipant === p.id;

            return (
              <g
                key={`participant-${p.id}`}
                className="cg-seq-participant-group"
                onClick={() => handleParticipantClick(p.id)}
                onMouseEnter={() => setHoveredParticipant(p.id)}
                onMouseLeave={() => setHoveredParticipant(null)}
              >
                <rect
                  className="cg-seq-participant-box"
                  x={boxX}
                  y={boxY}
                  width={LAYOUT.PARTICIPANT_BOX_WIDTH}
                  height={LAYOUT.PARTICIPANT_BOX_HEIGHT}
                  fill={colors.participantBg}
                  stroke={color}
                  strokeWidth={isHovered ? 3 : 2}
                  rx={3}
                />
                <rect
                  x={boxX}
                  y={boxY}
                  width={4}
                  height={LAYOUT.PARTICIPANT_BOX_HEIGHT}
                  fill={color}
                  rx={1}
                />
                <text
                  x={p.x}
                  y={boxY + 14}
                  fill={colors.text}
                  fontSize={12}
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {truncateLabel(p.name, LAYOUT.PARTICIPANT_BOX_WIDTH - 16)}
                </text>
                <text
                  x={p.x}
                  y={boxY + 28}
                  fill={colors.textSecondary}
                  fontSize={9}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  «{p.type}»
                </text>
                {p.isCreated && (
                  <text
                    x={p.x}
                    y={boxY - 6}
                    fill={colors.createArrow}
                    fontSize={9}
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    new
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="cg-seq-zoom-controls">
        <button className="cg-seq-zoom-btn" aria-label={t('sequence.zoomIn')} onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>+</button>
        <button className="cg-seq-zoom-btn" aria-label={t('sequence.zoomOut')} onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}>−</button>
        <button className="cg-seq-zoom-btn cg-seq-reset" aria-label={t('sequence.resetView')} onClick={handleResetView}>⟲</button>
      </div>

      <div className="cg-seq-zoom-indicator">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
};
