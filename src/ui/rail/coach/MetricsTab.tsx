import { useMemo } from 'react';
import { sampleIndexAt } from '../../../analysis/lookup';
import type { AnalysisResult } from '../../../analysis/types';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { fmt } from '../../format';
import { cx } from '../../kit';
import { usePlayheadTime, type Playhead } from '../../playhead';
import { frameFigures, JUMP_COLUMNS, jumpFigures, jumpTable, type JumpTableRow } from './figures';
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

const NO_JUMP = 'No jump found: the center of mass never rose 0.3 m above its surroundings.';

/** Numbers at the playhead, for the selected jump, and for every jump of the clip. */
export function MetricsTab({ result, skills, selected, playhead, onSelect }: Props) {
  const k = Math.min(selected, skills.jumps.length - 1);
  const j = skills.jumps[k];
  const groups = useMemo(() => (j ? jumpFigures(j.features, result.meta) : []), [j, result.meta]);
  const table = useMemo(() => jumpTable(result.jumps.cycles), [result.jumps.cycles]);

  return (
    <>
      <AtThisFrame result={result} skills={skills} selected={selected} playhead={playhead} />
      {j ? (
        <>
          <Group title="This jump">
            {groups.map((g) => (
              <div key={g.title} className="coach__sub">
                <h4 className="coach__subheading">{g.title}</h4>
                <Rows rows={g.rows} />
              </div>
            ))}
          </Group>
          <Group title="All jumps">
            <JumpTable rows={table} selected={k} onSelect={onSelect} />
          </Group>
        </>
      ) : (
        <Group title="Jumps">
          <p className="coach__empty">{NO_JUMP}</p>
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
      title="At this frame"
      meta={
        <>
          <span className="num">Sample {i + 1}</span>
          <span className="num">{fmt(result.time[i], 3)} s</span>
        </>
      }
    >
      {!inJump && skills.jumps.length > 0 && <p className="coach__quiet">The playhead is outside this jump.</p>}
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
              {JUMP_COLUMNS.map((c) => (
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
                title="Go to the takeoff"
                onClick={() => onSelect(r.index)}
              >
                <td className="coach__td coach__td--lead">
                  <button
                    type="button"
                    className="coach__go"
                    aria-label={`Go to the takeoff of jump ${r.number}${r.complete ? '' : ', cut off by the clip'}`}
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
      {rows.some((r) => !r.complete) && <p className="coach__foot">* Cut off at the start or end of the clip.</p>}
    </>
  );
}
