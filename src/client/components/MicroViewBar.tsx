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
  const modeLabel = viewMode === 'cfg' ? 'CFG' : viewMode === 'flowchart' ? flowchartLabel : sequenceLabel;
  return (
    <div className="micro-empty-prompt">
      <div className="micro-empty-icon">{modeLabel}</div>
      <div className="micro-empty-text">{selectFunctionPrompt}</div>
      <button className="micro-empty-back-btn" onClick={onBackToCode}>{backToCodeLabel}</button>
    </div>
  );
}

interface MicroFunctionBarProps {
  functionName: string;
  filePath?: string;
  viewMode?: string;
  onClose: () => void;
}

export function MicroFunctionBar({ functionName, filePath, viewMode, onClose }: MicroFunctionBarProps) {
  const modeLabel = viewMode === 'cfg' ? 'CFG' : viewMode === 'flowchart' ? 'Flow' : viewMode === 'sequence' ? 'Seq' : '';
  const shortPath = filePath ? filePath.split(/[\\/]/).slice(-2).join('/') : '';
  return (
    <div className="micro-function-bar">
      {modeLabel && <span className="micro-function-mode">{modeLabel}</span>}
      <span className="micro-function-name">{functionName}</span>
      {shortPath && <span className="micro-function-path">{shortPath}</span>}
      <button className="micro-function-close" onClick={onClose} aria-label="Close micro view">✕</button>
    </div>
  );
}
