
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, HeartIcon } from './Icons.tsx';


interface HealthScoreCardProps {
  onClose: () => void;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--cg-success)';
  if (score >= 60) return 'var(--cg-warning)';
  return 'var(--cg-error)';
}

function DimensionBar({ name, score, description }: { name: string; score: number; description: string }) {
  const t = useT();
  return (
    <div className="health-dimension">
      <div className="health-dimension-header">
        <span className="health-dimension-name">{t(`health.${name}`)}</span>
        <span className="health-dimension-score" style={{ color: scoreColor(score) }}>{score}</span>
      </div>
      <div className="health-dimension-bar">
        <div className="health-dimension-fill" style={{ width: `${score}%`, background: scoreColor(score) }} />
      </div>
      <div className="health-dimension-desc">{description}</div>
    </div>
  );
}

export function HealthScoreCard({ onClose }: HealthScoreCardProps) {
  const t = useT();
  const healthScore = useGraphStore((s) => s.healthScore);

  if (!healthScore) {
    return (
      <div className="health-score-card" role="region" aria-label={t('health.title')} aria-live="polite">
        <div className="health-score-header">
          <HeartIcon size={14} />
          <span>{t('health.title')}</span>
          <button onClick={onClose} aria-label={t('health.close')} className="cg-close-btn">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="health-score-empty">{t('health.noData')}</div>
      </div>
    );
  }

  const dimensions: { name: string; score: number; description: string }[] = [
    { name: 'coupling', score: healthScore.coupling, description: t('health.couplingDesc') },
    { name: 'cohesion', score: healthScore.cohesion, description: t('health.cohesionDesc') },
    { name: 'cyclicDependencyRate', score: healthScore.cyclicDependencyRate, description: t('health.cyclicDesc') },
    { name: 'modularity', score: healthScore.modularity, description: t('health.modularityDesc') },
  ];

  return (
    <div className="health-score-card" role="region" aria-label={t('health.title')} aria-live="polite">
      <div className="health-score-header">
        <HeartIcon size={14} />
        <span>{t('health.title')}</span>
        <button onClick={onClose} aria-label={t('health.close')} className="cg-close-btn">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="health-score-overall">
        <div className="health-score-circle" style={{ borderColor: scoreColor(healthScore.overall) }}>
          <span style={{ color: scoreColor(healthScore.overall) }}>{healthScore.overall}</span>
        </div>
        <span className="health-score-label">{t('health.overall')}</span>
      </div>
      <div className="health-dimensions">
        {dimensions.map((d) => (
          <DimensionBar key={d.name} name={d.name} score={d.score} description={d.description} />
        ))}
      </div>
    </div>
  );
}