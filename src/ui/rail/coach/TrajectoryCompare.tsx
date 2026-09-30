import { formatNumber, t } from '../../../i18n';
import type { TemporalComparison } from '../../../skills/types';
import { sparkLayout } from '../../review/logic';

const WIDTH = 150;
const HEIGHT = 40;
/** The channels that read well as a curve; the sin / cos pair only serves the distance. */
const SHOWN = new Set(['somersault', 'twist', 'hip', 'knee', 'angVel', 'comHeight', 'shoulderHip']);

/** The detected jump (solid) against the closest reference (dashed), both on the jump's time axis, one small chart per trajectory. */
export function TrajectoryCompare({ comparison }: { comparison: TemporalComparison }) {
  const channels = comparison.channels.filter((c) => SHOWN.has(c.channel));
  if (!channels.length) return null;
  return (
    <div className="review-sparks">
      {channels.map((c) => {
        const all = [...c.detected, ...c.reference].filter(Number.isFinite);
        const lo = Math.min(...all);
        const hi = Math.max(...all);
        const pad = (hi - lo || 1) * 0.08;
        const domain: [number, number] = [lo - pad, hi + pad];
        const size = { width: WIDTH, height: HEIGHT };
        const detected = sparkLayout(c.detected, size, { domain });
        const reference = sparkLayout(c.reference, size, { domain });
        const off = c.distance === null ? '–' : t('ev.tolerances', { d: formatNumber(c.distance, 1) });
        return (
          <figure key={c.channel} className="review-spark">
            <figcaption className="review-spark__head">
              <span className="review-spark__title">{c.label}</span>
              <span className="review-spark__range num">{off}</span>
            </figcaption>
            <svg
              className="review-spark__svg"
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={t('trajectory.aria', { label: c.label, off })}
            >
              <rect className="review-spark__bg" x="0" y="0" width={WIDTH} height={HEIGHT} rx="4" />
              {reference && (
                <path className="review-spark__line review-spark__line--ref" d={reference.path} fill="none" />
              )}
              {detected && <path className="review-spark__line" d={detected.path} fill="none" />}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
