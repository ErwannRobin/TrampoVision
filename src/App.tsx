import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildCalibration, DEFAULT_BED_M, type Quad, type TrampolineCalibration } from './analysis/calibration';
import { computeAnalysis } from './analysis/computeAnalysis';
import { download, toCsv, toJumpsCsv } from './analysis/export';
import { extractPoseTrack } from './analysis/extractPoseTrack';
import { analysisStride } from './analysis/stride';
import { stabilizePose } from './analysis/stabilize';
import { sampleIndexAt } from './analysis/lookup';
import { exampleCounts, referencesFromRecords } from './dataset/references';
import { movementOfElement, type MovementLabel } from './dataset/movementLabel';
import {
  isStale,
  syncRecords,
  withExecution,
  withMovement,
  withTruth,
  withTwistTruth,
  type RecordContext,
} from './dataset/record';
import { useDataset } from './dataset/useDataset';
import { useReviewedReferences, useReviewUpload, useSyncSetting, useVerdictOutbox } from './sync/useReviewSync';
import { EXECUTION_RULESET } from './coaching/config';
import { withCalls } from './coaching/display';
import { buildSession, labelOf } from './coaching/session';
import { elementById } from './skills/fig/elements';
import { videoIdFromTrack, videoIdOf } from './dataset/videoId';
import type { JumpRecord } from './dataset/types';
import { analyzeTwist } from './pose3d/twist';
import { analyzeSkills } from './skills/analyzeSkills';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from './skills/config';
import { buildSkillReport, toSequencesCsv, toSkillReportJson, toSkillsCsv } from './skills/export';
import { buildPoseSeries, parsePoseSeries, toSeriesJson } from './analysis/timeSeries';
import type { PoseTrack, ScaleSource } from './analysis/types';
import type { ModelVariant, Point } from './pose/types';
import { canDecode, disposeVideo, estimateFps, loadVideo } from './video/frames';
import { loadSample, samplePath } from './video/sample';
import { dragHasFiles, pickDroppedVideo } from './video/drop';
import { transcodeToH264 } from './video/transcode';
import type { CalibrationDraw, OverlayOptions } from './video/overlay';
import { EvaluatePanel, EvaluationReport } from './ui/EvaluationView';
import { Landing } from './ui/Landing';
import { Pose3DView } from './ui/Pose3DView';
import { Playhead } from './ui/playhead';
import { StatusBanners } from './ui/StatusBanners';
import { TechnicalData } from './ui/TechnicalData';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { Icon, ActivityToast, type MenuGroupDef } from './ui/kit';
import { useLocalStorage, useReducedMotion } from './ui/hooks';
import { analysisWarnings } from './ui/quality';
import { AthleteInsights } from './ui/rail/AthleteInsights';
import { CoachRail } from './ui/rail/CoachRail';
import { LiveRail } from './ui/live/LiveRail';
import { SetupPanel } from './ui/rail/SetupPanel';
import { CalibrationBar } from './ui/stage/CalibrationBar';
import { ProcessingOverlay } from './ui/stage/ProcessingOverlay';
import { Stage } from './ui/stage/Stage';
import { Transport } from './ui/stage/Transport';
import type { Appearance, Audience, CoachTab, RailView, StageView, Status } from './ui/types';
import { useAnnotatedExport } from './ui/useAnnotatedExport';
import { plural } from './ui/format';

const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

const AUDIENCES = ['athlete', 'coach'] as const;
const ADVANCED = ['on', 'off'] as const;
const APPEARANCES = ['system', 'light', 'dark'] as const;

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

  // Skill recognition: thresholds and the jump being inspected.
  const [skillConfig, setSkillConfig] = useState<SkillConfig>(DEFAULT_SKILL_CONFIG);
  const [selectedJump, setSelectedJump] = useState(0);

  // How the interface presents itself. Athlete and coach see the same analysis; only the depth differs.
  const [audience, setAudience] = useLocalStorage<Audience>('trampovision.audience', 'athlete', AUDIENCES);
  // The default is the live view: what a coach needs on the trampoline. The advanced tools bring back the two audiences, the
  // trampoline outline, the engine settings, the exports and the saved analyses.
  const [advancedFlag, setAdvancedFlag] = useLocalStorage<'on' | 'off'>('trampovision.advanced', 'off', ADVANCED);
  const advanced = advancedFlag === 'on';
  const [appearance, setAppearance] = useLocalStorage<Appearance>('trampovision.appearance', 'system', APPEARANCES);
  const [railView, setRailView] = useState<RailView>('setup');
  const railRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  // Below 1100px the rail sits under the timeline, out of sight: opening the settings there must bring them into view.
  const showRail = useCallback(() => {
    if (!window.matchMedia('(max-width: 1099px)').matches) return;
    requestAnimationFrame(() =>
      railRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }),
    );
  }, [reducedMotion]);
  const openSetup = useCallback(() => {
    setRailView('setup');
    showRail();
  }, [showRail]);
  const [coachTab, setCoachTab] = useState<CoachTab>('skill');
  // 2D pose is the analysis; the 3D skeleton is an experimental view next to it and does not feed the classifier.
  const [stageView, setStageView] = useState<StageView>('video');
  const openedSeries = useRef(false);
  const [loop, setLoop] = useState(false);
  // The video whose analysis starts by itself once it is ready (the live view).
  const [autoUrl, setAutoUrl] = useState<string | null>(null);

  // Evaluation: which video the labels belong to, and whether the report covers this video or every saved one.
  const [videoId, setVideoId] = useState<string | null>(null);
  const [seriesName, setSeriesName] = useState<string | null>(null);
  const [evalScope, setEvalScope] = useState<'video' | 'all'>('video');
  const dataset = useDataset();

  const playhead = useMemo(() => new Playhead(), []);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null); // latest selected file, to ignore stale async results

  useEffect(() => {
    const root = document.documentElement;
    if (appearance === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', appearance);
  }, [appearance]);

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

  // Experimental 3D: twist about the longitudinal axis, from the 3D landmarks of the same frames.
  const twist = useMemo(
    () =>
      track && result
        ? analyzeTwist({ world: track.world, time: result.time, fps: result.meta.fps, cycles: result.jumps.cycles })
        : null,
    [track, result],
  );

  // The jumps the person labelled with a figure are reference examples for the classifier. Keyed on what matters, so saving a
  // note or a skill label does not redo the classification.
  // The jumps the reviewers confirmed or corrected come from the review service; the person's own labels win on the same jump.
  const sync = useSyncSetting();
  const reviewedRecords = useReviewedReferences(sync.enabled, videoId);
  const figureRecords = useMemo(() => {
    const own = dataset.records.filter((r) => r.figure);
    const ids = new Set(own.map((r) => r.id));
    return [...own, ...reviewedRecords.filter((r) => !ids.has(r.id))];
  }, [dataset.records, reviewedRecords]);
  const figureCounts = useMemo(() => exampleCounts(figureRecords), [figureRecords]);
  const figureKey = figureRecords.map((r) => `${r.id}:${r.figure?.elementId}`).join('|');
  const references = useMemo(() => referencesFromRecords(figureRecords), [figureKey]); // oxlint-disable-line react-hooks/exhaustive-deps

  // The twist feeds the classifier: 'twists' is one of its four questions.
  const skills = useMemo(
    () => (result ? analyzeSkills(result, { config: skillConfig, twist, references, videoId }) : null),
    [result, skillConfig, twist, references, videoId],
  );
  const jumpCount = skills?.jumps.length ?? 0;
  const jumpSel = Math.min(selectedJump, Math.max(0, jumpCount - 1));

  const notes = useMemo(() => (result ? analysisWarnings(result) : []), [result]);

  useEffect(() => () => abort.current?.abort(), []);

  // A new analysis starts at the first jump and shows its insights; no analysis shows the setup.
  const firstSkillPending = useRef(false);
  useEffect(() => {
    firstSkillPending.current = true;
    setSelectedJump(0);
    setRailView(track ? 'insights' : 'setup');
    // Saved data opens on the 3D skeleton: it is what there is to show until the clip is added.
    setStageView(openedSeries.current ? '3d' : 'video');
    openedSeries.current = false;
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
  const stepJump = (delta: -1 | 1) => {
    if (jumpCount === 0) return;
    const k = jumpSel + delta;
    if (k >= 0 && k < jumpCount) chooseJump(k);
  };
  /** Play the selected jump with a little run-up and landing. */
  const playJump = () => {
    const c = result?.jumps.cycles[jumpSel];
    if (c) playhead.playRange((c.takeoffTimeS ?? c.apexTimeS) - 0.4, (c.landingTimeS ?? c.apexTimeS) + 0.3, loop);
  };

  // [ and ] go to the previous and next jump.
  const stepRef = useRef(stepJump);
  stepRef.current = stepJump;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      if (e.key === '[') stepRef.current(-1);
      else if (e.key === ']') stepRef.current(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  async function onSample() {
    if (!samplePath) return;
    setStatus({ kind: 'loading', stage: 'downloading', progress: 0 });
    try {
      await onFile(
        await loadSample(samplePath, (progress) => setStatus({ kind: 'loading', stage: 'downloading', progress })),
      );
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

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
    fileRef.current = next;
    setUrl(nextUrl);
    // A stable id from the file itself, so labels stay attached to this video after a reload.
    setVideoId(null);
    setSeriesName(null);
    void videoIdOf(next).then((id) => {
      if (fileRef.current === next) setVideoId(id);
    });
    setStatus({ kind: 'loading', stage: 'reading' });
    const isCurrent = () => fileRef.current === next;
    const ctl = new AbortController();
    abort.current = ctl;
    let finalUrl = nextUrl;
    try {
      // Metadata may fail to load, or load even though the codec cannot be decoded (iPhone HEVC in
      // desktop Chrome). Either way convert to H.264 in the browser and use the converted video from here on.
      let probe: HTMLVideoElement | null = null;
      try {
        probe = await loadVideo(nextUrl);
        if (isCurrent() && !(await canDecode(probe))) {
          disposeVideo(probe);
          probe = null;
        }
      } catch {
        probe = null;
      }
      if (isCurrent() && !probe) {
        setStatus({ kind: 'loading', stage: 'converting', progress: 0 });
        const blob = await transcodeToH264(next, {
          signal: ctl.signal,
          onProgress: (progress) => {
            if (isCurrent()) setStatus({ kind: 'loading', stage: 'converting', progress });
          },
        });
        if (!isCurrent()) return;
        const convertedUrl = URL.createObjectURL(blob);
        URL.revokeObjectURL(nextUrl);
        finalUrl = convertedUrl;
        setUrl(convertedUrl);
        probe = await loadVideo(convertedUrl);
        setNotice(
          'This browser cannot decode the original file, so it was converted to H.264 (max 720p) in the browser.',
        );
      }
      if (!probe) return;
      if (isCurrent()) setStatus({ kind: 'loading', stage: 'measuring' });
      const measured = isCurrent() ? await estimateFps(probe) : null;
      disposeVideo(probe);
      if (!isCurrent()) return;
      setFps(measured ?? 30);
      if (!advanced) {
        // The live view goes straight to the analysis: a coach on the trampoline has nothing to set up first.
        if (!measured) setNotice('Could not measure the frame rate, so 30 fps is assumed.');
        setStatus({ kind: 'idle' });
        setAutoUrl(finalUrl);
        return;
      }
      setStatus(
        measured
          ? { kind: 'idle' }
          : {
              kind: 'error',
              severity: 'warning',
              message:
                'Could not measure the frame rate, so 30 fps is assumed. Set the real value under Analysis in the settings.',
            },
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
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
    // The live view analyzes about 30 frames a second, so a phone film at 60 or 120 fps does not make the wait longer.
    const strideNow = advanced ? stride : analysisStride(fps);
    if (strideNow !== stride) setStride(strideNow);
    try {
      const t = await extractPoseTrack(url, {
        model,
        numPoses,
        preferGpu,
        sourceFps: fps,
        stride: strideNow,
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
      const hint = /^Seek to /.test(msg) ? '' : ` — if the model failed to load, run "npm run fetch-assets".`;
      setStatus({ kind: 'error', message: `${msg}${hint}` });
    }
  }

  useEffect(() => {
    if (!autoUrl || autoUrl !== url || status.kind !== 'idle') return;
    setAutoUrl(null);
    void analyze();
  }, [autoUrl, url, status.kind]); // oxlint-disable-line react-hooks/exhaustive-deps

  /** Opens a saved analysis (JSON): no need to run the pose model again. */
  async function openSeries(saved: File) {
    try {
      const parsed = parsePoseSeries(await saved.text());
      openedSeries.current = true;
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
          (url ? 'Make sure the loaded video is the same clip.' : 'Add the video too to see the overlay.'),
      );
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Back to the first screen. Closing an analysis is asked for first: the numbers are not stored anywhere else. */
  function goHome() {
    if (result && !window.confirm('Close this analysis? Save it from the export menu first if you want to keep it.'))
      return;
    abort.current?.abort();
    if (url) URL.revokeObjectURL(url);
    fileRef.current = null;
    setUrl(null);
    setFile(null);
    setTrack(null);
    setBackend('');
    setNotice('');
    setStatus({ kind: 'idle' });
    setCorners([]);
    setEditingCal(false);
    setVideoId(null);
    setSeriesName(null);
    setSelectedJump(0);
    playhead.setTime(0);
  }

  // Local dataset: the jumps of this video as they would be saved now, next to what is already saved.
  const fileNameForRecords = file?.name ?? seriesName ?? 'trampovision';
  const recordCtx = useMemo<RecordContext | null>(
    () => (result && skills && videoId ? { videoId, fileName: fileNameForRecords, result, skills, twist } : null),
    [result, skills, videoId, fileNameForRecords, twist],
  );
  const videoRecords = useMemo(() => dataset.records.filter((r) => r.videoId === videoId), [dataset.records, videoId]);
  const fresh = useMemo(() => (recordCtx ? syncRecords(videoRecords, recordCtx) : []), [recordCtx, videoRecords]);
  const upload = useReviewUpload(fresh, sync.enabled);
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
  const movementJump = useCallback(
    (k: number, movement: MovementLabel | null) => {
      if (fresh[k]) void saveRecords([withMovement(fresh[k], movement)]);
    },
    [fresh, saveRecords],
  );
  const unknownJump = useCallback(
    (k: number) => {
      if (fresh[k]) void saveRecords([withTruth(withMovement(fresh[k], null), 'unknown')]);
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

  // The live view: what each skill was, its difficulty and execution. The coach's label wins over the classifier's guess.
  const labels = useMemo(() => fresh.map(labelOf), [fresh]);
  const session = useMemo(
    () => (result && skills ? buildSession({ skills, result, twist, labels }) : null),
    [result, skills, twist, labels],
  );
  // A new analysis of the live view opens on its first skill, not on a warm-up bounce.
  useEffect(() => {
    if (!firstSkillPending.current || !session) return;
    firstSkillPending.current = false;
    if (advanced) return;
    const first = session.jumps.findIndex((j) => j.isSkill);
    if (first > 0) chooseJump(first);
  }, [session]); // oxlint-disable-line react-hooks/exhaustive-deps

  // The video and the timeline say what the session says, so a correction shows at once.
  const shownSkills = useMemo(() => (skills && session ? withCalls(skills, session) : skills), [skills, session]);

  // What the coach says (the element, that it is none of them, the deduction they give) is saved in the local dataset, where a labelled skill
  // becomes a reference example for the classifier at once, and is sent to the review service, so that every device learns from it.
  const outbox = useVerdictOutbox(dataset.records, sync.enabled);
  const addToOutbox = outbox.add;
  const syncOn = sync.enabled;
  const say = useCallback(
    (record: JumpRecord | undefined) => {
      if (!record) return;
      void saveRecords([record]);
      // With the upload off nothing waits to be sent: turning it on later does not send what was said before.
      if (syncOn) addToOutbox(record.id);
    },
    [saveRecords, addToOutbox, syncOn],
  );
  const sayElement = (k: number, elementId: string) => {
    const element = elementById(elementId);
    if (element && fresh[k]) say(withMovement(fresh[k], movementOfElement(element)));
  };
  const sayConfirm = (k: number) => {
    const element = session?.jumps[k]?.element;
    if (element) sayElement(k, element.id);
  };
  const sayOther = (k: number) => {
    if (fresh[k]) say(withTruth(withMovement(fresh[k], null), 'unknown'));
  };
  const sayClear = (k: number) => {
    if (fresh[k]) void saveRecords([withMovement(fresh[k], null)]);
  };
  const sayDeduction = (k: number, deduction: number | null) => {
    const record = fresh[k];
    if (!record) return;
    const next = withExecution(record, deduction, session?.jumps[k]?.proposed ?? null, EXECUTION_RULESET);
    if (deduction === null) void saveRecords([next]);
    else say(next);
  };
  /** Jump of the current video that has this apex time (a failure card asks to see it). */
  const goToApex = (apexS: number) => {
    const k = result?.jumps.cycles.findIndex((c) => Math.abs(c.apexTimeS - apexS) <= 0.2) ?? -1;
    if (k >= 0) chooseJump(k);
  };
  const switchStageView = (v: StageView) => {
    setStageView(v);
    if (audience !== 'coach') return;
    if (v !== 'video') setCoachTab('twist');
    else if (coachTab === 'twist') setCoachTab('skill');
  };

  const analyzing = status.kind === 'analyzing';
  const loading = status.kind === 'loading';

  // Drop a video anywhere on the page. The handlers read the latest onFile/analyzing through a ref.
  const dropRef = useRef({ onFile, analyzing });
  dropRef.current = { onFile, analyzing };
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault(); // required for the drop event to fire
      if (e.dataTransfer) e.dataTransfer.dropEffect = dropRef.current.analyzing ? 'none' : 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault(); // otherwise the browser navigates to the file
      depth = 0;
      setDragging(false);
      const video = pickDroppedVideo(e.dataTransfer?.files);
      if (video && !dropRef.current.analyzing) void dropRef.current.onFile(video);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const fileName = file?.name ?? seriesName ?? 'trampovision';
  const base = fileName.replace(/\.[^.]+$/, '') || 'trampovision';

  useEffect(() => {
    document.title = url || result ? `${base} – TrampoVision` : 'TrampoVision';
  }, [url, result, base]);

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
    return `Bed scale ${(1 / m.metersPerPixel).toFixed(0)} px/m at the bed center. The camera sees the bed ${m.viewAngleDeg.toFixed(0)}° from face-on (0° = a long side).`;
  })();

  // Labels on the video say more to a coach than to an athlete.
  const overlayOpts = useMemo<OverlayOptions>(
    () => ({ ...overlay, detail: advanced && audience === 'coach' ? 'full' : 'simple' }),
    [overlay, audience, advanced],
  );

  const annotated = useAnnotatedExport({
    url,
    fps,
    result,
    skills,
    overlay: overlayOpts,
    calibration: calDraw,
    baseName: base,
    playhead,
  });

  const exportGroups = useMemo<MenuGroupDef[] | null>(() => {
    if (!result) return null;
    return [
      {
        id: 'video',
        title: 'Video',
        items: [
          {
            id: 'annotated',
            label: 'Annotated video (MP4)',
            hint: 'The video with the skeleton, trajectory, labels and trampoline outline that are visible now',
            icon: 'film',
            disabled: !url || !annotated.available || annotated.exporting,
            onSelect: () => void annotated.start(),
          },
        ],
      },
      {
        id: 'data',
        title: 'Data',
        items: [
          {
            id: 'frames',
            label: 'Frames (CSV)',
            hint: 'One row per frame',
            icon: 'download',
            onSelect: () => download(`${base}-frames.csv`, toCsv(result), 'text/csv'),
          },
          {
            id: 'jumps',
            label: 'Jumps (CSV)',
            hint: 'One row per jump',
            icon: 'download',
            onSelect: () => download(`${base}-jumps.csv`, toJumpsCsv(result), 'text/csv'),
          },
          {
            id: 'series',
            label: 'Save analysis (JSON)',
            hint: 'Every frame: all joints with scores, center of mass, orientation, phase, plus the raw model output. Open it later to skip the analysis.',
            icon: 'download',
            disabled: !track,
            onSelect: () =>
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
              ),
          },
        ],
      },
      {
        id: 'skills',
        title: 'Skills',
        items: [
          {
            id: 'skills-json',
            label: 'Skills report (JSON)',
            hint: 'Per jump: normalized sequence, features, prediction with evidence, and the thresholds used',
            icon: 'download',
            disabled: !skills,
            onSelect: () =>
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
              ),
          },
          {
            id: 'skills-csv',
            label: 'Skills (CSV)',
            hint: 'One row per jump: features and prediction',
            icon: 'download',
            disabled: !skills,
            onSelect: () => skills && download(`${base}-skills.csv`, toSkillsCsv(skills), 'text/csv'),
          },
          {
            id: 'sequences-csv',
            label: 'Sequences (CSV)',
            hint: 'One row per jump and normalized sample',
            icon: 'download',
            disabled: !skills,
            onSelect: () => skills && download(`${base}-sequences.csv`, toSequencesCsv(skills), 'text/csv'),
          },
        ],
      },
    ];
  }, [result, skills, track, url, base, fileName, videoId, stride, calibration, annotated]);

  const hasClip = !!url || !!result;
  // Both audiences of the advanced tools can pick the view. Without a clip only the 3D skeleton has anything to show. The live view is the video.
  const view: StageView = !advanced ? 'video' : !url && twist ? '3d' : stageView;
  const clipDetail = result
    ? `${jumpCount} ${plural(jumpCount, 'jump')}, ${(result.time[result.time.length - 1] ?? 0).toFixed(1)} s`
    : '';

  const pane =
    view !== 'video' && result && track && twist ? (
      <Pose3DView
        track={track}
        result={result}
        twist={twist}
        selected={jumpSel}
        playhead={playhead}
        baseName={base}
        sideBySide={url ? { url, fps, skills, overlay: overlayOpts, calibration: calDraw } : null}
        fill
      />
    ) : null;

  const setup = (
    <SetupPanel
      advanced={advanced}
      onAdvanced={(on) => setAdvancedFlag(on ? 'on' : 'off')}
      review={
        sync.available
          ? { enabled: sync.enabled, onEnabled: sync.setEnabled, state: upload.state, posted: upload.posted }
          : undefined
      }
      hasVideo={!!url}
      hasResult={!!result}
      busy={analyzing ? 'analyzing' : loading ? 'loading' : 'idle'}
      fileName={file?.name ?? seriesName}
      model={model}
      onModel={setModel}
      numPoses={numPoses}
      onNumPoses={setNumPoses}
      stride={stride}
      onStride={setStride}
      preferGpu={preferGpu}
      onPreferGpu={setPreferGpu}
      fps={fps}
      onFps={(next) => {
        if (next === fps) return;
        setFps(next);
        setTrack(null);
      }}
      backend={backend}
      webgpu={webgpu}
      onAnalyze={() => void analyze()}
      onCancel={() => abort.current?.abort()}
      height={height}
      onHeight={(m) => setHeight(m || 1.75)}
      calibration={{
        corners,
        editing: editingCal,
        bedLong,
        bedShort,
        firstSide,
        scaleSource,
        status: calStatus,
        error: !!calibrationModel && !calibrationModel.ok,
      }}
      onEditCalibration={setEditingCal}
      onUndoCorner={() => setCorners(corners.slice(0, -1))}
      onClearCalibration={() => {
        setCorners([]);
        setEditingCal(true);
      }}
      onBedLong={(m) => setBedLong(m || DEFAULT_BED_M.long)}
      onBedShort={(m) => setBedShort(m || DEFAULT_BED_M.short)}
      onFirstSide={setFirstSide}
      onScaleSource={setScaleSource}
      onSample={samplePath ? () => void onSample() : null}
      onOpenSeries={(f) => void openSeries(f)}
      appearance={appearance}
      onAppearance={setAppearance}
      onClose={result ? () => setRailView('insights') : undefined}
    />
  );

  const review =
    result && skills ? (
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
        onMovement={movementJump}
        onUnknown={unknownJump}
        exampleCounts={figureCounts}
        onNote={noteJump}
        onSaveAll={() => void saveRecords(fresh)}
        onUpdateStale={() => void saveRecords(fresh.filter((r) => savedIds.has(r.id)))}
      />
    ) : null;

  return (
    <div className="app" data-audience={audience} data-mode={advanced ? 'advanced' : 'live'}>
      {dragging && (
        <div className="dropzone" role="presentation">
          <Icon name="upload" size={40} strokeWidth={1.5} />
          <span className="dropzone__title">{analyzing ? 'Analysis in progress' : 'Drop a video to analyze it'}</span>
          <span className="dropzone__text">{analyzing ? 'Wait for it to finish first.' : 'MP4 or MOV'}</span>
        </div>
      )}

      <TopBar
        clip={hasClip ? { name: fileName, detail: clipDetail } : null}
        audience={audience}
        onAudience={setAudience}
        showAudience={!!result && advanced}
        exportGroups={advanced ? exportGroups : null}
        setupOpen={!!result && railView === 'setup'}
        onToggleSetup={() => (railView === 'setup' ? setRailView('insights') : openSetup())}
        onFile={hasClip && !analyzing ? (f) => void onFile(f) : null}
        onHome={hasClip && !analyzing ? goHome : null}
      />

      <StatusBanners
        status={status}
        notice={notice}
        exportError={annotated.error}
        onDismissStatus={() => setStatus({ kind: 'idle' })}
        onDismissNotice={() => setNotice('')}
        onDismissExportError={annotated.clearError}
      />

      <main className="app__main">
        {hasClip && <h1 className="sr-only">{result ? `Analysis of ${fileName}` : `Set up ${fileName}`}</h1>}
        {!hasClip ? (
          <>
            {loading && (
              <div className="busy--page">
                <ProcessingOverlay
                  status={status}
                  ready={false}
                  fileName=""
                  backend=""
                  onAnalyze={() => undefined}
                  onCancel={() => undefined}
                />
              </div>
            )}
            <Landing
              onFile={(f) => void onFile(f)}
              onSample={samplePath ? () => void onSample() : null}
              onOpenSeries={(f) => void openSeries(f)}
              dataset={dataset}
              busy={loading}
              advanced={advanced}
            />
          </>
        ) : (
          <>
            <div className="workspace">
              <div className="workspace__stage">
                <Stage
                  url={url}
                  fps={fps}
                  result={result}
                  skills={shownSkills}
                  overlay={overlayOpts}
                  playhead={playhead}
                  speed={speed}
                  calibration={calDraw}
                  onCornersChange={setCorners}
                  onError={(message) => setStatus({ kind: 'error', message })}
                  onPickVideo={(f) => void onFile(f)}
                  view={view}
                  onView={advanced && result && twist ? switchStageView : undefined}
                  pane={pane}
                >
                  {editingCal && (
                    <CalibrationBar
                      corners={corners.length}
                      onUndo={() => setCorners(corners.slice(0, -1))}
                      onClear={() => setCorners([])}
                      onDone={() => setEditingCal(false)}
                    />
                  )}
                  <ProcessingOverlay
                    status={status}
                    ready={!!url && !result && !editingCal && !autoUrl}
                    fileName={file?.name ?? ''}
                    backend={backend}
                    onAnalyze={() => void analyze()}
                    onCancel={() => abort.current?.abort()}
                  />
                </Stage>
              </div>

              <div className="workspace__dock sheet">
                {url && (
                  <Transport
                    playhead={playhead}
                    fps={fps}
                    speed={speed}
                    onSpeed={setSpeed}
                    overlay={overlay}
                    onOverlay={setOverlay}
                    hasVideo
                    hasResult={!!result}
                    simple={!advanced}
                  />
                )}
                {result && (
                  <Timeline
                    result={result}
                    skills={shownSkills}
                    playhead={playhead}
                    selected={jumpCount ? jumpSel : null}
                    onSelect={setSelectedJump}
                    onStepJump={stepJump}
                    onPlayJump={playJump}
                    loop={loop}
                    onLoop={setLoop}
                  />
                )}
              </div>

              <aside
                ref={railRef}
                className="workspace__rail sheet"
                aria-label={railView === 'setup' || !result ? 'Settings' : 'Analysis'}
              >
                {!result || !skills || railView === 'setup' ? (
                  setup
                ) : !advanced && session ? (
                  <LiveRail
                    session={session}
                    selected={jumpSel}
                    onSelect={chooseJump}
                    onPlayJump={playJump}
                    onConfirm={sayConfirm}
                    onPick={sayElement}
                    onOther={sayOther}
                    onClear={sayClear}
                    onDeduction={sayDeduction}
                    canLabel={!!videoId}
                    onOpenSetup={openSetup}
                    onShowAdvanced={() => {
                      setAdvancedFlag('on');
                      setAudience('coach');
                    }}
                    notes={notes}
                    title={base}
                  />
                ) : audience === 'athlete' ? (
                  <AthleteInsights
                    result={result}
                    skills={shownSkills ?? skills}
                    selected={jumpSel}
                    onSelect={chooseJump}
                    onPlayJump={playJump}
                    onOpenSetup={openSetup}
                    onShowCoach={() => setAudience('coach')}
                    notes={notes}
                  />
                ) : (
                  <CoachRail
                    tab={coachTab}
                    onTab={setCoachTab}
                    result={result}
                    skills={skills}
                    selected={jumpSel}
                    onSelect={chooseJump}
                    onPlayJump={playJump}
                    playhead={playhead}
                    config={skillConfig}
                    onConfig={setSkillConfig}
                    twist={twist}
                    annotation={fresh[jumpSel]?.twistTruth?.halfTwists ?? null}
                    onAnnotate={annotateTwist}
                    canAnnotate={!!fresh[jumpSel]}
                    review={review}
                    notes={notes}
                  />
                )}
              </aside>
            </div>

            {result && advanced && audience === 'coach' && (
              <div className="app__technical">
                <TechnicalData
                  result={result}
                  skills={skills}
                  track={track}
                  twist={twist}
                  playhead={playhead}
                  selected={jumpSel}
                  calibration={calibrationModel?.ok && result.meta.calibrated ? calibrationModel.model : null}
                  validation={
                    coachTab === 'review' ? (
                      <EvaluationReport
                        records={dataset.records}
                        videoId={videoId}
                        scope={evalScope}
                        onScope={setEvalScope}
                        baseName={base}
                        onGoTo={goToApex}
                      />
                    ) : undefined
                  }
                />
              </div>
            )}
          </>
        )}
      </main>

      {annotated.exporting && (
        <ActivityToast
          label="Exporting the annotated video"
          progress={annotated.progress ?? 0}
          onCancel={annotated.cancel}
        />
      )}
    </div>
  );
}
