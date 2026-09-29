import { useMemo } from 'react';
import { sampleIndexAt } from '../../../analysis/lookup';
import { JOINT_NAMES, type AnalysisResult } from '../../../analysis/types';
import { usePlayheadTime, type Playhead } from '../../playhead';
import { dataQualityRows, jointAngleRows } from './figures';
import { Group, Rows } from './parts';

interface Props {
  result: AnalysisResult;
  /** Things worth double-checking before trusting the numbers (from analysisWarnings). */
  notes: string[];
  playhead: Playhead;
}

/** What to double-check, how far the numbers can be trusted, and the joint angles at the playhead. */
export function DataTab({ result, notes, playhead }: Props) {
  const quality = useMemo(() => dataQualityRows(result), [result]);
  return (
    <>
      <Group title="Warnings">
        {notes.length > 0 ? (
          <ul className="coach__notes">
            {notes.map((n) => (
              <li key={n} className="coach__warning">
                {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="coach__quiet">No warnings for this analysis.</p>
        )}
      </Group>
      <Group title="Data quality">
        <Rows rows={quality} />
      </Group>
      <JointAngles result={result} playhead={playhead} />
    </>
  );
}

/** The only part of the tab that follows the playhead. */
function JointAngles({ result, playhead }: { result: AnalysisResult; playhead: Playhead }) {
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  return (
    <Group title="Joint angles" meta={<span className="num">Sample {i + 1}</span>}>
      <table className="coach__table">
        <thead>
          <tr>
            <th scope="col" className="coach__th coach__th--lead">
              Joint angle
            </th>
            <th scope="col" className="coach__th">
              <span className="coach__glyph coach__glyph--lift" aria-hidden="true" />
              Left
            </th>
            <th scope="col" className="coach__th">
              <span className="coach__glyph coach__glyph--drop" aria-hidden="true" />
              Right
            </th>
          </tr>
        </thead>
        <tbody>
          {jointAngleRows(result, i).map((r) => (
            <tr key={r.name} className="coach__tr">
              <th scope="row" className="coach__td coach__td--lead coach__td--name">
                {r.name}
              </th>
              <td className="coach__td num">{r.left}</td>
              <td className="coach__td num">{r.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="coach__foot">Also exported: {JOINT_NAMES.length} joint angles per frame in the CSV.</p>
    </Group>
  );
}
