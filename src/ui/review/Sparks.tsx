import type { JumpRecord } from '../../dataset/types';
import { fmt } from '../format';
import { sparkLayout } from './logic';

const WIDTH = 150;
const HEIGHT = 40;

/** Hip angle, knee angle, rotation and height over the normalized jump, straight from the stored sequence. */
export function Sparks({ record }: { record: JumpRecord }) {
  const seq = record.sequence;
  if (!seq) return <p className="review-note">This jump was cut off by the clip: no sequence.</p>;
  const col = (name: string) => seq.data.map((row) => row[seq.columns.indexOf(name)]);
  const { hipFoldedMaxDeg, kneeBentMaxDeg } = record.analysis.config.position;
  return (
    <div className="review-sparks">
      <Spark
        title="Hip angle"
        values={col('hip_angle_deg')}
        unit="°"
        digits={0}
        domain={[0, 180]}
        guide={{ at: hipFoldedMaxDeg, text: `folded at ${hipFoldedMaxDeg}° or less` }}
      />
      <Spark
        title="Knee angle"
        values={col('knee_angle_deg')}
        unit="°"
        digits={0}
        domain={[0, 180]}
        guide={{ at: kneeBentMaxDeg, text: `bent at ${kneeBentMaxDeg}° or less` }}
      />
      <Spark title="Rotation since takeoff" values={col('orient_turns')} unit=" turns" digits={2} />
      <Spark title="Center of mass height" values={col('com_h_body')} unit=" body lengths" digits={2} />
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
          <span className="faint">No data</span>
        </div>
      </div>
    );
  }
  const range = `${fmt(layout.min, digits)} to ${fmt(layout.max, digits)}${unit}`;
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
      {guide && layout.guides.length > 0 && <p className="review-spark__note">Dashed line: {guide.text}</p>}
    </figure>
  );
}
