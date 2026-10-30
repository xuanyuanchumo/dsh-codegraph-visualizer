import { memo, useEffect, useState } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { fetchRegistryBoard, type RegistryBoard } from '../api/index.ts';
import { useT } from '../i18n/index.ts';

/**
 * 注册-生产-消费矩阵看板（cycle-117）。
 *
 * 数据面：宿主 `/registry`（四面清单 + 断链 + live 实测）。拉取失败显示「不可达」——
 * null 与空矩阵必须可区分（hostRequests 失败语义）。
 *
 * 呈现原则（白盒透明化）：
 * - 顶部四个数字块 = 四面计数（tools/routes/entries/skill）；
 * - 断链行：brokenLinks 非空时红色列出（正常时显示「无断链」而不是隐藏该行——
 *   「没有断链」本身是可观测事实）；
 * - live 计数：宿主实测（live/idle/unknown）；entries 的 unknown 是设计内（DOM 在客户端）；
 * - 分面清单：每面一个折叠段，行 = id + lifecycle。默认全展开（矩阵只有 36 行，折叠是伪省）。
 */
export const RegistryPanel = memo(function RegistryPanel({ onClose, label }: { onClose: () => void; label: string }) {
  const t = useT();
  const [board, setBoard] = useState<RegistryBoard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRegistryBoard().then((b) => {
      if (cancelled) return;
      if (b === null) setFailed(true);
      else setBoard(b);
    });
    return () => { cancelled = true; };
  }, []);

  const faces = board ? (['tools', 'routes', 'entries', 'skill'] as const) : [];

  return (
    <AnalysisPanelShell variant="registry" label={label} onClose={onClose}>
      {failed ? (
        <div className="cg-registry-empty" role="status">{t('registry.unreachable')}</div>
      ) : !board ? (
        <div className="cg-registry-empty cg-registry-wait" role="status">{t('registry.loading')}</div>
      ) : (
        <>
          <div className="cg-registry-faces">
            {faces.map((f) => (
              <div key={f} className="cg-registry-face">
                <span className="cg-registry-face-count">{board.byFace[f] ?? 0}</span>
                <span className="cg-registry-face-name">{t('registry.face.' + f)}</span>
              </div>
            ))}
          </div>
          <div className={'cg-registry-broken' + (board.brokenLinks.length > 0 ? ' cg-registry-broken-active' : '')} role="status">
            {board.brokenLinks.length > 0
              ? t('registry.broken', { ids: board.brokenLinks.join(', ') })
              : t('registry.noBroken')}
          </div>
          {board.liveCounts && (
            <div className="cg-registry-live">
              {(['live', 'idle', 'unknown'] as const).map((k) => (
                <span key={k} className={'cg-registry-live-' + k}>
                  {t('registry.live.' + k, { n: board.liveCounts?.[k] ?? 0 })}
                </span>
              ))}
            </div>
          )}
          <div className="cg-registry-list">
            {faces.map((f) => (
              <div key={f} className="cg-registry-section">
                <div className="cg-registry-section-title">{t('registry.face.' + f)}</div>
                {board.entries.filter((e) => e.face === f).map((e) => {
                  const live = board.live?.find((h) => h.id === e.id);
                  return (
                    <div key={e.id} className="cg-registry-row" title={live?.basis ?? ''}>
                      <span className={'cg-registry-dot cg-registry-live-' + (live?.live ?? 'unknown')} aria-hidden />
                      <span className="cg-registry-id">{e.id}</span>
                      <span className={'cg-registry-lifecycle cg-registry-lc-' + e.lifecycle}>{e.lifecycle}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="cg-registry-footnote">{t('registry.footnote')}</div>
        </>
      )}
    </AnalysisPanelShell>
  );
});
