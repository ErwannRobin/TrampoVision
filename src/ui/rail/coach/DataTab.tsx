import { useMemo } from 'react';
import { sampleIndexAt } from '../../../analysis/lookup';
import { JOINT_NAMES, type AnalysisResult } from '../../../analysis/types';
import { t, useLocale } from '../../../i18n';
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
  const locale = useLocale();
  const quality = useMemo(() => dataQualityRows(result), [result, locale]); // oxlint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Group title={t('coach.warnings')}>
        {notes.length > 0 ? (
          <ul className="coach__notes">
            {notes.map((n) => (
              <li key={n} className="coach__warning">
                {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="coach__quiet">{t('coach.noWarnings')}</p>
        )}
      </Group>
      <Group title={t('coach.dataQuality')}>
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
    <Group title={t('coach.jointAngles')} meta={<span className="num">{t('coach.sample', { n: i + 1 })}</span>}>
      <table className="coach__table">
        <thead>
          <tr>
            <th scope="col" className="coach__th coach__th--lead">
              {t('coach.jointAngle')}
            </th>
            <th scope="col" className="coach__th">
              <span className="coach__glyph coach__glyph--lift" aria-hidden="true" />
              {t('coach.left')}
            </th>
            <th scope="col" className="coach__th">
              <span className="coach__glyph coach__glyph--drop" aria-hidden="true" />
              {t('coach.right')}
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
      <p className="coach__foot">{t('coach.alsoExported', { n: JOINT_NAMES.length })}</p>
    </Group>
  );
}
