import { memo, useId } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import type { GodModule } from '../hooks/useAnalysisPanels.ts';

/**
 * God Module 阈值边界：低于它不触发重检测（输入噪声过滤）。
 *
 * 1 是合法值（单文件微图也想看全量），但不能为 0 或负数——detect() 的
 * `nodeList.length >= threshold` 在 0 时会把空模块也算出来。
 */
export const GOD_MODULE_THRESHOLD_MIN = 1;
/** 上限与 detect() 语义一致：超过节点总数的阈值没有意义，取一个宽松常数即可。 */
export const GOD_MODULE_THRESHOLD_MAX = 100000;

interface GodModulePanelProps {
  godModules: GodModule[];
  /** 扫描状态：区分「从未扫描」（等待图数据）与「扫描后无结果」（诚实空态）。 */
  godModuleScan: { scanned: boolean; nodeCount: number };
  /** 当前阈值（受控）。 */
  threshold: number;
  /** 阈值变更回调。 */
  onThresholdChange: (v: number) => void;
  onClose: () => void;
  label: string;
  statsLabel: (nodes: number, edges: number) => string;
  /** 扫描完成但无超标模块的提示文案。 */
  emptyLabel: string;
  /** 图还没加载的提示文案。 */
  waitLabel: string;
  /** 阈值控件标签。 */
  thresholdLabel: string;
}

/**
 * God Module 面板（cycle-113 产品化）。
 *
 * 之前：结果为空 ⇒ 整个面板不可见 ⇒ 13 节点桩图（阈值 50）上功能静默不可达。
 * 现在：开关打开即显示——有结果列出结果；扫描过但无结果显示「当前阈值下无超标模块」
 * 并给出阈值调节；还没扫描（图空）显示等待提示。三种状态互相不可伪装。
 */
export const GodModulePanel = memo(function GodModulePanel({
  godModules, godModuleScan, threshold, onThresholdChange, onClose, label, statsLabel,
  emptyLabel, waitLabel, thresholdLabel,
}: GodModulePanelProps) {
  const thresholdInputId = useId();

  const handleThresholdChange = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onThresholdChange(Math.min(GOD_MODULE_THRESHOLD_MAX, Math.max(GOD_MODULE_THRESHOLD_MIN, n)));
  };

  return (
    <AnalysisPanelShell variant="godmodule" label={label} onClose={onClose}>
      {godModules.length > 0 ? (
        godModules.map((m) => (
          <div key={m.modulePath} className="cg-godmodule-item">
            <div className="cg-godmodule-path">{m.modulePath}</div>
            <div className="cg-godmodule-stats">{statsLabel(m.nodeCount, m.edgeCount)}</div>
            <div className="cg-godmodule-suggestion">{m.suggestion}</div>
          </div>
        ))
      ) : godModuleScan.scanned ? (
        <div className="cg-godmodule-empty" role="status">
          {emptyLabel}
        </div>
      ) : (
        <div className="cg-godmodule-empty cg-godmodule-wait" role="status">
          {waitLabel}
        </div>
      )}
      <div className="cg-godmodule-threshold">
        <label htmlFor={thresholdInputId}>{thresholdLabel}</label>
        <input
          id={thresholdInputId}
          type="number"
          className="cg-godmodule-threshold-input"
          name="godmodule-threshold"
          aria-label={thresholdLabel}
          min={GOD_MODULE_THRESHOLD_MIN}
          max={GOD_MODULE_THRESHOLD_MAX}
          value={threshold}
          onChange={(e) => handleThresholdChange(e.target.value)}
        />
      </div>
    </AnalysisPanelShell>
  );
});
