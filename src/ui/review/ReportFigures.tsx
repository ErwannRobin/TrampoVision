import type { Metrics } from '../../dataset/metrics';
import { t } from '../../i18n';
import { pct } from '../format';
import { Stat } from '../kit';

interface Figure {
  label: string;
  value: string;
  hint?: string;
  lead?: boolean;
}

/** The headline numbers as one row of big figures separated by hairlines. Accuracy leads. */
export function ReportFigures({ overall: o }: { overall: Metrics['overall'] }) {
  const figures: Figure[] = [
    {
      label: t('report.accuracy'),
      value: pct(o.accuracy),
      hint: o.ci95 ? t('report.interval', { lo: pct(o.ci95.lo), hi: pct(o.ci95.hi) }) : undefined,
      lead: true,
    },
    { label: t('report.evaluated'), value: String(o.n), hint: t('report.knownLabel') },
    { label: t('report.balanced'), value: pct(o.balancedAccuracy), hint: t('report.meanRecall') },
    {
      label: t('report.answered'),
      value: pct(o.coverage),
      hint: t('report.answeredHint', { answered: o.answered, n: o.n, right: pct(o.accuracyWhenAnswered) }),
    },
    {
      label: t('report.wrongAt', { p: Math.round(o.confidentAt * 100) }),
      value: String(o.confidentWrong),
      hint: t('report.meanConfidence', { right: pct(o.meanConfidenceCorrect), wrong: pct(o.meanConfidenceWrong) }),
    },
  ];
  return (
    <div className="review-figures">
      <div className="review-figures__grid">
        {figures.map((f) => (
          <div key={f.label} className="review-figure">
            <Stat label={f.label} value={f.value} hint={f.hint} size={f.lead ? 'xl' : 'md'} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reasons not to over-read the numbers: a dashed edge, the mark of "we are not sure". */
export function ReportCaveats({ items }: { items: string[] }) {
  return (
    <ul className="review-caveats">
      {items.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
}
