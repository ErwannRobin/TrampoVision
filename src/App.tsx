import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildCalibration, DEFAULT_BED_M, type Quad, type TrampolineCalibration } from './analysis/calibration';
import { computeAnalysis } from './analysis/computeAnalysis';
import { download, toCsv, toJumpsCsv } from './analysis/export';
import { extractPoseTrack } from './analysis/extractPoseTrack';
import { stabilizePose } from './analysis/stabilize';
import { buildPoseSeries, parsePoseSeries, toSeriesJson } from './analysis/timeSeries';
import type { PoseTrack, ScaleSource } from './analysis/types';
import type { ModelVariant, Point } from './pose/types';
import { disposeVideo, estimateFps, loadVideo } from './video/frames';
import type { CalibrationDraw, OverlayOptions } from './video/overlay';
import { Chart } from './ui/Chart';
import { DebugPanel } from './ui/DebugPanel';
import { Playhead } from './ui/playhead';
import { TrajectoryPlot } from './ui/TrajectoryPlot';
import { VideoPlayer } from './ui/VideoPlayer';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; stage: 'reading' | 'measuring' }
  | { kind: 'analyzing'; done: number; total: number }
  | { kind: 'error'; message: string };

const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

interface SavedCalibration {
  corners: Point[];
  bedLong: number;
  bedShort: number;
  firstSide: 'long' | 'short';
}

const calKey = (file: File) => `trampovision.calibration:${file.name}:${file.size}`;
function loadSavedCalibration(file: File): SavedCalibration | null {
  try {
    const raw = localStorage.getItem(calKey(file));
    return raw ? (JSON.parse(raw) as SavedCalibration) : null;
  } catch {
    return null;
  }
}
function saveCalibration(file: File | null, cal: SavedCalibration) {
  if (!file) return;
  try {
    localStorage.setItem(calKey(file), JSON.stringify(cal));
  } catch {
    /* storage unavailable: the calibration just isn't remembered */
  }
}

export default function App() {
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
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
  const [notice, setNotice] = useState('');

  // Trampoline calibration (manual): four corners, bed size, and where meters come from.
  const [corners, setCorners] = useState<Point[]>([]);
  const [editingCal, setEditingCal] = useState(false);
  const [bedLong, setBedLong] = useState(DEFAULT_BED_M.long);
  const [bedShort, setBedShort] = useState(DEFAULT_BED_M.short);
  const [firstSide, setFirstSide] = useState<'long' | 'short'>('long');
  const [scaleSource, setScaleSource] = useState<ScaleSource | 'auto'>('auto');

  const playhead = useMemo(() => new Playhead(), []);
  const abort = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null); // latest selected file, to ignore stale async results

  const calibration = useMemo<TrampolineCalibration | null>(
    () =>
      corners.length === 4
        ? {
            corners: corners as Quad,
            firstSideM: firstSide === 'long' ? bedLong : bedShort,
            secondSideM: firstSide === 'long' ? bedShort : bedLong,
          }
        : null,
    [corners, bedLong, bedShort, firstSide],
  );
  const calibrationModel = useMemo(() => (calibration ? buildCalibration(calibration) : null), [calibration]);
  const analysisCalibration = useDeferredValue(calibration); // keeps dragging a corner smooth

  // Cleaning the landmarks only depends on the track; height and calibration only change scale and normalization.
  const stabilized = useMemo(() => (track ? stabilizePose(track) : null), [track]);
  const result = useMemo(
    () =>
      track && stabilized
        ? computeAnalysis(track, { athleteHeightM: height, calibration: analysisCalibration, scaleSource }, stabilized)
        : null,
    [track, stabilized, height, analysisCalibration, scaleSource],
  );

  useEffect(() => () => abort.current?.abort(), []);

  // Remember the calibration per video file.
  useEffect(() => {
    if (corners.length === 4) saveCalibration(file, { corners, bedLong, bedShort, firstSide });
  }, [file, corners, bedLong, bedShort, firstSide]);

  const calDraw = useMemo<CalibrationDraw | null>(
    () =>
      corners.length > 0 || editingCal
        ? { corners, center: calibrationModel?.ok ? calibrationModel.model.center : null, editing: editingCal }
        : null,
    [corners, editingCal, calibrationModel],
  );

  async function onFile(next: File) {
    abort.current?.abort();
    if (url) URL.revokeObjectURL(url);
    const nextUrl = URL.createObjectURL(next);
    setTrack(null);
    setBackend('');
    setNotice('');
    setFile(next);
    setEditingCal(false);
    const saved = loadSavedCalibration(next);
    setCorners(saved?.corners ?? []);
    if (saved) {
      setBedLong(saved.bedLong);
      setBedShort(saved.bedShort);
      setFirstSide(saved.firstSide);
    }
    urlRef.current = nextUrl;
    setUrl(nextUrl);
    setStatus({ kind: 'loading', stage: 'reading' });
    const isCurrent = () => urlRef.current === nextUrl;
    try {
      const probe = await loadVideo(nextUrl);
      if (isCurrent()) setStatus({ kind: 'loading', stage: 'measuring' });
      const measured = isCurrent() ? await estimateFps(probe) : null;
      disposeVideo(probe);
      if (!isCurrent()) return;
      setFps(measured ?? 30);
      setStatus(
        measured
          ? { kind: 'idle' }
          : { kind: 'error', message: 'Could not measure the frame rate. Using 30 fps: please set the real value in the settings.' },
      );
    } catch (err) {
      if (isCurrent()) setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function analyze() {
    if (!url) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setTrack(null);
    setNotice('');
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

  /** Opens a saved series (JSON): no need to run the pose model again. */
  async function openSeries(saved: File) {
    try {
      const parsed = parsePoseSeries(await saved.text());
      setTrack(parsed.track);
      setBackend(`${parsed.source.backend} (from file)`);
      setHeight(parsed.settings.athleteHeightM);
      setScaleSource(parsed.settings.scaleSource);
      setFps(parsed.source.sourceFps);
      setStride(Math.max(1, Math.round(parsed.source.sourceFps / parsed.source.fps)));
      if (parsed.calibration) {
        const { corners: c, firstSideM, secondSideM } = parsed.calibration;
        setCorners(c);
        setFirstSide(firstSideM >= secondSideM ? 'long' : 'short');
        setBedLong(Math.max(firstSideM, secondSideM));
        setBedShort(Math.min(firstSideM, secondSideM));
      }
      setStatus({ kind: 'idle' });
      setNotice(
        `Opened ${saved.name} (${parsed.track.frames.length} frames). ` +
          (url ? 'Make sure the loaded video is the same clip.' : 'Load the video too to see the overlay.'),
      );
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const analyzing = status.kind === 'analyzing';
  const pct = analyzing ? Math.round((status.done / status.total) * 100) : 0;
  const fileName = file?.name ?? 'trampovision';
  const base = fileName.replace(/\.[^.]+$/, '') || 'trampovision';

  // Chart decorations derived from the jump cycles.
  const decorations = useMemo(() => {
    if (!result) return null;
    const markers = result.jumps.cycles.flatMap((c) => [
      ...(c.takeoffTimeS !== null ? [{ t: c.takeoffTimeS, label: 'T' }] : []),
      { t: c.apexTimeS, label: 'A' },
      ...(c.landingTimeS !== null ? [{ t: c.landingTimeS, label: 'L' }] : []),
    ]);
    const bands = result.jumps.cycles.map((c) => ({
      from: c.takeoffTimeS ?? result.time[0],
      to: c.landingTimeS ?? result.time[result.time.length - 1],
    }));
    const halfBed =
      calibrationModel?.ok && result.meta.calibrated
        ? calibrationModel.model.halfExtentM / calibrationModel.model.metersPerPixel / result.meta.pixelsPerMeter
        : NaN;
    const bedGuides = Number.isFinite(halfBed)
      ? [{ value: -halfBed, label: 'bed edge' }, { value: halfBed, label: 'bed edge' }]
      : [];
    const orient = Array.from(result.orientation).filter(Number.isFinite);
    const turnGuides: { value: number; label?: string }[] = [];
    if (orient.length) {
      const lo = Math.ceil(Math.min(...orient) / 360);
      const hi = Math.floor(Math.max(...orient) / 360);
      for (let k = lo; k <= hi && k - lo < 40; k++) turnGuides.push({ value: k * 360, label: `${k} turn${Math.abs(k) === 1 ? '' : 's'}` });
    }
    return { markers, bands, bedGuides, turnGuides };
  }, [result, calibrationModel]);

  const calStatus = (() => {
    if (editingCal) {
      return corners.length < 4
        ? `Click corner ${corners.length + 1} of 4 on the video: go around the bed. Scrub the video first if the bed is hidden.`
        : 'Drag a corner to adjust it, then press Done.';
    }
    if (!calibrationModel) return 'Optional. Marks the bed so positions are measured relative to it. Works best with a level camera facing a side of the bed.';
    if (!calibrationModel.ok) return calibrationModel.error;
    const m = calibrationModel.model;
    return `Bed scale ${(1 / m.metersPerPixel).toFixed(0)} px/m at the bed center · camera sees the bed ${m.viewAngleDeg.toFixed(0)}° from face-on (0° = a long side)`;
  })();

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
        <label className="file">
          <span>…or open saved data (JSON)</span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={analyzing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openSeries(f);
              e.target.value = '';
            }}
          />
        </label>
      </section>

      <p className="chips">
        <span className="chip">Runtime: {backend || 'not started'}</span>
        <span className="chip">
          WebGPU: {webgpu ? 'available in this browser, but MediaPipe uses WebGL (GPU delegate) or WASM (CPU)' : 'not available'}
        </span>
      </p>

      {status.kind === 'loading' && (
        <p className="notice">{status.stage === 'reading' ? 'Reading video…' : 'Measuring frame rate…'}</p>
      )}
      {status.kind === 'error' && <p className="notice error" role="alert">{status.message}</p>}
      {notice && status.kind !== 'error' && <p className="notice">{notice}</p>}
      {analyzing && (
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
          <span className="mono">Analyzing frame {status.done} / {status.total} ({pct}%)</span>
        </div>
      )}

      {!url && !result && <p className="empty">Choose a trampoline video to start. A side view with a fixed, level camera works best.</p>}

      {(url || result) && (
        <section className="workspace">
          <div className="left">
            {url ? (
              <VideoPlayer
                url={url}
                fps={fps}
                result={result}
                overlay={overlay}
                playhead={playhead}
                speed={speed}
                onSpeed={setSpeed}
                onError={(message) => setStatus({ kind: 'error', message })}
                calibration={calDraw}
                onCornersChange={setCorners}
              />
            ) : (
              <p className="notice">No video loaded. Load the clip to see the skeleton on it; the charts and the panel work without it.</p>
            )}
            <div className="toggles">
              {(['skeleton', 'com', 'trail'] as const).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={overlay[k]} onChange={(e) => setOverlay({ ...overlay, [k]: e.target.checked })} />
                  {k === 'skeleton' ? 'Skeleton' : k === 'com' ? 'Center of mass' : 'COM trajectory'}
                </label>
              ))}
              <span className="spacer" />
              <button disabled={!result} onClick={() => result && download(`${base}-frames.csv`, toCsv(result), 'text/csv')}>Frames CSV</button>
              <button disabled={!result} onClick={() => result && download(`${base}-jumps.csv`, toJumpsCsv(result), 'text/csv')}>Jumps CSV</button>
              <button
                disabled={!result}
                title="Every frame: all joints with scores, center of mass, orientation, phase, plus the raw model output"
                onClick={() =>
                  result &&
                  track &&
                  download(
                    `${base}-pose-series.json`,
                    toSeriesJson(buildPoseSeries(result, track, { fileName, stride, minVisibility: 0.4, calibration })),
                    'application/json',
                  )
                }
              >
                Save data (JSON)
              </button>
            </div>

            <div className="panel calibration">
              <strong>Trampoline</strong>
              {editingCal ? (
                <>
                  <button className="primary" onClick={() => setEditingCal(false)}>Done</button>
                  <button disabled={corners.length === 0} onClick={() => setCorners(corners.slice(0, -1))}>Undo last corner</button>
                </>
              ) : (
                <button disabled={!url} onClick={() => setEditingCal(true)}>
                  {corners.length === 4 ? 'Edit corners' : 'Set up calibration'}
                </button>
              )}
              {corners.length > 0 && <button onClick={() => { setCorners([]); setEditingCal(true); }}>Clear</button>}
              <label>
                Bed
                <input type="number" min={0.5} max={10} step={0.01} value={bedLong} onChange={(e) => setBedLong(Number(e.target.value) || DEFAULT_BED_M.long)} />
                ×
                <input type="number" min={0.5} max={10} step={0.01} value={bedShort} onChange={(e) => setBedShort(Number(e.target.value) || DEFAULT_BED_M.short)} />
                m
              </label>
              <label>
                Side 1→2 is the
                <select value={firstSide} onChange={(e) => setFirstSide(e.target.value as 'long' | 'short')}>
                  <option value="long">long side</option>
                  <option value="short">short side</option>
                </select>
              </label>
              <label>
                Meters from
                <select value={scaleSource} onChange={(e) => setScaleSource(e.target.value as ScaleSource | 'auto')}>
                  <option value="auto">auto (bed if set)</option>
                  <option value="trampoline">the bed</option>
                  <option value="athlete">athlete height</option>
                </select>
              </label>
              <span className={`status ${calibrationModel && !calibrationModel.ok ? 'error-text' : 'muted'}`}>{calStatus}</span>
            </div>
            <p className="hint muted">
              Space: play/pause · ←/→: previous/next frame (Shift: ±10) · click or drag on a chart to seek.
            </p>
          </div>
          {result && (
            <aside className="right">
              <DebugPanel result={result} playhead={playhead} />
            </aside>
          )}
        </section>
      )}

      {result && decorations && (
        <section className="charts">
          <Chart title="COM height" unit={`m above ${result.meta.heightReference}`} time={result.time} playhead={playhead} confidence={result.confidence} decimals={2} minSpan={0.5}
            markers={decorations.markers} bands={decorations.bands}
            series={[{ label: 'Height', values: result.height, color: '--series-1' }]} />
          <Chart title="COM vertical velocity" unit="m/s, up = +" time={result.time} playhead={playhead} confidence={result.confidence} decimals={2} zeroLine minSpan={2}
            markers={decorations.markers} bands={decorations.bands}
            series={[{ label: 'Vy', values: result.vy, color: '--series-1' }]} />
          <Chart title="COM horizontal position" unit={`m from ${result.meta.calibrated ? 'bed center' : 'start'}, + = right`} time={result.time} playhead={playhead} confidence={result.confidence} decimals={2} zeroLine minSpan={0.5}
            guides={decorations.bedGuides} markers={decorations.markers} bands={decorations.bands}
            series={[{ label: 'x', values: result.x, color: '--series-1' }]} />
          <TrajectoryPlot result={result} playhead={playhead} calibration={calibrationModel?.ok && result.meta.calibrated ? calibrationModel.model : null} />
          <Chart title="Body orientation (continuous)" unit="°, keeps counting past 360" time={result.time} playhead={playhead} confidence={result.confidence} decimals={0} minSpan={40}
            guides={decorations.turnGuides} markers={decorations.markers} bands={decorations.bands}
            series={[{ label: 'Orientation', values: result.orientation, color: '--series-1' }]} />
          <Chart title="Body angle (wrapped)" unit="° from vertical, + = clockwise" time={result.time} playhead={playhead} confidence={result.confidence} zeroLine minSpan={20} breakOnJump={180}
            series={[
              { label: 'Trunk', values: result.trunkAngle, color: '--series-1' },
              { label: 'Body line', values: result.lineAngle, color: '--series-2' },
            ]} />
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
