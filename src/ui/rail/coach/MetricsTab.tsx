import { useMemo } from 'react';
import { sampleIndexAt } from '../../../analysis/lookup';
import type { AnalysisResult } from '../../../analysis/types';
import { t, useLocale } from '../../../i18n';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { fmt } from '../../format';
import { cx } from '../../kit';
import { usePlayheadTime, type Playhead } from '../../playhead';
import { frameFigures, jumpColumns, jumpFigures, jumpTable, type JumpTableRow } from './figures';
import { Group, Rows } from './parts';

interface Props {
  result: AnalysisResult;
  skills: SkillAnalysis;
  /** Selected jump, 0-based. */
  selected: number;
  playhead: Playhead;
  /** Select a jump and move the video to its takeoff. */
  onSelect: (jump: number) => void;
}

/** Numbers at the playhead, for the selected jump, and for every jump of the clip. */
export function MetricsTab({ result, skills, selected, playhead, onSelect }: Props) {
  const locale = useLocale();
  const k = Math.min(selected, skills.jumps.length - 1);
  const j = skills.jumps[k];
  const groups = useMemo(() => (j ? jumpFigures(j.features, result.meta) : []), [j, result.meta, locale]); // oxlint-disable-line react-hooks/exhaustive-deps
  const table = useMemo(() => jumpTable(result.jumps.cycles), [result.jumps.cycles]);

  return (
    <>
      <AtThisFrame result={result} skills={skills} selected={selected} playhead={playhead} />
      {j ? (
        <>
          <Group title={t('coach.thisJump')}>
            {groups.map((g) => (
              <div key={g.title} className="coach__sub">
                <h4 className="coach__subheading">{g.title}</h4>
                <Rows rows={g.rows} />
              </div>
            ))}
          </Group>
          <Group title={t('coach.allJumps')}>
            <JumpTable rows={table} selected={k} onSelect={onSelect} />
          </Group>
        </>
      ) : (
        <Group title={t('coach.jumps')}>
          <p className="coach__empty">{t('coach.noJump')}</p>
        </Group>
      )}
    </>
  );
}

/** The only part that follows the playhead: the rest of the tab stays still during playback. */
function AtThisFrame({ result, skills, selected, playhead }: Omit<Props, 'onSelect'>) {
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  const { inJump, blocks } = frameFigures(result, skills, selected, i);
  return (
    <Group
      title={t('coach.atFrame')}
      meta={
        <>
          <span className="num">{t('coach.sample', { n: i + 1 })}</span>
          <span className="num">{fmt(result.time[i], 3)} s</span>
        </>
      }
    >
      {!inJump && skills.jumps.length > 0 && <p className="coach__quiet">{t('coach.outsideJump')}</p>}
      {blocks.map((rows, n) => (
        <Rows key={n} rows={rows} />
      ))}
    </Group>
  );
}

function JumpTable({
  rows,
  selected,
  onSelect,
}: {
  rows: JumpTableRow[];
  selected: number;
  onSelect: (jump: number) => void;
}) {
  return (
    <>
      <div className="coach__scroll">
        <table className="coach__table">
          <thead>
            <tr>
              <th scope="col" className="coach__th coach__th--lead">
                #
              </th>
              {jumpColumns().map((c) => (
                <th key={c.label} scope="col" className="coach__th" title={c.title}>
                  {c.label}
                  {c.unit && <span className="coach__thu num">{c.unit}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.index}
                className={cx('coach__tr', r.index === selected && 'coach__tr--on')}
                aria-current={r.index === selected ? 'true' : undefined}
                title={t('coach.goTakeoff')}
                onClick={() => onSelect(r.index)}
              >
                <td className="coach__td coach__td--lead">
                  <button
                    type="button"
                    className="coach__go"
                    aria-label={t(r.complete ? 'coach.goTakeoffOf' : 'coach.goTakeoffOfCut', { n: r.number })}
                  >
                    <span className="num">{r.number}</span>
                    {!r.complete && <span aria-hidden="true">*</span>}
                  </button>
                </td>
                {r.cells.map((c, n) => (
                  <td key={n} className="coach__td num">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => !r.complete) && <p className="coach__foot">{t('coach.cutOffFoot')}</p>}
    </>
  );
}
