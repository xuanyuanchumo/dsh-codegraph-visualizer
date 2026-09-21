
import { memo } from 'react';
import { useT } from '../i18n/index.ts';

interface MicroViewPromptProps {
  viewMode: string;
  selectFunctionPrompt: string;
  flowchartLabel: string;
  sequenceLabel: string;
  backToCodeLabel: string;
  onBackToCode: () => void;
}


export const MicroViewPrompt = memo(function MicroViewPrompt({ viewMode, selectFunctionPrompt, flowchartLabel, sequenceLabel, backToCodeLabel, onBackToCode }: MicroViewPromptProps) {
  const modeLabel = viewMode === 'cfg' ? 'CFG' : viewMode === 'flowchart' ? flowchartLabel : sequenceLabel;
  return (
    <div className="cg-micro-empty-prompt">
      <div className="cg-micro-empty-icon">{modeLabel}</div>
      <div className="cg-micro-empty-text">{selectFunctionPrompt}</div>
      <button className="cg-micro-empty-back-btn" onClick={onBackToCode} aria-label={backToCodeLabel}>{backToCodeLabel}</button>
    </div>
  );
})

interface MicroFunctionBarProps {
  functionName: string;
  filePath?: string;
  viewMode?: string;
  onClose: () => void;
}

export const MicroFunctionBar = memo(function MicroFunctionBar({ functionName, filePath, viewMode, onClose }: MicroFunctionBarProps) {
  const t = useT();
  const modeLabel = viewMode === 'cfg' ? 'CFG' : viewMode === 'flowchart' ? t('viewMode.flowchart') : viewMode === 'sequence' ? t('viewMode.sequence') : '';
  const shortPath = filePath ? filePath.split(/[\\/]/).slice(-2).join('/') : '';
  return (
    <div className="cg-micro-function-bar">
      {modeLabel && <span className="cg-micro-function-mode">{modeLabel}</span>}
      <span className="cg-micro-function-name">{functionName}</span>
      {shortPath && <span className="cg-micro-function-path">{shortPath}</span>}
      <button className="cg-micro-function-close" onClick={onClose} aria-label={t('micro.closeView')}>✕</button>
    </div>
  );
})
