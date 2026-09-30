import { useMemo } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import { formatNumber, lower, t, useLocale } from '../i18n';
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

/** A body shape as a word of the language in use ("tuck", "between shapes"). */
const shapeWord = (p: BodyPosition): string => (p === 'unknown' ? lower(t('fig.between')) : lower(t(`pos.${p}`)));

/** Where the playhead is inside the jump (0 = takeoff, 1 = landing) and the body position of that frame. */
function Now({ result, skills, playhead, toX }: Omit<Props, 'selected'> & { toX: (seconds: number) => number }) {
  const time = usePlayheadTime(playhead);
  const x = toX(time);
  const now = POSITIONS[skills.frames.position[sampleIndexAt(result.meta, time)]];
  return (
    <>
      {x >= 0 && x <= 1 && <b className="jv__cursor" style={{ left: `${x * 100}%` }} />}
      <span className="jv__now">
        {t('jv.now')} <span className="jv__now-shape">{shapeWord(now)}</span>
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
  const locale = useLocale();
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
  }, [jump, seq, skills.config.position, locale]); // oxlint-disable-line react-hooks/exhaustive-deps

  if (!jump) return <p className="jv__empty">{t('jv.empty')}</p>;
  if (!seq || !view) return <p className="jv__empty">{t('jv.cutOff')}</p>;

  return (
    <div className="jv">
      <div className="jv__strip">
        <span className="jv__label">{t('jv.bodyPosition')}</span>
        <div className="jv__bar" role="img" aria-label={t('jv.bodyPositionAria')}>
          {view.runs.map((r, k) => (
            <i
              key={k}
              className={`jv__run jv__run--${r.position}${r.unsure ? ' jv__run--unsure' : ''}`}
              style={{ flexGrow: r.weight }}
              title={t(r.unsure ? 'jv.runUnsure' : 'jv.run', {
                shape: shapeWord(r.position),
                from: formatNumber(r.from, 2),
                to: formatNumber(r.to, 2),
              })}
            />
          ))}
          <Now result={result} skills={skills} playhead={playhead} toX={view.axis.toX} />
        </div>
        <ul className="jv__legend">
          {SHAPES.map((s) => (
            <li key={s}>
              <i className={`jv__swatch jv__run--${s}`} />
              {shapeWord(s)}
            </li>
          ))}
          <li>
            <i className="jv__swatch jv__run--unknown jv__run--unsure" />
            {t('jv.poseUnclear')}
          </li>
        </ul>
      </div>

      <div className="jv__charts">
        {view.specs.map((spec) => (
          <Chart key={spec.id} {...spec} playhead={playhead} />
        ))}
      </div>
      <p className="jv__note">{t('jv.note', { n: seq.samples })}</p>
    </div>
  );
}
