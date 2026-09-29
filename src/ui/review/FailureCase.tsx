import { flatRows } from '../../dataset/export';
import type { CheckStatus, Failure } from '../../dataset/failures';
import { PREDICTED_TEXT } from '../../dataset/metrics';
import { TRUTH_TEXT } from '../../dataset/types';
import { pct } from '../format';
import { Badge, Button, cx, Disclosure, Icon, type IconName } from '../kit';
import { checkCount } from './logic';
import { Sparks } from './Sparks';

const STATUS_ICON: Record<CheckStatus, IconName> = { ok: 'check', off: 'close', unknown: 'info' };
const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: 'agrees with the label',
  off: 'differs from what the label needs',
  unknown: 'no data',
};

interface FailureCaseProps {
  failure: Failure;
  open: boolean;
  /** The jump belongs to the video on screen. */
  canGoTo: boolean;
  onGoTo: (apexS: number) => void;
}

/** One jump where the label and the prediction differ: the label turned into measurable needs, next to what was measured. */
export function FailureCase({ failure: f, open, canGoTo, onGoTo }: FailureCaseProps) {
  const r = f.record;
  const p = r.prediction;
  const differing = f.checks.filter((c) => c.status === 'off').length;
  const features = flatRows(r);
  return (
    <Disclosure
      className="review-fail"
      defaultOpen={open}
      meta={checkCount(differing)}
      title={
        <span className="review-fail__title">
          <span className="review-fail__head">
            <span className="review-fail__file">{r.source.fileName}</span>
            <span className="review-fail__jump">Jump {r.jumpId}</span>
          </span>
          <span className="review-fail__what">
            <span>
              Labeled <span className="review-fail__value">{TRUTH_TEXT[f.truth]}</span>, predicted{' '}
              <span className="review-fail__value">{PREDICTED_TEXT[f.predicted]}</span> at{' '}
              <span className="num review-fail__value">{pct(f.confidence)}</span>
            </span>
            {f.lowConfidence ? <Badge tone="warn">Low confidence</Badge> : <Badge tone="danger">Confident</Badge>}
          </span>
        </span>
      }
    >
      <div className="review-fail__body">
        {canGoTo && (
          <div>
            <Button size="sm" icon="video" onClick={() => onGoTo(r.timestamps.apexS)}>
              Show this jump in the video
            </Button>
          </div>
        )}

        <div className="review-fail__grid">
          <section className="review-fail__part">
            <h5 className="review-subhead">Label against measurement</h5>
            <div className="review-scroll" role="region" aria-label="Label against measurement" tabIndex={0}>
              <table className="review-table review-table--checks">
                <thead>
                  <tr>
                    <th scope="col" className="review-cell review-cell--head review-cell--icon">
                      <span className="sr-only">Status</span>
                    </th>
                    <th scope="col" className="review-cell review-cell--head">
                      Signal
                    </th>
                    <th scope="col" className="review-cell review-cell--head">
                      The label needs
                    </th>
                    <th scope="col" className="review-cell review-cell--head">
                      Measured
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {f.checks.map((c) => (
                    <tr key={c.signal} className={cx(c.status === 'off' && 'review-check--differs')}>
                      <td
                        className={cx('review-cell review-cell--icon', `review-status--${c.status}`)}
                        title={STATUS_TEXT[c.status]}
                      >
                        <Icon name={STATUS_ICON[c.status]} size={15} strokeWidth={2.2} />
                        <span className="sr-only">{STATUS_TEXT[c.status]}</span>
                      </td>
                      <th scope="row" className="review-cell review-cell--row">
                        {c.signal}
                      </th>
                      <td className="review-cell">{c.expected}</td>
                      <td className="review-cell">{c.measured}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="review-note">
              A cross marks where the measurement differs from what the label needs. It does not say which one is right:
              check the video.
            </p>
          </section>

          <section className="review-fail__part">
            <h5 className="review-subhead">What the classifier saw</h5>
            <p className="review-fail__summary">{p.summary}</p>
            <ul className="review-rows">
              {p.evidence.map((e) => (
                <li key={e.key} className="review-row" title={e.note}>
                  <span className="review-row__label">{e.label}</span>
                  <span className="review-row__value num">{e.text}</span>
                </li>
              ))}
            </ul>
            {p.limitations.length > 0 && (
              <ul className="review-limits">
                {p.limitations.map((l) => (
                  <li key={l.signal + l.problem}>
                    <span className="review-fail__value">{l.signal}.</span> {l.problem} <em>Needed:</em> {l.needed}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <Sparks record={r} />

        <Disclosure title="All extracted features" meta={features.length}>
          <dl className="review-features">
            {features.map(([k, v]) => (
              <div key={k} className="review-row">
                <dt className="review-row__label">{k}</dt>
                <dd className="review-row__value num">{v}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      </div>
    </Disclosure>
  );
}
