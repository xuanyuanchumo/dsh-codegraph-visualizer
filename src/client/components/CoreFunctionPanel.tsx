import React from 'react';
import { CloseIcon } from './Icons.tsx';
import type { CoreFunction, CoreFunctionCategory } from '../../shared/analysis/CoreFunctionAnalyzer.ts';

interface CoreFunctionPanelProps {
  coreFunctions: CoreFunction[];
  onClose: () => void;
  label: string;
  onSelectFunction: (nodeId: string) => void;
}

const CATEGORY_LABELS: Record<CoreFunctionCategory, string> = {
  entry: '入口',
  hub: '枢纽',
  api: 'API',
  critical: '关键',
};

const CATEGORY_COLORS: Record<CoreFunctionCategory, string> = {
  entry: '#4caf50',
  hub: '#ff9800',
  api: '#2196f3',
  critical: '#f44336',
};

const REASON_LABELS: Record<string, string> = {
  'high-indegree': '高入度',
  'high-outdegree': '高出度',
  'entry-point': '入口点',
  'exported': '已导出',
  'handler-pattern': '处理器',
  'event-pattern': '事件',
  'cli-pattern': 'CLI',
  'large-influence': '大影响',
  'deep-call-chain': '深调用链',
  'hub-function': '枢纽函数',
};

export function CoreFunctionPanel({ coreFunctions, onClose, label, onSelectFunction }: CoreFunctionPanelProps) {
  return (
    <div className="analysis-panel core-function-panel" role="region" aria-label={label}>
      <div className="analysis-panel-header">
        <span>{label}</span>
        <button onClick={onClose} className="cg-close-btn"><CloseIcon size={14} /></button>
      </div>
      <div className="analysis-panel-content">
        {coreFunctions.slice(0, 20).map((fn) => (
          <div
            key={fn.nodeId}
            className="core-function-item"
            onClick={() => onSelectFunction(fn.nodeId)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelectFunction(fn.nodeId); }}
          >
            <span
              className="core-function-category-badge"
              style={{ backgroundColor: CATEGORY_COLORS[fn.category] }}
            >
              {CATEGORY_LABELS[fn.category]}
            </span>
            <span className="core-function-label">{fn.label}</span>
            <span className="core-function-score">{fn.score}</span>
            <div className="core-function-reasons">
              {fn.reasons.map((r) => (
                <span key={r} className="core-function-reason-tag">{REASON_LABELS[r] ?? r}</span>
              ))}
            </div>
            <div className="core-function-stats">
              <span title="入度">in:{fn.inDegree}</span>
              <span title="出度">out:{fn.outDegree}</span>
              <span title="影响范围">reach:{fn.influenceReach}</span>
              <span title="调用链深度">depth:{fn.callChainDepth}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}