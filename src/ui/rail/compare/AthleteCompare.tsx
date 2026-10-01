import { useMemo, type CSSProperties } from 'react';
import { t, useLocale } from '../../../i18n';
import { Chart } from '../../Chart';
import { fmt } from '../../format';
import { cx } from '../../kit';
import type { Playhead } from '../../playhead';
import { ATHLETE_SERIES, compareJumpRows, compareStats, type AthleteView } from './compare';

interface Props {
  athletes: AthleteView[];
  playhead: Playhead;
}

const columns = (n: number): CSSProperties => ({ '--cols': n }) as CSSProperties;

/**
 * The athletes of a clip next to each other: the summary figures, the height of each over time on one chart, and the
 * n-th jump of everybody on one row. Every value is read from the athlete's own analysis.
 */
export function AthleteCompare({ athletes, playhead }: Props) {
  const locale = useLocale();
  const stats = useMemo(() => compareStats(athletes), [athletes, locale]); // oxlint-disable-line react-hooks/exhaustive-deps
  const jumps = useMemo(() => compareJumpRows(athletes), [athletes, locale]); // oxlint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(
    () =>
      athletes.map((a, i) => ({
        label: t('stage.athlete', { n: i + 1 }),
        values: a.result.height,
        color: ATHLETE_SERIES[i % ATHLETE_SERIES.length],
      })),
    [athletes, locale], // oxlint-disable-line react-hooks/exhaustive-deps
  );
  const style = columns(athletes.length);

  return (
    <div className="cmp">
      <section className="ins-section cmp__section">
        <h3 className="ins-h">{t('compare.title')}</h3>
        <div className="cmp__grid cmp__grid--head" style={style}>
          <span />
          {athletes.map((_, i) => (
            <span key={i} className="cmp__who">
              <i className="cmp__swatch" style={{ background: `var(${ATHLETE_SERIES[i % ATHLETE_SERIES.length]})` }} />
              {t('stage.athlete', { n: i + 1 })}
            </span>
          ))}
        </div>
        {stats.map((s) => (
          <div key={s.key} className="cmp__grid cmp__row" style={style}>
            <span className="cmp__label">{s.label}</span>
            {s.values.map((v, i) => (
              <span key={i} className={cx('cmp__value num', s.best === i && 'cmp__value--best')}>
                {fmt(v, s.decimals)}
                {s.unit && Number.isFinite(v) && <span className="cmp__unit">{s.unit}</span>}
              </span>
            ))}
          </div>
        ))}
      </section>

      <section className="ins-section cmp__section">
        <Chart
          title={t('compare.heightChart')}
          unit="m"
          time={athletes[0].result.time}
          series={series}
          playhead={playhead}
          decimals={2}
          height={170}
        />
      </section>

      <section className="ins-section cmp__section">
        <h3 className="ins-h">{t('compare.jumpsTitle')}</h3>
        {jumps.length === 0 && <p className="ins-quiet">{t('compare.noJumps')}</p>}
        {jumps.map((row) => (
          <div key={row.number} className="cmp__grid cmp__row cmp__row--jump" style={style}>
            <span className="cmp__label num">{row.number}</span>
            {row.cells.map((c, i) => (
              <span key={i} className="cmp__cell">
                {c ? (
                  <>
                    <span className={cx('cmp__skill', `cmp__skill--${c.tier}`)}>{c.label}</span>
                    <span className="cmp__sub num">{fmt(c.heightM, 2)} m</span>
                  </>
                ) : (
                  <span className="cmp__sub">{fmt(null)}</span>
                )}
              </span>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
