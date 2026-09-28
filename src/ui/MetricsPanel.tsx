import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import { Playhead, usePlayheadTime } from './playhead';

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export function MetricsPanel({ result, playhead }: { result: AnalysisResult; playhead: Playhead }) {
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  const j = result.joints;
  const s = result.summary;
  const jointRows: [string, Float64Array, Float64Array][] = [
    ['Elbow', j.leftElbow, j.rightElbow],
    ['Shoulder', j.leftShoulder, j.rightShoulder],
    ['Hip', j.leftHip, j.rightHip],
    ['Knee', j.leftKnee, j.rightKnee],
  ];
  return (
    <div className="metrics">
      <h3>
        Current frame <span className="muted mono">#{i + 1} · {f(result.time[i], 3)} s</span>
      </h3>
      <dl className="mono">
        <dt>COM height</dt><dd>{f(result.height[i], 2)} m</dd>
        <dt>COM vertical velocity</dt><dd>{f(result.vy[i], 2)} m/s</dd>
        <dt>Trunk angle</dt><dd>{f(result.trunkAngle[i])}°</dd>
        <dt>Body-line angle</dt><dd>{f(result.lineAngle[i])}°</dd>
        <dt>Rotation</dt><dd>{f(result.rotation[i], 0)}° ({f(result.rotation[i] / 360, 2)} turns)</dd>
        <dt>Angular velocity</dt><dd>{f(result.angularVelocity[i], 0)}°/s</dd>
        <dt>Pose confidence</dt><dd>{f(result.confidence[i] * 100, 0)}%</dd>
      </dl>
      <table className="mono">
        <thead>
          <tr><th>Joint angle</th><th>Left</th><th>Right</th></tr>
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
      <h3>Clip summary</h3>
      <dl className="mono">
        <dt>Max COM height</dt><dd>{f(s.maxHeightM, 2)} m</dd>
        <dt>Peak up / down speed</dt><dd>{f(s.peakUpVelocity, 1)} / {f(s.peakDownVelocity, 1)} m/s</dd>
        <dt>Net rotation</dt><dd>{f(s.totalRotationDeg, 0)}° ({f(s.totalRotationDeg / 360, 2)} turns)</dd>
        <dt>Frames with pose</dt><dd>{f(s.validFraction * 100, 0)}%</dd>
        <dt>Scale</dt><dd>{f(result.meta.pixelsPerMeter, 0)} px/m (approx.)</dd>
      </dl>
    </div>
  );
}
