
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
    <div className="micro-empty-prompt">
      <div className="micro-empty-icon">{modeLabel}</div>
      <div className="micro-empty-text">{selectFunctionPrompt}</div>
      <button className="micro-empty-back-btn" onClick={onBackToCode}>{backToCodeLabel}</button>
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
    <div className="micro-function-bar">
      {modeLabel && <span className="micro-function-mode">{modeLabel}</span>}
      <span className="micro-function-name">{functionName}</span>
      {shortPath && <span className="micro-function-path">{shortPath}</span>}
      <button className="micro-function-close" onClick={onClose} aria-label={t('micro.closeView')}>✕</button>
    </div>
  );
})
