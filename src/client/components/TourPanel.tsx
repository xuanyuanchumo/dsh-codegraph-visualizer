import { memo, useState, useCallback } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { NodeId } from '../../types/index.ts';
import type { Tour, TourStep } from '../../shared/analysis/TourBuilder.ts';

interface TourPanelProps {
  tour: Tour;
  onClose: () => void;
}

export const TourPanel = memo(function TourPanel({ tour, onClose }: TourPanelProps) {
  const t = useT();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);

  const currentStep: TourStep | null = tour.steps[currentStepIndex] ?? null;
  const totalSteps = tour.steps.length;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === totalSteps - 1;

  const handleNext = useCallback(() => {
    if (isLast) return;
    const nextIndex = currentStepIndex + 1;
    setCurrentStepIndex(nextIndex);
    const nextStep = tour.steps[nextIndex];
    if (nextStep) setSelectedNode(NodeId(nextStep.nodeId));
  }, [currentStepIndex, isLast, tour.steps, setSelectedNode]);

  const handlePrev = useCallback(() => {
    if (isFirst) return;
    const prevIndex = currentStepIndex - 1;
    setCurrentStepIndex(prevIndex);
    const prevStep = tour.steps[prevIndex];
    if (prevStep) setSelectedNode(NodeId(prevStep.nodeId));
  }, [currentStepIndex, isFirst, tour.steps, setSelectedNode]);

  const handleStepClick = useCallback((index: number) => {
    setCurrentStepIndex(index);
    const step = tour.steps[index];
    if (step) setSelectedNode(NodeId(step.nodeId));
  }, [tour.steps, setSelectedNode]);

  if (!currentStep) {
    return (
      <div className="cg-tour-panel" role="region" aria-label={t('tour.title')}>
        <div className="cg-tour-panel-header">
          <span className="cg-tour-panel-title">{t('tour.title')}</span>
          <button className="cg-tour-panel-close" onClick={onClose} aria-label={t('tour.close')}>×</button>
        </div>
        <div className="cg-tour-empty">{t('tour.empty')}</div>
      </div>
    );
  }

  const layerLabel = t(`tour.layer.${currentStep.layer}`);

  return (
    <div className="cg-tour-panel" role="region" aria-label={t('tour.title')}>
      <div className="cg-tour-panel-header">
        <span className="cg-tour-panel-title">{t('tour.title')}</span>
        <button className="cg-tour-panel-close" onClick={onClose} aria-label={t('tour.close')}>×</button>
      </div>

      <div className="cg-tour-progress">
        <span className="cg-tour-progress-text">
          {currentStepIndex + 1} / {totalSteps}
        </span>
        <div className="cg-tour-progress-bar">
          <div
            className="cg-tour-progress-fill"
            style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="cg-tour-step-detail">
        <div className="cg-tour-step-layer" data-layer={currentStep.layer}>{layerLabel}</div>
        <div className="cg-tour-step-title">{currentStep.title}</div>
        <div className="cg-tour-step-description">{currentStep.description}</div>
        {currentStep.filePath && (
          <div className="cg-tour-step-path">{currentStep.filePath}</div>
        )}
        <div className="cg-tour-step-meta">
          {currentStep.dependencies.length > 0 && (
            <span className="cg-tour-meta-item">
              {t('tour.dependencies')}: {currentStep.dependencies.length}
            </span>
          )}
          {currentStep.dependents.length > 0 && (
            <span className="cg-tour-meta-item">
              {t('tour.dependents')}: {currentStep.dependents.length}
            </span>
          )}
        </div>
      </div>

      <div className="cg-tour-step-list">
        {tour.steps.map((step, index) => (
          <button
            key={step.id}
            className={`cg-tour-step-item ${index === currentStepIndex ? 'cg-active' : ''}`}
            onClick={() => handleStepClick(index)}
            aria-current={index === currentStepIndex ? 'step' : undefined}
          >
            <span className="cg-tour-step-number">{index + 1}</span>
            <span className="cg-tour-step-label">{step.title}</span>
            <span className="cg-tour-step-layer-badge" data-layer={step.layer}>{t(`tour.layer.${step.layer}`)}</span>
          </button>
        ))}
      </div>

      <div className="cg-tour-nav">
        <button
          className="cg-tour-nav-btn cg-tour-nav-prev"
          onClick={handlePrev}
          disabled={isFirst}
          aria-label={t('tour.prev')}
        >
          {t('tour.prev')}
        </button>
        <button
          className="cg-tour-nav-btn cg-tour-nav-next"
          onClick={handleNext}
          disabled={isLast}
          aria-label={t('tour.next')}
        >
          {t('tour.next')}
        </button>
      </div>
    </div>
  );
});