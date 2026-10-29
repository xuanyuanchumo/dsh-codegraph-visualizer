import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useT } from '../i18n/index.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { UI } from '../../shared/constants.ts';
import type { PrerequisiteStatusInput } from '../../shared/prerequisiteStatus.ts';
import { GraphIcon, UploadIcon, AlertIcon, CheckIcon, CopyIcon, ZapIcon } from './Icons.tsx';

interface EmptyStateProps {
  /**
   * 能力位。**只更新 `astSource` / `graphSource` 决定 UI**，`builtin` 是 `astSource` 的
   * 已弃用别名（形状见 `src/shared/prerequisiteStatus.ts`）。
   *
   * 刻意用宽松输入类型而不是 `PrerequisiteStatus`：组件测试只关心其中两位，
   * 让每个 fixture 都写全五个字段会把"这个用例在测什么"淹没在样板里。
   * 归一化发生在 store 边界（`fetchStatus`）而不是组件里 —— 组件不该有第二套兜底逻辑。
   */
  prerequisites: PrerequisiteStatusInput;
  onImport: () => void;
  onScanWorkspace: () => void;
  /** True while the host is still building the index for the active workspace. */
  indexing?: boolean;
}

export const EmptyState = memo(function EmptyState({ prerequisites, onImport, onScanWorkspace, indexing = false }: EmptyStateProps) {
  const t = useT();
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const installTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (installTimerRef.current) clearTimeout(installTimerRef.current);
    };
  }, []);

  const handleCopyCmd = useCallback((cmd: string) => {
    try {
      navigator.clipboard?.writeText(cmd);
      setCopiedCmd(cmd);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCmd(null), UI.COPY_HINT_TIMEOUT_MS);
    } catch { /* clipboard unavailable — best-effort */ }
  }, []);

  const handleInstall = useCallback((plugin: string) => {
    const cmd = plugin === 'dsh-codegraph' ? t('prereq.installCodegraph') : t('prereq.installLens');
    try {
      navigator.clipboard?.writeText(cmd);
      setCopiedCmd(cmd);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCmd(null), UI.INSTALL_HINT_TIMEOUT_MS);
    } catch { /* clipboard unavailable — best-effort */ }
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.INSTALL_PLUGIN, {
      detail: { plugin },
    }));
    setInstalling(true);
    if (installTimerRef.current) clearTimeout(installTimerRef.current);
    installTimerRef.current = setTimeout(() => setInstalling(false), UI.INSTALL_HINT_TIMEOUT_MS);
  }, [t]);

  const codegraphMissing = !prerequisites.codegraph;
  const lensMissing = !prerequisites.lens;
  const anyMissing = codegraphMissing || lensMissing;
  const allMissing = codegraphMissing && lensMissing;
  // 降级提示的判据是 **`graphSource`（图数据通道）**，不是 `builtin` / `astSource`。
  //
  // 修前读 `prerequisites.builtin ?? true`，而宿主把 `builtin` 硬编码成 `true`
  // （`docs/需求分析.md` §61.10）⇒ 只要上下游都缺，界面就无条件承诺
  // 「降级模式 — 使用内置 TreeSitter 和依赖分析」。真实情况是：AST 分析（`/ast`、`/outline`）
  // 确实可用，但**它产不出一张图** —— `fetchMergedGraph` 的内置回落只记日志不产节点
  // （`src/tools.ts:132-134`）。一份承诺了却给不出的降级路径比不显示更糟：
  // 用户会以为"点扫描就有图"，然后得到一个空画布。
  //
  // 缺省方向是 `false`（不知道 ≠ 有），与 `normalizePrerequisiteStatus` 一致。
  const hasGraphSource = prerequisites.graphSource ?? false;

  return (
    <div className="cg-empty-state">
      <GraphIcon size={48} className="cg-empty-icon" />
      <span className="cg-empty-title">{indexing ? t('empty.indexingTitle') : t('empty.title')}</span>
      <span className="cg-empty-subtitle">{indexing ? t('empty.indexingSubtitle') : t('empty.subtitle')}</span>
      {!indexing && allMissing && hasGraphSource && (
        <div className="cg-empty-degraded-notice">
          <span className="cg-degraded-label">{t('empty.degradedMode')}</span>
          <span className="cg-degraded-hint">{t('empty.degradedHint')}</span>
        </div>
      )}
      {!indexing && anyMissing && (
        <div className="cg-empty-prereq-warning">
          <div className="cg-prereq-header">
            <AlertIcon size={14} />
            <span className="cg-prereq-title">{t('empty.prereqTitle')}</span>
          </div>

          {codegraphMissing && (
            <div className="cg-prereq-item">
              <div className="cg-prereq-item-header">
                <span className={`cg-prereq-status-dot ${prerequisites.codegraph ? 'cg-ok' : 'cg-missing'}`} />
                <span className="cg-prereq-item-label">{t('prereq.codegraphLabel')}</span>
                <span className="cg-prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="cg-prereq-item-desc">{t('prereq.codegraphDesc')}</span>
              <div className="cg-prereq-cmd-row">
                <code className="cg-prereq-cmd">{t('prereq.installCodegraph')}</code>
                <button
                  className="cg-prereq-copy-btn"
                  onClick={() => handleCopyCmd(t('prereq.installCodegraph'))}
                  aria-label={t('empty.copyCmd')}
                  title={t('empty.copyCmd')}
                >
                  {copiedCmd === t('prereq.installCodegraph') ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
              <button
                className="cg-prereq-install-btn"
                onClick={() => handleInstall('dsh-codegraph')}
                disabled={installing}
                aria-label={installing ? t('prereq.detecting') : t('prereq.installTitle')}
              >
                <ZapIcon size={14} /> {installing ? (copiedCmd === t('prereq.installCodegraph') ? t('empty.copied') : t('prereq.detecting')) : t('prereq.installTitle')}
              </button>
            </div>
          )}

          {lensMissing && (
            <div className="cg-prereq-item">
              <div className="cg-prereq-item-header">
                <span className={`cg-prereq-status-dot ${prerequisites.lens ? 'cg-ok' : 'cg-missing'}`} />
                <span className="cg-prereq-item-label">{t('prereq.lensLabel')}</span>
                <span className="cg-prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="cg-prereq-item-desc">{t('prereq.lensDesc')}</span>
              <div className="cg-prereq-cmd-row">
                <code className="cg-prereq-cmd">{t('prereq.installLens')}</code>
                <button
                  className="cg-prereq-copy-btn"
                  onClick={() => handleCopyCmd(t('prereq.installLens'))}
                  aria-label={t('empty.copyCmd')}
                  title={t('empty.copyCmd')}
                >
                  {copiedCmd === t('prereq.installLens') ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
              <button
                className="cg-prereq-install-btn"
                onClick={() => handleInstall('dsh-tool-lens')}
                disabled={installing}
                aria-label={installing ? t('prereq.detecting') : t('prereq.installTitle')}
              >
                <ZapIcon size={14} /> {installing ? (copiedCmd === t('prereq.installLens') ? t('empty.copied') : t('prereq.detecting')) : t('prereq.installTitle')}
              </button>
            </div>
          )}

          {copiedCmd && <span className="cg-prereq-copied">{t('empty.copied')}</span>}
        </div>
      )}
      <div className="cg-empty-actions">
        <button className="cg-empty-import-btn" onClick={onImport}>
          <UploadIcon size={15} /> {t('empty.import')}
        </button>
        <button className="cg-empty-scan-btn" onClick={onScanWorkspace}>
          <GraphIcon size={15} /> {t('empty.scanWorkspace')}
        </button>
      </div>
    </div>
  );
});
