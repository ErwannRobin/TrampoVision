import { useMemo } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { POSITIONS, type BodyPosition } from '../skills/types';
import { Chart } from './Chart';
import { jumpMarkers, positionRuns, sequenceAxis, sequenceColumns } from './charts/decorations';
import { jumpSpecs } from './charts/specs';
import { usePlayheadTime, type Playhead } from './playhead';

interface Props {
  result: AnalysisResult;
  skills: SkillAnalysis;
  playhead: Playhead;
  /** Selected jump, 0-based. */
  selected: number;
}

const SHAPES: BodyPosition[] = ['straight', 'tuck', 'pike', 'unknown'];

/** Where the playhead is inside the jump (0 = takeoff, 1 = landing) and the body position of that frame. */
function Now({ result, skills, playhead, toX }: Omit<Props, 'selected'> & { toX: (seconds: number) => number }) {
  const time = usePlayheadTime(playhead);
  const x = toX(time);
  const now = POSITIONS[skills.frames.position[sampleIndexAt(result.meta, time)]];
  return (
    <>
      {x >= 0 && x <= 1 && <b className="jv__cursor" style={{ left: `${x * 100}%` }} />}
      <span className="jv__now">
        Now <span className="jv__now-shape">{now === 'unknown' ? 'between shapes' : now}</span>
      </span>
    </>
  );
}

/**
 * The jump chosen in the timeline in normalized time (0 = takeoff, 1 = landing): the same axes for every jump, so
 * jumps can be compared by eye. Every jump is resampled and measured in the athlete's own frame, so the curves do not
 * depend on the resolution, the position or the size of the athlete.
 */
export function JumpView({ result, skills, playhead, selected }: Props) {
  const jump = skills.jumps[Math.min(selected, skills.jumps.length - 1)];
  const seq = jump?.sequence ?? null;

  const view = useMemo(() => {
    if (!jump || !seq) return null;
    const cols = sequenceColumns(seq);
    const axis = sequenceAxis(seq);
    return {
      axis,
      runs: positionRuns(cols.position, cols.quality),
      specs: jumpSpecs(cols, axis, jumpMarkers(jump.cycle, seq), skills.config.position),
    };
  }, [jump, seq, skills.config.position]);

  if (!jump) return <p className="jv__empty">No jump detected, so there is nothing to show per jump.</p>;
  if (!seq || !view) {
    return (
      <p className="jv__empty">
        This jump is cut off by the start or the end of the clip, so it has no normalized sequence: its takeoff or its
        landing is missing.
      </p>
    );
  }

  return (
    <div className="jv">
      <div className="jv__strip">
        <span className="jv__label">Body position</span>
        <div className="jv__bar" role="img" aria-label="Body position over the jump">
          {view.runs.map((r, k) => (
            <i
              key={k}
              className={`jv__run jv__run--${r.position}${r.unsure ? ' jv__run--unsure' : ''}`}
              style={{ flexGrow: r.weight }}
              title={`${r.position === 'unknown' ? 'Between shapes' : r.position} from ${r.from.toFixed(2)} to ${r.to.toFixed(2)}${r.unsure ? ', pose unclear' : ''}`}
            />
          ))}
          <Now result={result} skills={skills} playhead={playhead} toX={view.axis.toX} />
        </div>
        <ul className="jv__legend">
          {SHAPES.map((s) => (
            <li key={s}>
              <i className={`jv__swatch jv__run--${s}`} />
              {s === 'unknown' ? 'Between shapes' : s}
            </li>
          ))}
          <li>
            <i className="jv__swatch jv__run--unknown jv__run--unsure" />
            Pose unclear
          </li>
        </ul>
      </div>

      <div className="jv__charts">
        {view.specs.map((spec) => (
          <Chart key={spec.id} {...spec} playhead={playhead} />
        ))}
      </div>
      <p className="jv__note">
        Every jump is resampled to {seq.samples} steps between takeoff and landing, and the joints are measured in the
        athlete's own frame in body lengths. Click a chart to move the video inside the jump.
      </p>
    </div>
  );
}
