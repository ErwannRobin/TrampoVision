import type { Metrics } from '../../dataset/metrics';
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
      label: 'Accuracy',
      value: pct(o.accuracy),
      hint: o.ci95 ? `95% interval ${pct(o.ci95.lo)}–${pct(o.ci95.hi)}` : undefined,
      lead: true,
    },
    { label: 'Jumps evaluated', value: String(o.n), hint: 'known label' },
    { label: 'Balanced accuracy', value: pct(o.balancedAccuracy), hint: 'mean recall per class' },
    {
      label: 'Answered',
      value: pct(o.coverage),
      hint: `${o.answered} of ${o.n}; right when answered: ${pct(o.accuracyWhenAnswered)}`,
    },
    {
      label: `Wrong at ≥${Math.round(o.confidentAt * 100)}%`,
      value: String(o.confidentWrong),
      hint: `mean confidence right ${pct(o.meanConfidenceCorrect)}, wrong ${pct(o.meanConfidenceWrong)}`,
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
