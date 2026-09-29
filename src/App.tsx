import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildCalibration, DEFAULT_BED_M, type Quad, type TrampolineCalibration } from './analysis/calibration';
import { computeAnalysis } from './analysis/computeAnalysis';
import { download, toCsv, toJumpsCsv } from './analysis/export';
import { extractPoseTrack } from './analysis/extractPoseTrack';
import { stabilizePose } from './analysis/stabilize';
import { sampleIndexAt } from './analysis/lookup';
import { isStale, syncRecords, withTruth, withTwistTruth, type RecordContext } from './dataset/record';
import type { TruthLabel } from './dataset/types';
import { useDataset } from './dataset/useDataset';
import { videoIdFromTrack, videoIdOf } from './dataset/videoId';
import { analyzeTwist } from './pose3d/twist';
import { analyzeSkills } from './skills/analyzeSkills';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from './skills/config';
import { buildSkillReport, toSequencesCsv, toSkillReportJson, toSkillsCsv } from './skills/export';
import { buildPoseSeries, parsePoseSeries, toSeriesJson } from './analysis/timeSeries';
import type { PoseTrack, ScaleSource } from './analysis/types';
import type { ModelVariant, Point } from './pose/types';
import { disposeVideo, estimateFps, loadVideo } from './video/frames';
import type { CalibrationDraw, OverlayOptions } from './video/overlay';
import { Chart } from './ui/Chart';
import { DebugPanel } from './ui/DebugPanel';
import { DatasetBar, EvaluatePanel, EvaluationReport } from './ui/EvaluationView';
import { JumpView } from './ui/JumpView';
import { PhaseTimeline } from './ui/PhaseTimeline';
import { Pose3DSection } from './ui/Pose3DView';
import { Playhead } from './ui/playhead';
import { SkillPanel } from './ui/SkillPanel';
import { TrajectoryPlot } from './ui/TrajectoryPlot';
import { TwistPanel } from './ui/TwistPanel';
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
  const [overlay, setOverlay] = useState<OverlayOptions>({ skeleton: true, com: true, trail: true, hud: true });
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

  // Skill recognition: thresholds, the jump being inspected, which side panel is open.
  const [skillConfig, setSkillConfig] = useState<SkillConfig>(DEFAULT_SKILL_CONFIG);
  const [selectedJump, setSelectedJump] = useState(0);
  const [rightTab, setRightTab] = useState<'skill' | 'evaluate' | 'twist' | 'analysis'>('skill');
  // 2D pose is the analysis; 3D pose is an experimental view next to it and does not feed the classifier.
  const [poseView, setPoseView] = useState<'2d' | '3d'>('2d');
  // Evaluation: which video the labels belong to, and whether the report covers this video or every saved one.
  const [videoId, setVideoId] = useState<string | null>(null);
  const [seriesName, setSeriesName] = useState<string | null>(null);
  const [evalScope, setEvalScope] = useState<'video' | 'all'>('video');
  const dataset = useDataset();

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

  const skills = useMemo(() => (result ? analyzeSkills(result, { config: skillConfig }) : null), [result, skillConfig]);
  const jumpCount = skills?.jumps.length ?? 0;
  const jumpSel = Math.min(selectedJump, Math.max(0, jumpCount - 1));

  // Experimental 3D: twist about the longitudinal axis, from the 3D landmarks of the same frames.
  const twist = useMemo(
    () =>
      track && result
        ? analyzeTwist({ world: track.world, time: result.time, fps: result.meta.fps, cycles: result.jumps.cycles })
        : null,
    [track, result],
  );

  useEffect(() => () => abort.current?.abort(), []);

  // A new analysis starts at the first jump.
  useEffect(() => {
    setSelectedJump(0);
  }, [track]);

  // While the video plays or is scrubbed, the jump view follows the jump under the playhead.
  const selectedRef = useRef(0);
  selectedRef.current = jumpSel;
  useEffect(() => {
    if (!result) return;
    const unsubscribe = playhead.subscribe(() => {
      const idx = result.jumps.cycleIndex[sampleIndexAt(result.meta, playhead.getSnapshot())];
      if (idx >= 0 && idx !== selectedRef.current) setSelectedJump(idx);
    });
    return () => {
      unsubscribe();
    };
  }, [result, playhead]);

  /** Choose a jump and move the video to its takeoff. */
  const chooseJump = (k: number) => {
    setSelectedJump(k);
    const c = result?.jumps.cycles[k];
    // Half a frame past the event, so the frame shown is the takeoff frame and not the one before it.
    if (c && result) playhead.seek((c.takeoffTimeS ?? c.apexTimeS) + 0.5 / result.meta.sourceFps);
  };

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
    // A stable id from the file itself, so labels stay attached to this video after a reload.
    setVideoId(null);
    setSeriesName(null);
    void videoIdOf(next).then((id) => {
      if (urlRef.current === nextUrl) setVideoId(id);
    });
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
          : {
              kind: 'error',
              message: 'Could not measure the frame rate. Using 30 fps: please set the real value in the settings.',
            },
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
      setSeriesName(parsed.source.fileName);
      setVideoId(parsed.source.videoId ?? videoId ?? videoIdFromTrack(parsed.source.fileName, parsed.track));
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

  // Local dataset: the jumps of this video as they would be saved now, next to what is already saved.
  const fileNameForRecords = file?.name ?? seriesName ?? 'trampovision';
  const recordCtx = useMemo<RecordContext | null>(
    () => (result && skills && videoId ? { videoId, fileName: fileNameForRecords, result, skills, twist } : null),
    [result, skills, videoId, fileNameForRecords, twist],
  );
  const videoRecords = useMemo(() => dataset.records.filter((r) => r.videoId === videoId), [dataset.records, videoId]);
  const fresh = useMemo(() => (recordCtx ? syncRecords(videoRecords, recordCtx) : []), [recordCtx, videoRecords]);
  const savedIds = useMemo(() => new Set(videoRecords.map((r) => r.id)), [videoRecords]);
  const staleCount = useMemo(
    () =>
      fresh.filter((r) => {
        const s = videoRecords.find((v) => v.id === r.id);
        return !!s && isStale(s, r);
      }).length,
    [fresh, videoRecords],
  );
  const { save: saveRecords } = dataset;
  const labelJump = useCallback(
    (k: number, label: TruthLabel | null) => {
      if (fresh[k]) void saveRecords([withTruth(fresh[k], label)]);
    },
    [fresh, saveRecords],
  );
  const noteJump = useCallback(
    (k: number, note: string) => {
      const r = fresh[k];
      if (r?.truth) void saveRecords([withTruth(r, r.truth.label, { note })]);
    },
    [fresh, saveRecords],
  );
  const annotateTwist = (halfTwists: number | null) => {
    if (fresh[jumpSel]) void saveRecords([withTwistTruth(fresh[jumpSel], halfTwists)]);
  };
  /** Jump of the current video that has this apex time (a failure card asks to see it). */
  const goToApex = (apexS: number) => {
    const k = result?.jumps.cycles.findIndex((c) => Math.abs(c.apexTimeS - apexS) <= 0.2) ?? -1;
    if (k >= 0) chooseJump(k);
  };
  const switchPoseView = (v: '2d' | '3d') => {
    setPoseView(v);
    if (v === '3d') setRightTab('twist');
    else if (rightTab === 'twist') setRightTab('skill');
  };

  const analyzing = status.kind === 'analyzing';
  const pct = analyzing ? Math.round((status.done / status.total) * 100) : 0;
  const fileName = file?.name ?? seriesName ?? 'trampovision';
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
      ? [
          { value: -halfBed, label: 'bed edge' },
          { value: halfBed, label: 'bed edge' },
        ]
      : [];
    const orient = Array.from(result.orientation).filter(Number.isFinite);
    const turnGuides: { value: number; label?: string }[] = [];
    if (orient.length) {
      const lo = Math.ceil(Math.min(...orient) / 360);
      const hi = Math.floor(Math.max(...orient) / 360);
      for (let k = lo; k <= hi && k - lo < 40; k++)
        turnGuides.push({ value: k * 360, label: `${k} turn${Math.abs(k) === 1 ? '' : 's'}` });
    }
    return { markers, bands, bedGuides, turnGuides };
  }, [result, calibrationModel]);

  const calStatus = (() => {
    if (editingCal) {
      return corners.length < 4
        ? `Click corner ${corners.length + 1} of 4 on the video: go around the bed. Scrub the video first if the bed is hidden.`
        : 'Drag a corner to adjust it, then press Done.';
    }
    if (!calibrationModel)
      return 'Optional. Marks the bed so positions are measured relative to it. Works best with a level camera facing a side of the bed.';
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
          <input
            type="number"
            min={1}
            max={2.3}
            step={0.01}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value) || 1.75)}
          />
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
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          People to look for
          <select value={numPoses} onChange={(e) => setNumPoses(Number(e.target.value))} disabled={analyzing}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={preferGpu}
            onChange={(e) => setPreferGpu(e.target.checked)}
            disabled={analyzing}
          />
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
          WebGPU:{' '}
          {webgpu
            ? 'available in this browser, but MediaPipe uses WebGL (GPU delegate) or WASM (CPU)'
            : 'not available'}
        </span>
      </p>

      {status.kind === 'loading' && (
        <p className="notice">{status.stage === 'reading' ? 'Reading video…' : 'Measuring frame rate…'}</p>
      )}
      {status.kind === 'error' && (
        <p className="notice error" role="alert">
          {status.message}
        </p>
      )}
      {notice && status.kind !== 'error' && <p className="notice">{notice}</p>}
      {analyzing && (
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
          <span className="mono">
            Analyzing frame {status.done} / {status.total} ({pct}%)
          </span>
        </div>
      )}

      {!url && !result && (
        <p className="empty">Choose a trampoline video to start. A side view with a fixed, level camera works best.</p>
      )}
      {!url && !result && (dataset.records.length > 0 || dataset.ready) && (
        <section className="panel evaluation">
          <DatasetBar dataset={dataset} baseName="trampovision" />
          {dataset.records.length > 0 && (
            <EvaluationReport
              records={dataset.records}
              videoId={null}
              scope="all"
              onScope={() => {}}
              baseName="trampovision"
              onGoTo={() => {}}
            />
          )}
        </section>
      )}

      {(url || result) && (
        <section className="workspace">
          <div className="left">
            {url ? (
              <VideoPlayer
                url={url}
                fps={fps}
                result={result}
                skills={skills}
                overlay={overlay}
                playhead={playhead}
                speed={speed}
                onSpeed={setSpeed}
                onError={(message) => setStatus({ kind: 'error', message })}
                calibration={calDraw}
                onCornersChange={setCorners}
              />
            ) : (
              <p className="notice">
                No video loaded. Load the clip to see the skeleton on it; the charts and the panel work without it.
              </p>
            )}
            {result && (
              <PhaseTimeline
                result={result}
                skills={skills}
                playhead={playhead}
                selected={jumpCount ? jumpSel : null}
                onSelect={(k) => setSelectedJump(k)}
              />
            )}
            <div className="toggles">
              <div className="seg" role="group" aria-label="Pose view">
                <button
                  className={poseView === '2d' ? 'primary' : ''}
                  aria-pressed={poseView === '2d'}
                  onClick={() => switchPoseView('2d')}
                >
                  2D pose
                </button>
                <button
                  className={poseView === '3d' ? 'primary' : ''}
                  aria-pressed={poseView === '3d'}
                  onClick={() => switchPoseView('3d')}
                  title="Experimental: 3D skeleton and twist from the model's 3D landmarks. The classifier still uses the 2D pose."
                >
                  3D pose (experimental)
                </button>
              </div>
              {(['skeleton', 'com', 'trail', 'hud'] as const).map((k) => (
                <label key={k} className="check">
                  <input
                    type="checkbox"
                    checked={overlay[k]}
                    onChange={(e) => setOverlay({ ...overlay, [k]: e.target.checked })}
                  />
                  {k === 'skeleton'
                    ? 'Skeleton'
                    : k === 'com'
                      ? 'Center of mass'
                      : k === 'trail'
                        ? 'COM trajectory'
                        : 'Skill labels'}
                </label>
              ))}
              <span className="spacer" />
              <button
                disabled={!result}
                onClick={() => result && download(`${base}-frames.csv`, toCsv(result), 'text/csv')}
              >
                Frames CSV
              </button>
              <button
                disabled={!result}
                onClick={() => result && download(`${base}-jumps.csv`, toJumpsCsv(result), 'text/csv')}
              >
                Jumps CSV
              </button>
              <button
                disabled={!result}
                title="Every frame: all joints with scores, center of mass, orientation, phase, plus the raw model output"
                onClick={() =>
                  result &&
                  track &&
                  download(
                    `${base}-pose-series.json`,
                    toSeriesJson(
                      buildPoseSeries(result, track, {
                        fileName,
                        videoId: videoId ?? undefined,
                        stride,
                        minVisibility: 0.4,
                        calibration,
                      }),
                    ),
                    'application/json',
                  )
                }
              >
                Save data (JSON)
              </button>
              <button
                disabled={!skills}
                title="Per jump: normalized sequence, features, prediction with evidence, and the thresholds used"
                onClick={() =>
                  result &&
                  skills &&
                  download(
                    `${base}-skills.json`,
                    toSkillReportJson(
                      buildSkillReport(skills, {
                        fileName,
                        fps: result.meta.fps,
                        width: result.meta.width,
                        height: result.meta.height,
                      }),
                    ),
                    'application/json',
                  )
                }
              >
                Skills JSON
              </button>
              <button
                disabled={!skills}
                title="One row per jump: features and prediction"
                onClick={() => skills && download(`${base}-skills.csv`, toSkillsCsv(skills), 'text/csv')}
              >
                Skills CSV
              </button>
              <button
                disabled={!skills}
                title="One row per jump and normalized sample"
                onClick={() => skills && download(`${base}-sequences.csv`, toSequencesCsv(skills), 'text/csv')}
              >
                Sequences CSV
              </button>
            </div>

            {poseView === '3d' && result && track && twist && decorations && (
              <Pose3DSection
                track={track}
                result={result}
                twist={twist}
                selected={jumpSel}
                playhead={playhead}
                markers={decorations.markers}
                bands={decorations.bands}
              />
            )}

            <div className="panel calibration">
              <strong>Trampoline</strong>
              {editingCal ? (
                <>
                  <button className="primary" onClick={() => setEditingCal(false)}>
                    Done
                  </button>
                  <button disabled={corners.length === 0} onClick={() => setCorners(corners.slice(0, -1))}>
                    Undo last corner
                  </button>
                </>
              ) : (
                <button disabled={!url} onClick={() => setEditingCal(true)}>
                  {corners.length === 4 ? 'Edit corners' : 'Set up calibration'}
                </button>
              )}
              {corners.length > 0 && (
                <button
                  onClick={() => {
                    setCorners([]);
                    setEditingCal(true);
                  }}
                >
                  Clear
                </button>
              )}
              <label>
                Bed
                <input
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.01}
                  value={bedLong}
                  onChange={(e) => setBedLong(Number(e.target.value) || DEFAULT_BED_M.long)}
                />
                ×
                <input
                  type="number"
                  min={0.5}
                  max={10}
                  step={0.01}
                  value={bedShort}
                  onChange={(e) => setBedShort(Number(e.target.value) || DEFAULT_BED_M.short)}
                />
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
              <span className={`status ${calibrationModel && !calibrationModel.ok ? 'error-text' : 'muted'}`}>
                {calStatus}
              </span>
            </div>
            {result && skills && (
              <JumpView result={result} skills={skills} playhead={playhead} selected={jumpSel} onSelect={chooseJump} />
            )}
            {result && rightTab === 'evaluate' && (
              <EvaluationReport
                records={dataset.records}
                videoId={videoId}
                scope={evalScope}
                onScope={setEvalScope}
                baseName={base}
                onGoTo={goToApex}
              />
            )}
            <p className="hint muted">
              Space: play/pause · ←/→: previous/next frame (Shift: ±10) · click or drag on a chart to seek.
            </p>
          </div>
          {result && (
            <aside className="right">
              <div className="tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={rightTab === 'skill'}
                  className={rightTab === 'skill' ? 'primary' : ''}
                  onClick={() => setRightTab('skill')}
                >
                  Skill
                </button>
                <button
                  role="tab"
                  aria-selected={rightTab === 'evaluate'}
                  className={rightTab === 'evaluate' ? 'primary' : ''}
                  onClick={() => setRightTab('evaluate')}
                >
                  Evaluate
                </button>
                <button
                  role="tab"
                  aria-selected={rightTab === 'twist'}
                  className={rightTab === 'twist' ? 'primary' : ''}
                  onClick={() => setRightTab('twist')}
                >
                  Twist 3D
                </button>
                <button
                  role="tab"
                  aria-selected={rightTab === 'analysis'}
                  className={rightTab === 'analysis' ? 'primary' : ''}
                  onClick={() => setRightTab('analysis')}
                >
                  Analysis
                </button>
              </div>
              {rightTab === 'skill' && skills ? (
                <SkillPanel
                  result={result}
                  skills={skills}
                  selected={jumpSel}
                  playhead={playhead}
                  config={skillConfig}
                  onConfig={setSkillConfig}
                  onSelect={chooseJump}
                />
              ) : rightTab === 'evaluate' && skills ? (
                <EvaluatePanel
                  skills={skills}
                  selected={jumpSel}
                  onSelect={chooseJump}
                  playhead={playhead}
                  videoId={videoId}
                  fresh={fresh}
                  savedIds={savedIds}
                  staleCount={staleCount}
                  dataset={dataset}
                  baseName={base}
                  onLabel={labelJump}
                  onNote={noteJump}
                  onSaveAll={() => void saveRecords(fresh)}
                  onUpdateStale={() => void saveRecords(fresh.filter((r) => savedIds.has(r.id)))}
                />
              ) : rightTab === 'twist' && twist ? (
                <TwistPanel
                  result={result}
                  twist={twist}
                  hasWorld={!!twist.frames}
                  selected={jumpSel}
                  onSelect={chooseJump}
                  playhead={playhead}
                  annotation={fresh[jumpSel]?.twistTruth?.halfTwists ?? null}
                  onAnnotate={annotateTwist}
                  canAnnotate={!!fresh[jumpSel]}
                />
              ) : (
                <DebugPanel result={result} playhead={playhead} />
              )}
            </aside>
          )}
        </section>
      )}

      {result && decorations && (
        <section className="charts">
          <Chart
            title="COM height"
            unit={`m above ${result.meta.heightReference}`}
            time={result.time}
            playhead={playhead}
            confidence={result.confidence}
            decimals={2}
            minSpan={0.5}
            markers={decorations.markers}
            bands={decorations.bands}
            series={[{ label: 'Height', values: result.height, color: '--series-1' }]}
          />
          <Chart
            title="COM vertical velocity"
            unit="m/s, up = +"
            time={result.time}
            playhead={playhead}
            confidence={result.confidence}
            decimals={2}
            zeroLine
            minSpan={2}
            markers={decorations.markers}
            bands={decorations.bands}
            series={[{ label: 'Vy', values: result.vy, color: '--series-1' }]}
          />
          <Chart
            title="COM horizontal position"
            unit={`m from ${result.meta.calibrated ? 'bed center' : 'start'}, + = right`}
            time={result.time}
            playhead={playhead}
            confidence={result.confidence}
            decimals={2}
            zeroLine
            minSpan={0.5}
            guides={decorations.bedGuides}
            markers={decorations.markers}
            bands={decorations.bands}
            series={[{ label: 'x', values: result.x, color: '--series-1' }]}
          />
          <TrajectoryPlot
            result={result}
            playhead={playhead}
            calibration={calibrationModel?.ok && result.meta.calibrated ? calibrationModel.model : null}
          />
          <Chart
            title="Body orientation (continuous)"
            unit="°, keeps counting past 360"
            time={result.time}
            playhead={playhead}
            confidence={result.confidence}
            decimals={0}
            minSpan={40}
            guides={decorations.turnGuides}
            markers={decorations.markers}
            bands={decorations.bands}
            series={[{ label: 'Orientation', values: result.orientation, color: '--series-1' }]}
          />
          <Chart
            title="Body angle (wrapped)"
            unit="° from vertical, + = clockwise"
            time={result.time}
            playhead={playhead}
            confidence={result.confidence}
            zeroLine
            minSpan={20}
            breakOnJump={180}
            series={[
              { label: 'Trunk', values: result.trunkAngle, color: '--series-1' },
              { label: 'Body line', values: result.lineAngle, color: '--series-2' },
            ]}
          />
          <Chart
            title="Angular velocity"
            unit="°/s"
            time={result.time}
            playhead={playhead}
            confidence={result.confidence}
            decimals={0}
            zeroLine
            minSpan={60}
            series={[{ label: 'ω', values: result.angularVelocity, color: '--series-1' }]}
          />
          {(
            [
              ['Knee angle', 'leftKnee', 'rightKnee'],
              ['Hip angle', 'leftHip', 'rightHip'],
              ['Shoulder angle', 'leftShoulder', 'rightShoulder'],
              ['Elbow angle', 'leftElbow', 'rightElbow'],
            ] as const
          ).map(([title, l, r]) => (
            <Chart
              key={title}
              title={title}
              unit="°, 180 = straight"
              time={result.time}
              playhead={playhead}
              confidence={result.confidence}
              minSpan={30}
              series={[
                { label: 'Left', values: result.joints[l], color: '--series-1' },
                { label: 'Right', values: result.joints[r], color: '--series-2' },
              ]}
            />
          ))}
          <Chart
            title="Pose confidence"
            unit="0–1, shaded when < 0.5"
            time={result.time}
            playhead={playhead}
            decimals={2}
            yDomain={[0, 1]}
            series={[{ label: 'Confidence', values: result.confidence, color: '--series-1' }]}
          />
        </section>
      )}
    </div>
  );
}
