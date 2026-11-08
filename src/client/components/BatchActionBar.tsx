import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('batch-bar');

/**
 * 批量操作条（cycle-149）——多选链路的 UI 消费面。
 *
 * 数据流：InteractionController（Shift+Click 维护集合 + `multi-selected` class）
 * → onSelectionToggle / onSelectionClear（useGraphRenderer 转发）
 * → graphStore.multiSelectedIds（镜像）→ 本组件渲染。
 *
 * - 空选区渲染 `null`（不占布局、不挡画布）。
 * - 「展开/收起」直接消费 store 批量动作（预算与 pinned 语义在 expandSlice，不在此重写）。
 * - 「清除」必须走**渲染器事实源**（`onClearSelection` → `clearMultiSelect()`：集合+class+
 *   回调一体）——只清 store 镜像会让渲染器残留集合与高亮，下一次 Shift+Click 从过期
 *   集合出发（双集合漂移缺陷）。渲染器不可用时回退 store 清理（诚实降级）。
 * - 「导出 JSON」仅含 rawNodes 命中的选区（聚合节点跳过——见 multiSelectSlice 的诚实缺口），
 *   下载的条数与计数可能不同，如实以 `selectedCount`/`exportedCount` 双字段呈现。
 * - a11y：`role="toolbar"` + 每个按钮 `aria-label`（i18n）。
 */
interface BatchActionBarProps {
  /** 清除选区的渲染器通道（GraphPanel 传 `rendererRef.current?.clearMultiSelect`）。 */
  onClearSelection?: () => void;
}

export function BatchActionBar({ onClearSelection }: BatchActionBarProps) {
  const t = useT();
  const multiSelectedIds = useGraphStore((s) => s.multiSelectedIds);
  const batchExpandSelected = useGraphStore((s) => s.batchExpandSelected);
  const batchCollapseSelected = useGraphStore((s) => s.batchCollapseSelected);
  const exportSelectedNodes = useGraphStore((s) => s.exportSelectedNodes);
  const clearMultiSelection = useGraphStore((s) => s.clearMultiSelection);

  if (multiSelectedIds.size === 0) return null;

  const handleClear = () => {
    if (onClearSelection) onClearSelection();
    else clearMultiSelection();
  };

  const handleExport = () => {
    try {
      const nodes = exportSelectedNodes();
      const payload = {
        exportedAt: new Date().toISOString(),
        selectedCount: multiSelectedIds.size,
        exportedCount: nodes.length,
        nodes,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codegraph-selection-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // 下载失败不吞掉：计数条不是错误通道，日志兜底（与 useNodeInteraction 同策略）。
      log.error('export selection failed', { err });
    }
  };

  return (
    <div className="cg-batch-bar" role="toolbar" aria-label={t('batchbar.ariaLabel')}>
      <span className="cg-batch-bar-count" aria-live="polite">
        {t('batchbar.count', { count: multiSelectedIds.size })}
      </span>
      <button
        type="button"
        className="cg-batch-bar-btn"
        onClick={() => { batchExpandSelected(); }}
        aria-label={t('batchbar.expandAria')}
      >
        {t('batchbar.expand')}
      </button>
      <button
        type="button"
        className="cg-batch-bar-btn"
        onClick={() => { batchCollapseSelected(); }}
        aria-label={t('batchbar.collapseAria')}
      >
        {t('batchbar.collapse')}
      </button>
      <button
        type="button"
        className="cg-batch-bar-btn"
        onClick={handleExport}
        aria-label={t('batchbar.exportAria')}
      >
        {t('batchbar.export')}
      </button>
      <button
        type="button"
        className="cg-batch-bar-btn cg-batch-bar-btn-clear"
        onClick={handleClear}
        aria-label={t('batchbar.clearAria')}
      >
        {t('batchbar.clear')}
      </button>
    </div>
  );
}
