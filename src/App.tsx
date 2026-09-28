import { useEffect, useMemo, useRef, useState } from 'react';
import { computeAnalysis } from './analysis/computeAnalysis';
import { download, toCsv, toJson } from './analysis/export';
import { extractPoseTrack } from './analysis/extractPoseTrack';
import type { PoseTrack } from './analysis/types';
import type { ModelVariant } from './pose/types';
import { estimateFps, loadVideo } from './video/frames';
import type { OverlayOptions } from './video/overlay';
import { Chart } from './ui/Chart';
import { MetricsPanel } from './ui/MetricsPanel';
import { Playhead } from './ui/playhead';
import { TrajectoryPlot } from './ui/TrajectoryPlot';
import { VideoPlayer } from './ui/VideoPlayer';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'analyzing'; done: number; total: number }
  | { kind: 'error'; message: string };

const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

export default function App() {
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fps, setFps] = useState(30);
  const [model, setModel] = useState<ModelVariant>('full');
  const [numPoses, setNumPoses] = useState(1);
  const [stride, setStride] = useState(1);
  const [preferGpu, setPreferGpu] = useState(true);
  const [height, setHeight] = useState(1.75);
  const [speed, setSpeed] = useState(1);
  const [overlay, setOverlay] = useState<OverlayOptions>({ skeleton: true, com: true, trail: true });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [backend, setBackend] = useState('');
  const [track, setTrack] = useState<PoseTrack | null>(null);
  const playhead = useMemo(() => new Playhead(), []);
  const abort = useRef<AbortController | null>(null);

  // Athlete height only changes the scale, so re-derive metrics without re-running the model.
  const result = useMemo(() => (track ? computeAnalysis(track, { athleteHeightM: height }) : null), [track, height]);

  useEffect(() => () => abort.current?.abort(), []);

  async function onFile(file: File) {
    abort.current?.abort();
    if (url) URL.revokeObjectURL(url);
    const next = URL.createObjectURL(file);
    setTrack(null);
    setBackend('');
    setFileName(file.name);
    setUrl(next);
    setStatus({ kind: 'loading' });
    try {
      const probe = await loadVideo(next);
      setFps(await estimateFps(probe));
      probe.removeAttribute('src');
      probe.load();
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function analyze() {
    if (!url) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setTrack(null);
    setStatus({ kind: 'analyzing', done: 0, total: 1 });
    try {
      const t = await extractPoseTrack(url, {
        model,
        numPoses,
        preferGpu,
        sourceFps: fps,
        stride,
        signal: ctl.signal,
        onBackend: setBackend,
        onProgress: (done, total) => setStatus({ kind: 'analyzing', done, total }),
      });
      setTrack(t);
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus({ kind: 'idle' });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: `${msg} — if the model failed to load, run "npm run fetch-assets".` });
    }
  }

  const analyzing = status.kind === 'analyzing';
  const pct = analyzing ? Math.round((status.done / status.total) * 100) : 0;
  const base = fileName.replace(/\.[^.]+$/, '') || 'trampovision';

  return (
    <div className="app">
      <header>
        <h1>TrampoVision</h1>
        <span className="muted">Trampoline motion analysis · prototype · video never leaves your browser</span>
      </header>

      <section className="panel controls">
        <label className="file">
          <span>Video (MP4 / MOV)</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            disabled={analyzing}
            onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
          />
        </label>
        <label>
          Model
          <select value={model} onChange={(e) => setModel(e.target.value as ModelVariant)} disabled={analyzing}>
            <option value="lite">Lite (fast)</option>
            <option value="full">Full</option>
            <option value="heavy">Heavy (most accurate)</option>
          </select>
        </label>
        <label>
          Athlete height (m)
          <input type="number" min={1} max={2.3} step={0.01} value={height} onChange={(e) => setHeight(Number(e.target.value) || 1.75)} />
        </label>
        <label>
          Video fps
          <input
            type="number"
            min={1}
            max={480}
            step={0.001}
            value={fps}
            disabled={analyzing}
            onChange={(e) => {
              setFps(Number(e.target.value) || 30);
              setTrack(null);
            }}
          />
        </label>
        <label>
          Analyze every
          <select value={stride} onChange={(e) => setStride(Number(e.target.value))} disabled={analyzing}>
            {(
              [
                [1, 'frame'],
                [2, '2nd frame'],
                [3, '3rd frame'],
                [4, '4th frame'],
              ] as const
            ).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          People to look for
          <select value={numPoses} onChange={(e) => setNumPoses(Number(e.target.value))} disabled={analyzing}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={preferGpu} onChange={(e) => setPreferGpu(e.target.checked)} disabled={analyzing} />
          Use GPU if possible
        </label>
        {analyzing ? (
          <button onClick={() => abort.current?.abort()}>Cancel</button>
        ) : (
          <button className="primary" onClick={() => void analyze()} disabled={!url || status.kind === 'loading'}>
            Analyze video
          </button>
        )}
      </section>

      <p className="chips">
        <span className="chip">Runtime: {backend || 'not started'}</span>
        <span className="chip">
          WebGPU: {webgpu ? 'available in this browser, but MediaPipe uses WebGL (GPU delegate) or WASM (CPU)' : 'not available'}
        </span>
      </p>

      {status.kind === 'loading' && <p className="notice">Reading video… (measuring frame rate)</p>}
      {status.kind === 'error' && <p className="notice error" role="alert">{status.message}</p>}
      {analyzing && (
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
          <span className="mono">Analyzing frame {status.done} / {status.total} ({pct}%)</span>
        </div>
      )}

      {!url && <p className="empty">Choose a trampoline video to start. A side view with a fixed camera works best.</p>}

      {url && (
        <section className="workspace">
          <div className="left">
            <VideoPlayer
              url={url}
              fps={fps}
              result={result}
              overlay={overlay}
              playhead={playhead}
              speed={speed}
              onSpeed={setSpeed}
              onError={(message) => setStatus({ kind: 'error', message })}
            />
            <div className="toggles">
              {(['skeleton', 'com', 'trail'] as const).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={overlay[k]} onChange={(e) => setOverlay({ ...overlay, [k]: e.target.checked })} />
                  {k === 'skeleton' ? 'Skeleton' : k === 'com' ? 'Center of mass' : 'COM trajectory'}
                </label>
              ))}
              <span className="spacer" />
              <button disabled={!result} onClick={() => result && download(`${base}-metrics.csv`, toCsv(result), 'text/csv')}>Export CSV</button>
              <button disabled={!result} onClick={() => result && download(`${base}-pose.json`, toJson(result), 'application/json')}>Export JSON</button>
            </div>
            <p className="hint muted">
              Space: play/pause · ←/→: previous/next frame (Shift: ±10) · click or drag on a chart to seek.
            </p>
          </div>
          {result && (
            <aside className="right">
              <MetricsPanel result={result} playhead={playhead} />
            </aside>
          )}
        </section>
      )}

      {result && (
        <section className="charts">
          <Chart title="COM height" unit="m above lowest point" time={result.time} playhead={playhead} confidence={result.confidence} decimals={2} minSpan={0.5}
            series={[{ label: 'Height', values: result.height, color: '--series-1' }]} />
          <Chart title="COM vertical velocity" unit="m/s, up = +" time={result.time} playhead={playhead} confidence={result.confidence} decimals={2} zeroLine minSpan={2}
            series={[{ label: 'Vy', values: result.vy, color: '--series-1' }]} />
          <TrajectoryPlot result={result} playhead={playhead} />
          <Chart title="Body angle" unit="° from vertical, + = clockwise" time={result.time} playhead={playhead} confidence={result.confidence} zeroLine minSpan={20} breakOnJump={180}
            series={[
              { label: 'Trunk', values: result.trunkAngle, color: '--series-1' },
              { label: 'Body line', values: result.lineAngle, color: '--series-2' },
            ]} />
          <Chart title="Cumulative rotation" unit="°, trunk" time={result.time} playhead={playhead} confidence={result.confidence} decimals={0} zeroLine minSpan={40}
            series={[{ label: 'Rotation', values: result.rotation, color: '--series-1' }]} />
          <Chart title="Angular velocity" unit="°/s" time={result.time} playhead={playhead} confidence={result.confidence} decimals={0} zeroLine minSpan={60}
            series={[{ label: 'ω', values: result.angularVelocity, color: '--series-1' }]} />
          {(
            [
              ['Knee angle', 'leftKnee', 'rightKnee'],
              ['Hip angle', 'leftHip', 'rightHip'],
              ['Shoulder angle', 'leftShoulder', 'rightShoulder'],
              ['Elbow angle', 'leftElbow', 'rightElbow'],
            ] as const
          ).map(([title, l, r]) => (
            <Chart key={title} title={title} unit="°, 180 = straight" time={result.time} playhead={playhead} confidence={result.confidence} minSpan={30}
              series={[
                { label: 'Left', values: result.joints[l], color: '--series-1' },
                { label: 'Right', values: result.joints[r], color: '--series-2' },
              ]} />
          ))}
          <Chart title="Pose confidence" unit="0–1, shaded when < 0.5" time={result.time} playhead={playhead} decimals={2} yDomain={[0, 1]}
            series={[{ label: 'Confidence', values: result.confidence, color: '--series-1' }]} />
        </section>
      )}
    </div>
  );
}
