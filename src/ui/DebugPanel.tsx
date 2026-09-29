import { GRAVITY, JUMP_PHASES } from '../analysis/jumpCycles';
import { sampleIndexAt } from '../analysis/lookup';
import { JOINT_STATE_NAMES } from '../analysis/stabilize';
import { JOINT_NAMES, type AnalysisResult } from '../analysis/types';
import { Playhead, usePlayheadTime } from './playhead';

/** Fixed decimals, never "-0.00". */
const f = (v: number | null | undefined, d = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const s = v.toFixed(d);
  return Number(s) === 0 ? (0).toFixed(d) : s;
};
const signed = (v: number, d = 2) => {
  if (!Number.isFinite(v)) return '–';
  const s = Math.abs(v).toFixed(d);
  return Number(s) === 0 ? s : `${v < 0 ? '−' : '+'}${s}`;
};

/** Things the user should double-check before trusting the numbers. */
export function analysisWarnings(result: AnalysisResult): string[] {
  const { meta, jumps, summary } = result;
  const out: string[] = [];
  if (meta.calibrationError) out.push(`Calibration ignored: ${meta.calibrationError}`);
  if (meta.calibrated) {
    const ratio = meta.trampolinePixelsPerMeter / meta.athletePixelsPerMeter;
    if (Number.isFinite(ratio) && (ratio < 0.75 || ratio > 1.33)) {
      out.push(
        `The bed and the athlete give scales ${Math.round(Math.abs(ratio - 1) * 100)}% apart. Check the corners, the bed size, the athlete height, and that the athlete stays over the bed.`,
      );
    }
    if (meta.viewAngleDeg > 60)
      out.push(
        'The camera looks along the long side of the bed: horizontal displacement is measured across the bed only.',
      );
  }
  const g = jumps.cycles.map((c) => c.impliedGravityMps2).filter((v): v is number => v !== null && Number.isFinite(v));
  if (g.length) {
    const mean = g.reduce((s, v) => s + v, 0) / g.length;
    if (Math.abs(mean / GRAVITY - 1) > 0.15)
      out.push(
        `Free-fall check: ${mean.toFixed(1)} m/s² instead of 9.81, so meters and m/s may be about ${Math.round(Math.abs(mean / GRAVITY - 1) * 100)}% off.`,
      );
  }
  if (meta.maxRotationStepDeg > 120)
    out.push(
      'Body orientation changes by more than 120° between two samples: rotations may be undercounted. Analyze every frame.',
    );
  if (summary.validFraction < 0.8)
    out.push(`The center of mass is missing in ${Math.round((1 - summary.validFraction) * 100)}% of the frames.`);
  if (jumps.cycles.some((c) => !c.complete))
    out.push('A jump is cut off at the start or end of the clip: its takeoff or landing is unknown.');
  return out;
}

export function DebugPanel({ result, playhead }: { result: AnalysisResult; playhead: Playhead }) {
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  const { meta, jumps, summary } = result;
  const phase = JUMP_PHASES[jumps.phase[i]];
  const jump = jumps.cycleIndex[i];
  const counts = JOINT_STATE_NAMES.map((_, s) => result.jointState.reduce((n, st) => n + (st[i] === s ? 1 : 0), 0));
  const j = result.joints;
  const jointRows: [string, Float64Array, Float64Array][] = [
    ['Elbow', j.leftElbow, j.rightElbow],
    ['Shoulder', j.leftShoulder, j.rightShoulder],
    ['Hip', j.leftHip, j.rightHip],
    ['Knee', j.leftKnee, j.rightKnee],
  ];
  const warnings = analysisWarnings(result);
  const stats = result.stabilizeStats;
  const total = stats.measured + stats.interpolated + stats.corrected + stats.missing;
  const gs = jumps.cycles.map((c) => c.impliedGravityMps2).filter((v): v is number => v !== null && Number.isFinite(v));
  const turns = jumps.turnsSinceTakeoff[i];
  const displacement = meta.calibrated ? 'Displacement from bed center' : 'Displacement from start';

  return (
    <div className="metrics debug">
      <h3>
        Analysis panel{' '}
        <span className="muted mono">
          #{i + 1} · {f(result.time[i], 3)} s
        </span>
      </h3>
      <dl className="mono">
        <dt>Jump phase</dt>
        <dd>
          <span className={`phase phase-${phase}`}>{phase}</span>
          {jump >= 0 && <span className="muted"> · jump {jump + 1}</span>}
        </dd>
        <dt>Center of mass (px)</dt>
        <dd>
          {f(result.comX[i], 0)}, {f(result.comY[i], 0)}
        </dd>
        <dt>Height {meta.heightReference === 'bed' ? 'above bed' : 'above lowest point'}</dt>
        <dd>{f(result.height[i], 2)} m</dd>
        <dt>Vertical velocity</dt>
        <dd>{signed(result.vy[i])} m/s</dd>
        <dt title="Horizontal, along the on-screen horizontal; + = right in the image">{displacement}</dt>
        <dd>
          {signed(result.x[i])} m
          {meta.calibrated && (
            <span className="muted" title="Percent of the half-size of the bed">
              {' '}
              ({signed(result.xNorm[i] * 100, 0)}%)
            </span>
          )}
        </dd>
        <dt title="Trunk angle from vertical-up, wrapped to ±180°, + = clockwise">Body angle</dt>
        <dd>{f(result.trunkAngle[i])}°</dd>
        <dt title="The same angle made continuous: it keeps counting past 360°">Orientation (continuous)</dt>
        <dd>{f(result.orientation[i])}°</dd>
        <dt>Rotation count</dt>
        <dd>
          {f(turns, 2)} turns · {jumps.completedRotations[i]} done
        </dd>
        <dt>Angular velocity</dt>
        <dd>{f(result.angularVelocity[i], 0)}°/s</dd>
        <dt>Pose confidence</dt>
        <dd>{f(result.confidence[i] * 100, 0)}%</dd>
        <dt>Joints this frame</dt>
        <dd title="measured / interpolated / corrected (glitch replaced) / missing">
          {counts[1]} / {counts[2]} / {counts[3]} / {counts[0]}
        </dd>
      </dl>

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <h3>Jumps</h3>
      {jumps.cycles.length === 0 ? (
        <p className="muted small">No jump found (the center of mass never rose {`> 0.3 m`}).</p>
      ) : (
        <table className="mono jumps">
          <thead>
            <tr>
              <th>#</th>
              <th title="Time in the air">Flight s</th>
              <th title="Time from takeoff to apex">To apex s</th>
              <th title="Highest point of the center of mass">Max h m</th>
              <th title="Vertical speed at takeoff">Vy↑ m/s</th>
              <th title="Landing minus takeoff position">Δx m</th>
              <th title="Body rotation in the air, in turns">Turns</th>
              <th title="Whole somersaults completed">Done</th>
            </tr>
          </thead>
          <tbody>
            {jumps.cycles.map((c) => (
              <tr
                key={c.index}
                className={c.index === jump ? 'current' : ''}
                onClick={() => playhead.seek(c.takeoffTimeS ?? c.apexTimeS)}
                title="Click to jump to the takeoff"
              >
                <td>
                  {c.index + 1}
                  {!c.complete && '*'}
                </td>
                <td>{f(c.flightTimeS, 2)}</td>
                <td>{f(c.timeToApexS, 2)}</td>
                <td>{f(c.apexHeightM, 2)}</td>
                <td>{f(c.takeoffVyMps, 1)}</td>
                <td>{f(c.horizontalDisplacementM, 2)}</td>
                <td>{f(c.turns, 2)}</td>
                <td>{c.completedRotations ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {jumps.cycles.some((c) => !c.complete) && (
        <p className="muted small">* cut off at the start or end of the clip</p>
      )}

      <h3>Data quality</h3>
      <dl className="mono">
        <dt>Scale</dt>
        <dd>
          {f(meta.pixelsPerMeter, 0)} px/m ·{' '}
          {meta.scaleSource === 'trampoline' ? 'from the bed' : 'from athlete height'}
        </dd>
        {meta.calibrated && (
          <>
            <dt>Bed vs. athlete scale</dt>
            <dd>
              {f(meta.trampolinePixelsPerMeter, 0)} vs {f(meta.athletePixelsPerMeter, 0)} px/m
            </dd>
          </>
        )}
        <dt>Free-fall check</dt>
        <dd title="Acceleration fitted to the middle of each flight. It should be 9.81 m/s².">
          {gs.length ? `${f(gs.reduce((s, v) => s + v, 0) / gs.length, 2)} m/s²` : '–'}
        </dd>
        <dt>Frames with a center of mass</dt>
        <dd>{f(summary.validFraction * 100, 0)}%</dd>
        <dt>Glitches removed</dt>
        <dd>
          {stats.spikesRejected} joint samples · {stats.jumpFrames} frames
        </dd>
        <dt>Joint samples filled in</dt>
        <dd>{f(((stats.interpolated + stats.corrected) / Math.max(1, total)) * 100, 1)}%</dd>
        <dt>Joint samples missing</dt>
        <dd>{f((stats.missing / Math.max(1, total)) * 100, 1)}%</dd>
        <dt>Net rotation of the clip</dt>
        <dd>
          {f(summary.totalRotationDeg, 0)}° ({f(summary.totalRotationDeg / 360, 2)} turns)
        </dd>
      </dl>

      <details>
        <summary>Joint angles</summary>
        <table className="mono">
          <thead>
            <tr>
              <th>Joint angle</th>
              <th>Left</th>
              <th>Right</th>
            </tr>
          </thead>
          <tbody>
            {jointRows.map(([name, l, r]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{f(l[i])}°</td>
                <td>{f(r[i])}°</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Also exported: {JOINT_NAMES.length} joint angles per frame in the CSV.</p>
      </details>
    </div>
  );
}
