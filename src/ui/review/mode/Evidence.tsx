import type { JumpRecord } from '../../../dataset/types';
import { t } from '../../../i18n';
import { elementById } from '../../../skills/fig/elements';
import type { CheckStatus, ElementCandidate, SkillPrediction } from '../../../skills/types';
import { fmt, pct } from '../../format';
import { Badge, Button } from '../../kit';
import { Sparks } from '../Sparks';
import type { DataFlag } from './logic';

const CHECK_MARK: Record<CheckStatus, string> = { match: '✓', weak: '~', mismatch: '✗', unmeasured: '·' };
const STAGE_ABBR = {
  rotation: 'rm.abbr.somersaults',
  direction: 'rm.abbr.direction',
  twists: 'rm.abbr.twists',
  position: 'rm.abbr.position',
} as const;

/** The four question checks of a candidate in a fixed order; a candidate without somersaults has no direction check, shown as a blank. */
function Checks({ candidate }: { candidate: ElementCandidate }) {
  return (
    <span className="rm-checks">
      {(['rotation', 'direction', 'twists', 'position'] as const).map((stage) => {
        const c = candidate.checks.find((k) => k.stage === stage);
        if (!c) return <span key={stage} className="rm-check" data-status="none" aria-hidden="true" />;
        const status = t(`rm.check.${c.status}`);
        return (
          <span
            key={stage}
            className="rm-check"
            data-status={c.status}
            title={`${t(STAGE_ABBR[stage])}: ${c.expected}, ${c.observed} (${status})`}
            role="img"
            aria-label={`${c.criterion}: ${status}`}
          >
            {CHECK_MARK[c.status]}
          </span>
        );
      })}
    </span>
  );
}

/** The best candidates the classifier weighed, each with where it agrees with the measurement; one press says the jump was that one. */
export function Candidates({
  prediction,
  disabled,
  onUse,
}: {
  prediction: SkillPrediction;
  disabled: boolean;
  onUse: (candidate: ElementCandidate) => void;
}) {
  const list = (prediction.candidates ?? []).slice(0, 4);
  if (!list.length) return <p className="review-note">{t('rm.noCandidates')}</p>;
  return (
    <div className="rm-candidates">
      <div className="rm-candidate rm-candidate--head" aria-hidden="true">
        <span />
        <span className="rm-checks">
          {(['rotation', 'direction', 'twists', 'position'] as const).map((s) => (
            <span key={s} className="rm-check rm-check--head">
              {t(STAGE_ABBR[s])}
            </span>
          ))}
        </span>
        <span />
      </div>
      {list.map((c) => {
        const e = elementById(c.elementId);
        return (
          <div className="rm-candidate" key={c.elementId}>
            <span className="rm-candidate__name">
              {c.name}
              <span className="rm-candidate__meta num">
                {pct(c.score ?? c.posterior)}
                {e ? ` · ${fmt(e.difficulty, 1)}` : ''}
              </span>
            </span>
            <Checks candidate={c} />
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onUse(c)}>
              {t('rm.use')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** What each of the four questions measured in this jump, with the classifier's own probability for its best answer. */
export function Measured({ prediction }: { prediction: SkillPrediction }) {
  const stages = prediction.stages ?? [];
  if (!stages.length) return <p className="review-note">{t('rm.noStages')}</p>;
  return (
    <dl className="rm-measured">
      {stages.map((s) => (
        <div className="rm-measured__row" key={s.stage}>
          <dt>{s.title}</dt>
          <dd>
            <span className={s.measured ? undefined : 'faint'}>{s.measured ? s.observed : t('label.notMeasured')}</span>
            {s.measured && s.distribution[0] && (
              <span className="rm-measured__p num" title={t('rm.bestAnswer', { label: s.distribution[0].label })}>
                {pct(s.distribution[0].p)}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The data problems worth a second look before trusting the measurement, each in a sentence. */
export function Flags({ flags }: { flags: DataFlag[] }) {
  if (!flags.length) return <p className="review-note">{t('rm.flags.none')}</p>;
  return (
    <ul className="rm-flags">
      {flags.map((f) => (
        <li key={f.id} className="rm-flag" data-flag={f.id}>
          <Badge tone={f.id === 'twist' || f.id === 'facing' ? 'neutral' : 'warn'}>{t(`rm.flagTitle.${f.id}`)}</Badge>
          <span>
            {t(`rm.flag.${f.id}`, {
              deg: f.value === null ? '–' : fmt(f.value, 0),
              pct: f.value === null ? '–' : pct(f.value),
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Curves({ record }: { record: JumpRecord | undefined }) {
  return record ? <Sparks record={record} /> : null;
}
