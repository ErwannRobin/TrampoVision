import { useMemo, useState } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { POSITIONS } from '../skills/types';
import { Chart, type ChartAxis } from './Chart';
import { Playhead, usePlayheadTime } from './playhead';

interface Props {
  result: AnalysisResult;
  skills: SkillAnalysis;
  playhead: Playhead;
  selected: number;
  onSelect: (jump: number) => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const POSITION_COLOR: Record<(typeof POSITIONS)[number], string> = {
  straight: 'var(--series-1)',
  tuck: 'var(--series-2)',
  pike: '#8a5cd6',
  unknown: 'var(--grid)',
};

/** The jump chosen in the timeline, in normalized time (0 = takeoff, 1 = landing): the same curves for every jump. */
export function JumpView({ result, skills, playhead, selected, onSelect }: Props) {
  const [loop, setLoop] = useState(false);
  const jump = skills.jumps[selected];
  const seq = jump?.sequence ?? null;

  const cols = useMemo(() => {
    if (!seq) return null;
    const get = (name: string) => Float64Array.from(seq.data.map((row) => row[seq.columns.indexOf(name)]));
    return {
      u: get('u'),
      height: get('com_h_body'),
      xBed: get('com_x_bed'),
      xBody: get('com_x_body'),
      turns: get('orient_turns'),
      hip: get('hip_angle_deg'),
      knee: get('knee_angle_deg'),
      position: get('position'),
      quality: get('quality'),
    };
  }, [seq]);

  const axis = useMemo<ChartAxis | null>(
    () =>
      seq
        ? {
            toX: (s) => (s - seq.takeoffTimeS) / seq.durationS,
            toSeconds: (x) => seq.takeoffTimeS + x * seq.durationS,
            tick: (x) => x.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''),
          }
        : null,
    [seq],
  );

  if (skills.jumps.length === 0) return <p className="muted small">No jump detected, so there is nothing to show per jump.</p>;
  const cycle = jump.cycle;
  const markers = seq ? [{ t: 0, label: 'T' }, { t: (cycle.apexTimeS - seq.takeoffTimeS) / seq.durationS, label: 'A' }, { t: 1, label: 'L' }] : [];
  const useBed = cols ? cols.xBed.some(Number.isFinite) : false;
  const turnGuides: { value: number; label?: string }[] = [];
  if (cols) {
    const finite = Array.from(cols.turns).filter(Number.isFinite);
    if (finite.length) {
      const lo = Math.ceil(Math.min(...finite) * 2) / 2;
      const hi = Math.floor(Math.max(...finite) * 2) / 2;
      for (let v = lo; v <= hi + 1e-9 && turnGuides.length < 12; v += 0.5) turnGuides.push({ value: v, label: `${v} turn${Math.abs(v) === 1 ? '' : 's'}` });
    }
  }
  const P = skills.config.position;

  return (
    <section className="jumpview panel">
      <div className="jumpbar">
        <strong>Jump</strong>
        {skills.jumps.map((j) => (
          <button key={j.cycle.index} className={j.cycle.index === selected ? 'primary' : ''} onClick={() => onSelect(j.cycle.index)} title={j.prediction.summary}>
            {j.cycle.index + 1} · {j.prediction.skill === 'unclassified' && j.prediction.confidence === 0 ? 'not classified' : `${j.prediction.label} ${pct(j.prediction.confidence)}`}
          </button>
        ))}
        <span className="spacer" />
        <button
          onClick={() => playhead.playRange((cycle.takeoffTimeS ?? cycle.apexTimeS) - 0.4, (cycle.landingTimeS ?? cycle.apexTimeS) + 0.3, loop)}
          title="Play the selected jump with a little run-up and landing"
        >
          ▶ Play jump
        </button>
        <label className="check">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          loop
        </label>
      </div>

      {!seq || !cols || !axis ? (
        <p className="notice">This jump is cut off by the start or the end of the clip, so it has no normalized sequence. Its takeoff or landing is missing.</p>
      ) : (
        <>
          <PositionStrip position={cols.position} quality={cols.quality} axis={axis} playhead={playhead} result={result} skills={skills} />
          <div className="jumpcharts">
            <Chart title="COM height" unit="body lengths above the takeoff position" time={cols.u} playhead={playhead} axis={axis} decimals={2} minSpan={0.5} markers={markers} height={130}
              series={[{ label: 'Height', values: cols.height, color: '--series-1' }]} />
            <Chart
              title="COM horizontal"
              unit={useBed ? 'bed coordinates: ±1 = bed edge' : 'body lengths from the takeoff position'}
              time={cols.u} playhead={playhead} axis={axis} decimals={2} zeroLine minSpan={useBed ? 0.4 : 0.4} markers={markers} height={130}
              series={[{ label: 'x', values: useBed ? cols.xBed : cols.xBody, color: '--series-1' }]}
            />
            <Chart title="Body orientation" unit="turns since takeoff, + = clockwise" time={cols.u} playhead={playhead} axis={axis} decimals={2} zeroLine minSpan={0.5} guides={turnGuides} markers={markers} height={130}
              series={[{ label: 'Turns', values: cols.turns, color: '--series-1' }]} />
            <Chart
              title="Hip and knee angle"
              unit="°, 180 = straight"
              time={cols.u} playhead={playhead} axis={axis} decimals={0} minSpan={60} markers={markers} height={130}
              guides={[{ value: P.hipFoldedMaxDeg, label: 'hip folded' }, { value: P.kneeStraightMinDeg, label: 'legs straight' }]}
              series={[
                { label: 'Hip', values: cols.hip, color: '--series-1' },
                { label: 'Knee', values: cols.knee, color: '--series-2' },
              ]}
            />
          </div>
          <p className="hint muted">
            Every jump is resampled to {seq.samples} steps between takeoff and landing, joints are measured in the athlete's own frame in body lengths, so the curves do not
            depend on the resolution, the athlete's position or size. Click a chart to seek inside the jump.
          </p>
        </>
      )}
    </section>
  );
}

/** Body position frame by frame over the selected jump, with the live position at the playhead. */
function PositionStrip({ position, quality, axis, playhead, result, skills }: { position: Float64Array; quality: Float64Array; axis: ChartAxis; playhead: Playhead; result: AnalysisResult; skills: SkillAnalysis }) {
  const time = usePlayheadTime(playhead);
  const x = axis.toX(time);
  const now = POSITIONS[skills.frames.position[sampleIndexAt(result.meta, time)]];
  return (
    <div className="posstrip">
      <span className="muted small">Body position</span>
      <div className="posbar" role="img" aria-label="Body position over the jump">
        {Array.from(position).map((p, k) => (
          <i key={k} style={{ background: POSITION_COLOR[POSITIONS[p] ?? 'unknown'], opacity: quality[k] >= 0.5 ? 1 : 0.4 }} title={`${POSITIONS[p]} at ${(k / (position.length - 1)).toFixed(2)}`} />
        ))}
        {x >= 0 && x <= 1 && <b className="poscursor" style={{ left: `${x * 100}%` }} />}
      </div>
      <span className="legend mono small">
        {(['straight', 'tuck', 'pike', 'unknown'] as const).map((k) => (
          <span key={k} className="legend-item"><i className="swatch" style={{ background: POSITION_COLOR[k] }} />{k}</span>
        ))}
        <span className="muted">now: {now}</span>
      </span>
    </div>
  );
}
