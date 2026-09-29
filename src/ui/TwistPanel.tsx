import { useEffect, useState } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import { describeSupport, probeCapabilities, type Capabilities } from '../pose3d/capabilities';
import type { TwistAnalysis } from '../pose3d/twist';
import { Playhead, usePlayheadTime } from './playhead';

const pct = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
const f = (v: number | null | undefined, d = 0, unit = '') =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : `${v.toFixed(d)}${unit}`;
const signed = (v: number | null, d = 0) => {
  if (v === null || !Number.isFinite(v)) return '–';
  const text = Math.abs(v).toFixed(d);
  return Number(text) === 0 ? `${text}°` : `${v > 0 ? '+' : '−'}${text}°`;
};

const PART_LABELS: Record<string, string> = {
  rounding: 'Close to a whole number of half twists',
  coverage: 'Shoulders and hips found in 3D',
  steps: 'No jumps between frames (left/right swaps)',
  monotonic: 'Turns one way only',
  shoulderHip: 'Shoulders and hips agree',
  axisDepth: 'Same answer with the axis kept in the image plane',
  depth: 'Constant 3D shoulder width',
};

interface Props {
  result: AnalysisResult;
  twist: TwistAnalysis;
  hasWorld: boolean;
  selected: number;
  onSelect: (k: number) => void;
  playhead: Playhead;
  /** The annotator's count of half twists for the selected jump, if any. */
  annotation: number | null;
  onAnnotate: (halfTwists: number | null) => void;
  canAnnotate: boolean;
}

/** Twist of the selected jump: the number (or the reason there is none), the checks behind it, and what the 3D data cannot tell. */
export function TwistPanel({
  result,
  twist,
  hasWorld,
  selected,
  onSelect,
  playhead,
  annotation,
  onAnnotate,
  canAnnotate,
}: Props) {
  const time = usePlayheadTime(playhead);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    void probeCapabilities().then(setCaps);
  }, []);
  const n = twist.jumps.length;
  const k = Math.min(selected, Math.max(0, n - 1));
  const e = twist.jumps[k];
  const i = sampleIndexAt(result.meta, time);
  const fr = twist.frames;
  const nowAngle =
    fr && result.jumps.cycles[k]?.takeoff !== null && result.jumps.cycles[k]
      ? fr.angle[i] - fr.angle[result.jumps.cycles[k].takeoff!]
      : NaN;
  const support = caps ? describeSupport(caps, hasWorld) : null;
  const maxRate = 90 * result.meta.fps;

  return (
    <div className="metrics skill">
      <h3>
        Twist (experimental)
        <span className="muted mono">
          {n > 1 && (
            <>
              <button className="tiny" disabled={k === 0} onClick={() => onSelect(k - 1)} aria-label="Previous jump">
                ‹
              </button>{' '}
              jump {k + 1} / {n}{' '}
              <button className="tiny" disabled={k === n - 1} onClick={() => onSelect(k + 1)} aria-label="Next jump">
                ›
              </button>
            </>
          )}
        </span>
      </h3>

      {n === 0 ? (
        <p className="muted small">No jump found, so there is no twist to measure.</p>
      ) : !e.available ? (
        <div className="skillcard weak">
          <div className="skillname">Twist: not measured</div>
          <p className="small">{e.limitations[0]?.problem}</p>
          <p className="small">
            <em>Needed:</em> {e.limitations[0]?.needed}
          </p>
        </div>
      ) : (
        <div className={`skillcard ${e.reliable ? 'good' : 'weak'}`}>
          {e.reliable ? (
            <>
              <div className="skillname">
                ≈ {e.twists} twist{e.twists === 1 ? '' : 's'} ({e.halfTwists} half twist{e.halfTwists === 1 ? '' : 's'})
              </div>
              <div className="skillconf">Consistency: {pct(e.confidence)}</div>
            </>
          ) : (
            <>
              <div className="skillname">Twist: not reliable</div>
              <div className="skillconf">
                Consistency: {pct(e.confidence)} (below {pct(twist.config.minConfidence)})
              </div>
              <p className="small">
                The raw value below is shown for inspection only. Do not read it as a measurement.
              </p>
            </>
          )}
          <div className="confbar" aria-hidden>
            <div style={{ width: pct(e.confidence) }} />
          </div>
          <p className="muted small">
            Consistency = how well the 3D data agrees with itself (the checks below multiplied). It is{' '}
            <strong>not</strong> a probability of being right: it has not been compared with real twists yet. Use the
            annotation at the bottom to do that.
          </p>
        </div>
      )}

      {e.available && (
        <>
          <h3>{e.reliable ? 'Measured' : 'Raw values (not reliable)'}</h3>
          <dl className="mono">
            <dt>Net twist, takeoff to landing</dt>
            <dd>
              {signed(e.totalDeg)} ({e.totalDeg === null ? '–' : `${Math.abs(e.totalDeg / 360).toFixed(2)} turns`})
            </dd>
            <dt>Estimated half twists</dt>
            <dd>{e.halfTwists ?? '–'}</dd>
            <dt>Direction</dt>
            <dd>
              {e.direction === 'none'
                ? 'none'
                : e.direction === 'positive'
                  ? '+ (counter-clockwise from above the head)'
                  : '− (clockwise from above the head)'}
            </dd>
            <dt>Peak twist speed</dt>
            <dd>{f(e.peakAngularVelocityDps, 0, ' °/s')}</dd>
            <dt>Mean twist speed</dt>
            <dd>{f(e.meanAbsAngularVelocityDps, 0, ' °/s')}</dd>
            <dt>Twist since takeoff, now</dt>
            <dd>{Number.isFinite(nowAngle) ? signed(nowAngle) : '–'}</dd>
            <dt>Twist speed, now</dt>
            <dd>{f(fr?.angularVelocity[i], 0, ' °/s')}</dd>
            <dt>Trunk axis out of the image plane</dt>
            <dd>{f(e.axisTiltDeg, 0, '° on average')}</dd>
          </dl>

          <h3>Same twist by other routes</h3>
          <dl className="mono">
            <dt>Shoulder line only</dt>
            <dd>{signed(e.cross.shouldersDeg)}</dd>
            <dt>Hip line only</dt>
            <dd>{signed(e.cross.hipsDeg)}</dd>
            <dt>Axis kept in the image plane</dt>
            <dd>{signed(e.cross.inPlaneAxisDeg)}</dd>
          </dl>

          <details open={!e.reliable}>
            <summary>
              Checks behind the consistency ({Object.values(e.parts).filter((v) => v < 0.8).length} weak)
            </summary>
            <table className="mono">
              <tbody>
                {Object.entries(e.parts).map(([key, v]) => (
                  <tr key={key} className={v < 0.8 ? 'check-off' : ''}>
                    <td>{PART_LABELS[key] ?? key}</td>
                    <td>{pct(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {e.limitations.length > 0 ? (
            <>
              <h3>What the 3D data could not settle</h3>
              <ul className="warnings limits">
                {e.limitations.map((l) => (
                  <li key={l.signal + l.problem}>
                    <strong>{l.signal}.</strong> {l.problem}
                    <div>
                      <em>Needed:</em> {l.needed}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted small">
              No data problem found for this jump. That is not proof that the twist is right (see below).
            </p>
          )}

          <h3>Check against your own count</h3>
          <label className="notefield">
            Half twists you counted in this jump
            <select
              value={annotation === null ? '' : String(annotation)}
              disabled={!canAnnotate}
              onChange={(ev) => onAnnotate(ev.target.value === '' ? null : Number(ev.target.value))}
            >
              <option value="">not counted</option>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
                <option key={v} value={v}>
                  {v} (= {v / 2} twist{v === 2 ? '' : 's'})
                </option>
              ))}
            </select>
          </label>
          {annotation !== null && e.halfTwists !== null && (
            <p className="small">
              You: {annotation} · estimate: {e.halfTwists}{' '}
              <span className={`badge ${annotation === e.halfTwists ? 'ok' : 'off'}`}>
                {annotation === e.halfTwists ? 'same' : 'different'}
              </span>{' '}
              {!e.reliable && <span className="muted">(the estimate was flagged as not reliable)</span>}
            </p>
          )}
          <p className="muted small">
            Saved with the jump in the dataset, so the twist estimate can be scored on real jumps. Half twists are
            counted from the video, not from this tool.
          </p>
        </>
      )}

      <details>
        <summary>What one camera can never tell about a twist</summary>
        <ul className="warnings limits">
          <li>
            <strong>Depth is guessed.</strong> The 3D pose comes from a single image. The twist is the spin of the
            shoulder line about the body axis, and in a side view that line points at the camera, so it is read only
            from which shoulder the model puts nearer.
            <div>
              <em>Needed:</em> a second camera, or a depth sensor.
            </div>
          </li>
          <li>
            <strong>A small depth error becomes a large twist.</strong> Measured on real model output (a still photo
            turned in the image plane): the model tilted the trunk 15° out of the plane, which produced a phantom −94°
            of twist over one somersault. Only the “axis in the image plane” check caught it.
            <div>
              <em>Needed:</em> measured depth.
            </div>
          </li>
          <li>
            <strong>Left and right can swap.</strong> If the model swaps the two shoulders, the twist jumps by 180°
            between two frames. Steps above {twist.config.maxStepDeg}° are folded back and counted; the half-twist count
            can then be off by one.
            <div>
              <em>Needed:</em> a pose model that keeps sides stable, or a higher frame rate.
            </div>
          </li>
          <li>
            <strong>Frame rate limits the speed.</strong> At {f(result.meta.fps, 0)} fps a twist faster than{' '}
            {f(maxRate, 0)} °/s ({f(maxRate / 360, 1)} twists per second) cannot be told from a swap.
          </li>
          <li>
            <strong>Not validated on real twisting athletes.</strong> The estimator is exact on a simulated 3D athlete
            and was checked for phantom twist on one still photo. No twisting trampolinist has been tested. The sign (+
            = counter-clockwise seen from above the head) matches the model’s axes on that photo only.
          </li>
        </ul>
      </details>

      <details>
        <summary>3D readiness of this browser</summary>
        {!support || !caps ? (
          <p className="muted small">Checking…</p>
        ) : (
          <>
            <dl className="mono">
              <dt>WebGPU</dt>
              <dd>
                {caps.webgpu === 'available'
                  ? 'yes'
                  : caps.webgpu === 'no-adapter'
                    ? 'API present, no GPU adapter'
                    : 'no'}
              </dd>
              <dt>WebGL 2</dt>
              <dd>{caps.webgl2 ? 'yes' : 'no'}</dd>
              <dt>WebAssembly / SIMD</dt>
              <dd>
                {caps.wasm ? 'yes' : 'no'} / {caps.wasmSimd ? 'yes' : 'no'}
              </dd>
              <dt>WASM threads</dt>
              <dd>{caps.wasmThreads ? 'yes' : 'no (not cross-origin isolated)'}</dd>
              <dt>CPU cores / memory</dt>
              <dd>
                {caps.cores ?? '?'} / {caps.deviceMemoryGb ?? '?'} GB
              </dd>
            </dl>
            <p className="small">
              <strong>Model in use.</strong> {support.current.text}
            </p>
            <p className="small">
              <strong>A separate 3D model.</strong> {support.dedicated.text}
            </p>
            <p className="muted small">
              MediaPipe Tasks Vision runs on WebGL (“GPU”) or WebAssembly (“CPU”). It does not use WebGPU.
            </p>
          </>
        )}
      </details>
    </div>
  );
}
