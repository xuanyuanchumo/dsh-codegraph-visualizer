import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { CloseIcon } from './Icons.tsx';

interface StatsPanelProps {
  counts: { function: number; class: number; variable: number; module: number; interface: number };
  onClose: () => void;
  thumbnail: string | null;
  viewportInfo: { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
}

export function StatsPanel({ counts, onClose, thumbnail, viewportInfo }: StatsPanelProps) {
  const t = useT();
  const total = counts.function + counts.class + counts.variable + counts.module + counts.interface;
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (thumbnail) setImgLoaded(false);
  }, [thumbnail]);

  const viewportBox = (() => {
    if (!viewportInfo || !imgLoaded || !imgRef.current) return null;
    const img = imgRef.current;
    const imgW = img.clientWidth;
    const imgH = img.clientHeight;
    if (imgW === 0 || imgH === 0) return null;
    const { zoom, pan, renderedSize, totalSize } = viewportInfo;
    if (totalSize.w === 0 || totalSize.h === 0) return null;
    const scale = Math.min(imgW / totalSize.w, imgH / totalSize.h);
    const offsetX = (imgW - totalSize.w * scale) / 2;
    const offsetY = (imgH - totalSize.h * scale) / 2;
    const vpW = renderedSize.w / zoom * scale;
    const vpH = renderedSize.h / zoom * scale;
    const vpX = offsetX + (pan.x / zoom) * scale + (totalSize.w * scale - imgW) / 2;
    const vpY = offsetY + (pan.y / zoom) * scale + (totalSize.h * scale - imgH) / 2;
    return { left: vpX, top: vpY, width: vpW, height: vpH };
  })();

  return (
    <div className="mini-map" role="complementary" aria-label={t('minimap.title')}>
      <div className="mini-map-header">
        <span>{t('minimap.title')}</span>
        <button
          onClick={onClose}
          aria-label={t('minimap.close')}
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px' }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mini-map-content">
        {thumbnail && (
          <div className="mini-map-thumbnail">
            <img
              ref={imgRef}
              src={thumbnail}
              alt={t('minimap.title')}
              onLoad={() => setImgLoaded(true)}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
            {viewportBox && (
              <div
                className="mini-map-viewport"
                style={{
                  position: 'absolute',
                  left: `${viewportBox.left}px`,
                  top: `${viewportBox.top}px`,
                  width: `${viewportBox.width}px`,
                  height: `${viewportBox.height}px`,
                }}
              />
            )}
          </div>
        )}
        <div className="mini-map-stats">
          <div><span className="dot" style={{ background: 'var(--cg-success)' }} />{t('minimap.functions')}: {counts.function}</div>
          <div><span className="dot" style={{ background: 'var(--cg-accent)' }} />{t('minimap.classes')}: {counts.class}</div>
          <div><span className="dot" style={{ background: 'var(--cg-warning)' }} />{t('minimap.variables')}: {counts.variable}</div>
          <div><span className="dot" style={{ background: '#ec4899' }} />{t('minimap.modules')}: {counts.module}</div>
          <div><span className="dot" style={{ background: '#14b8a6' }} />{t('minimap.interfaces')}: {counts.interface}</div>
        </div>
        <div className="mini-map-total">{t('minimap.total')}: {total}</div>
      </div>
    </div>
  );
}
