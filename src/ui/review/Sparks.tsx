import type { JumpRecord } from '../../dataset/types';
import { t } from '../../i18n';
import { fmt } from '../format';
import { sparkLayout } from './logic';

const WIDTH = 150;
const HEIGHT = 40;

/** Hip angle, knee angle, rotation and height over the normalized jump, straight from the stored sequence. */
export function Sparks({ record }: { record: JumpRecord }) {
  const seq = record.sequence;
  if (!seq) return <p className="review-note">{t('fail.noSequence')}</p>;
  const col = (name: string) => seq.data.map((row) => row[seq.columns.indexOf(name)]);
  const { hipFoldedMaxDeg, kneeBentMaxDeg } = record.analysis.config.position;
  return (
    <div className="review-sparks">
      <Spark
        title={t('spark.hip')}
        values={col('hip_angle_deg')}
        unit="°"
        digits={0}
        domain={[0, 180]}
        guide={{ at: hipFoldedMaxDeg, text: t('spark.foldedAt', { n: hipFoldedMaxDeg }) }}
      />
      <Spark
        title={t('spark.knee')}
        values={col('knee_angle_deg')}
        unit="°"
        digits={0}
        domain={[0, 180]}
        guide={{ at: kneeBentMaxDeg, text: t('spark.bentAt', { n: kneeBentMaxDeg }) }}
      />
      <Spark title={t('spark.rotation')} values={col('orient_turns')} unit={` ${t('u.turns')}`} digits={2} />
      <Spark title={t('spark.height')} values={col('com_h_body')} unit={` ${t('u.bodyLengths')}`} digits={2} />
    </div>
  );
}

interface SparkProps {
  title: string;
  values: number[];
  unit: string;
  digits: number;
  domain?: [number, number];
  /** A threshold of the classifier, drawn as a dashed line and named under the curve. */
  guide?: { at: number; text: string };
}

function Spark({ title, values, unit, digits, domain, guide }: SparkProps) {
  const layout = sparkLayout(values, { width: WIDTH, height: HEIGHT }, { domain, guides: guide ? [guide.at] : [] });
  if (!layout) {
    return (
      <div className="review-spark">
        <div className="review-spark__head">
          <span className="review-spark__title">{title}</span>
          <span className="faint">{t('spark.noData')}</span>
        </div>
      </div>
    );
  }
  const range = t('spark.range', { min: fmt(layout.min, digits), max: fmt(layout.max, digits), unit });
  return (
    <figure className="review-spark">
      <figcaption className="review-spark__head">
        <span className="review-spark__title">{title}</span>
        <span className="review-spark__range num">{range}</span>
      </figcaption>
      <svg
        className="review-spark__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${title}, ${range}`}
      >
        <rect className="review-spark__bg" x="0" y="0" width={WIDTH} height={HEIGHT} rx="4" />
        {layout.guides.map((y) => (
          <line key={y} className="review-spark__guide" x1="2" x2={WIDTH - 2} y1={y} y2={y} />
        ))}
        <path className="review-spark__line" d={layout.path} fill="none" />
      </svg>
      {guide && layout.guides.length > 0 && (
        <p className="review-spark__note">{t('spark.dashed', { text: guide.text })}</p>
      )}
    </figure>
  );
}
