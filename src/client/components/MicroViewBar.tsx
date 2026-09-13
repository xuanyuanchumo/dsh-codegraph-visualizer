import React from 'react';

interface MicroViewPromptProps {
  viewMode: string;
  selectFunctionPrompt: string;
  flowchartLabel: string;
  sequenceLabel: string;
  backToCodeLabel: string;
  onBackToCode: () => void;
}

export function MicroViewPrompt({ viewMode, selectFunctionPrompt, flowchartLabel, sequenceLabel, backToCodeLabel, onBackToCode }: MicroViewPromptProps) {
  return (
    <div className="micro-empty-prompt">
      <div className="micro-empty-icon">
        {viewMode === 'cfg' ? 'CFG' : viewMode === 'flowchart' ? flowchartLabel : sequenceLabel}
      </div>
      <div>{selectFunctionPrompt}</div>
      <button className="micro-empty-back-btn" onClick={onBackToCode}>{backToCodeLabel}</button>
    </div>
  );
}

interface MicroFunctionBarProps {
  functionName: string;
  onClose: () => void;
}

export function MicroFunctionBar({ functionName, onClose }: MicroFunctionBarProps) {
  return (
    <div className="micro-function-bar">
      <span>{functionName}</span>
      <button className="micro-function-close" onClick={onClose}>✕</button>
    </div>
  );
}