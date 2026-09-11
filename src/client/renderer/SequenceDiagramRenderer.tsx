import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ThemeType } from './IRenderer.ts';
import { getThemeColors } from './styles/ThemeStylesheet.ts';

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
      type: n.properties['participantType'] as string,
      className: n.properties['className'] as string | undefined,
      lifelineStart: n.properties['lifelineStart'] as number,
      lifelineEnd: n.properties['lifelineEnd'] as number,
      isCreated: n.properties['isCreated'] as boolean,
      isDestroyed: n.properties['isDestroyed'] as boolean,
      x: 0,
    }))
    .sort((a, b) => a.lifelineStart - b.lifelineStart);
}

function extractMessages(edges: GraphEdge[]): MessageInfo[] {
  return edges
    .filter((e) => e.properties['sequenceNumber'] !== undefined)
    .map((e) => ({
      id: e.id,
      sequenceNumber: e.properties['sequenceNumber'] as number,
      source: e.source,
      target: e.target,
      methodName: e.properties['methodName'] as string,
      arguments: (e.properties['arguments'] as string[]) ?? [],
      isAsync: e.properties['isAsync'] as boolean,
      isSelfCall: e.properties['isSelfCall'] as boolean,
      isReturn: e.properties['isReturn'] as boolean,
      isCreate: e.properties['isCreate'] as boolean,
      lineNumber: e.properties['lineNumber'] as number,
      y: 0,
    }))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

function extractFragments(nodes: GraphNode[]): FragmentInfo[] {
  return nodes
    .filter((n) => n.properties['isFragment'])
    .map((n) => ({
      id: n.id,
      type: n.properties['fragmentType'] as string,
      condition: n.properties['condition'] as string | undefined,
      loopConstraint: n.properties['loopConstraint'] as string | undefined,
      startMessage: n.properties['startMessage'] as number,
      endMessage: n.properties['endMessage'] as number,
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
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const isDark = theme === 'dark';

  const colors = useMemo(() => {
    const tc = getThemeColors(theme);
    return {
      bg: isDark ? '#1e1e2e' : '#ffffff',
      text: tc.text,
      textSecondary: isDark ? '#a0a0b0' : '#666666',
      lifeline: isDark ? '#555570' : '#aaaaaa',
      lifelineDashed: isDark ? '#444460' : '#bbbbbb',
      activation: tc.edgeCall,
      activationBorder: isDark ? '#8899cc' : '#357abd',
      syncArrow: tc.text,
      asyncArrow: tc.edgeImport,
      returnArrow: tc.edgeExtend,
      selfCallArrow: tc.nodeType,
      createArrow: tc.edgeCall,
      fragmentBg: isDark ? 'rgba(100,100,140,0.15)' : 'rgba(200,200,240,0.2)',
      fragmentBorder: isDark ? '#7777aa' : '#9999cc',
      fragmentLabelBg: isDark ? '#444466' : '#eeeeff',
      participantBg: isDark ? '#2a2a3e' : '#f0f0f5',
      participantBorder: isDark ? '#555570' : '#cccccc',
      gridLine: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
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

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleParticipantClick = useCallback((participantId: string) => {
    onNodeTap?.(participantId);
  }, [onNodeTap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleNativeWheel = (e: WheelEvent) => { e.preventDefault(); };
    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, []);

  if (participants.length === 0) {
    return (
      <div ref={containerRef} className="sequence-diagram-container" style={{ background: colors.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: colors.textSecondary, fontSize: '14px' }}>
          No sequence data available
        </div>
      </div>
    );
  }

  const svgWidth = dimensions.width;
  const svgHeight = dimensions.height;

  return (
    <div
      ref={containerRef}
      className="sequence-diagram-container"
      style={{
        background: colors.bg,
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
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
          {/* Background grid lines (horizontal) */}
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

          {/* Combined fragments */}
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
              <g key={`frag-${frag.id}`}>
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
                {/* Fragment label tab */}
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
                {/* Operand divider lines */}
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

          {/* Lifelines */}
          {participants.map((p) => {
            const lifelineTop = dimensions.lifelineTop;
            const lifelineBottom = p.isDestroyed
              ? messageYBySeq.get(p.lifelineEnd) ?? dimensions.lifelineBottom
              : dimensions.lifelineBottom;

            return (
              <g key={`lifeline-${p.id}`}>
                {/* Dashed lifeline */}
                <line
                  x1={p.x}
                  y1={lifelineTop}
                  x2={p.x}
                  y2={lifelineBottom}
                  stroke={colors.lifelineDashed}
                  strokeWidth={1}
                  strokeDasharray="4,4"
                />
                {/* Destroy marker (X at bottom) */}
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

          {/* Activation bars */}
          {(() => {
            const activations: Array<{ participantId: string; startY: number; endY: number }> = [];
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
                  activations.push({
                    participantId: msg.source,
                    startY,
                    endY: msg.y,
                  });
                  activeStacks.set(msg.source, stack);
                }
              }
            }

            for (const [participantId, stack] of activeStacks) {
              for (const startY of stack) {
                activations.push({
                  participantId,
                  startY,
                  endY: dimensions.lifelineBottom,
                });
              }
            }

            return activations.map((act, idx) => {
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
            });
          })()}

          {/* Messages */}
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

            // Self-call: draw a loop
            if (msg.isSelfCall || msg.source === msg.target) {
              const loopX = sourceP.x + LAYOUT.ACTIVATION_WIDTH / 2;
              const loopStartY = msg.y - LAYOUT.SELF_CALL_HEIGHT / 2;
              const loopEndY = msg.y + LAYOUT.SELF_CALL_HEIGHT / 2;
              const loopWidth = LAYOUT.SELF_CALL_WIDTH;

              return (
                <g key={`msg-${msg.id}`}>
                  <path
                    d={`M ${loopX} ${loopStartY} L ${loopX + loopWidth} ${loopStartY} L ${loopX + loopWidth} ${loopEndY} L ${loopX + LAYOUT.ARROW_HEAD_SIZE} ${loopEndY}`}
                    fill="none"
                    stroke={arrowColor}
                    strokeWidth={1.5}
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

            // Arrow head
            const arrowHeadDir = isRightToLeft ? -1 : 1;
            const arrowHeadPoints = msg.isAsync
              ? `${arrowEndX},${msg.y} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y - 4} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y + 4}`
              : `${arrowEndX},${msg.y} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y - LAYOUT.ARROW_HEAD_SIZE / 2} ${arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE},${msg.y + LAYOUT.ARROW_HEAD_SIZE / 2}`;

            const labelX = (arrowStartX + arrowEndX) / 2;
            const labelY = msg.y - 4;
            const seqLabel = `${msg.sequenceNumber}: ${truncateLabel(msg.methodName, 120)}`;
            const argLabel = formatArguments(msg.arguments);

            return (
              <g key={`msg-${msg.id}`}>
                {/* Message line */}
                <line
                  x1={arrowStartX}
                  y1={msg.y}
                  x2={arrowEndX - arrowHeadDir * LAYOUT.ARROW_HEAD_SIZE}
                  y2={msg.y}
                  stroke={arrowColor}
                  strokeWidth={1.5}
                  strokeDasharray={lineStyle}
                />
                {/* Arrow head */}
                <polygon
                  points={arrowHeadPoints}
                  fill={msg.isAsync ? 'none' : arrowColor}
                  stroke={arrowColor}
                  strokeWidth={1.5}
                />
                {/* Message label */}
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

          {/* Participant boxes (drawn last to be on top) */}
          {participants.map((p) => {
            const color = getParticipantColor(p.type, isDark);
            const boxX = p.x - LAYOUT.PARTICIPANT_BOX_WIDTH / 2;
            const boxY = LAYOUT.SVG_PADDING_TOP;

            return (
              <g
                key={`participant-${p.id}`}
                style={{ cursor: 'pointer' }}
                onClick={() => handleParticipantClick(p.id)}
              >
                <rect
                  x={boxX}
                  y={boxY}
                  width={LAYOUT.PARTICIPANT_BOX_WIDTH}
                  height={LAYOUT.PARTICIPANT_BOX_HEIGHT}
                  fill={colors.participantBg}
                  stroke={color}
                  strokeWidth={2}
                  rx={3}
                />
                {/* Type indicator stripe */}
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
                {/* Create marker (dashed arrow from creator) */}
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

      {/* Zoom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          zIndex: 10,
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          style={{
            width: '28px', height: '28px', border: `1px solid ${colors.participantBorder}`,
            background: colors.participantBg, color: colors.text, cursor: 'pointer',
            borderRadius: '4px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
          style={{
            width: '28px', height: '28px', border: `1px solid ${colors.participantBorder}`,
            background: colors.participantBg, color: colors.text, cursor: 'pointer',
            borderRadius: '4px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          −
        </button>
        <button
          onClick={handleResetView}
          style={{
            width: '28px', height: '28px', border: `1px solid ${colors.participantBorder}`,
            background: colors.participantBg, color: colors.text, cursor: 'pointer',
            borderRadius: '4px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ⟲
        </button>
      </div>

      {/* Zoom indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          color: colors.textSecondary,
          fontSize: '10px',
          fontFamily: 'monospace',
          zIndex: 10,
        }}
      >
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
};