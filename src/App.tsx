import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCalibration,
  calibrationErrorText,
  DEFAULT_BED_M,
  type Quad,
  type TrampolineCalibration,
} from './analysis/calibration';
import { computeAnalysis } from './analysis/computeAnalysis';
import { download, toCsv, toJumpsCsv } from './analysis/export';
import { keepAthletes } from './analysis/athletes';
import { extractPoseTracks } from './analysis/extractPoseTrack';
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
import { withNote } from './dataset/stageLabel';
import { useDataset } from './dataset/useDataset';
import type { SetSnapshot } from './history/autosave';
import { useAutosave, useHistory } from './history/useHistory';
import { useReviewedReferences, useReviewUpload, useSyncSetting, useVerdictOutbox } from './sync/useReviewSync';
import { EXECUTION_RULESET } from './coaching/config';
import { withCalls } from './coaching/display';
import { detectRoutineStart, routineStartJump, routineStartTime, type RoutineMark } from './coaching/routine';
import { buildSession, labelOf } from './coaching/session';
import { elementById } from './skills/fig/elements';
import { videoIdFromTrack, videoIdOf } from './dataset/videoId';
import type { JumpRecord } from './dataset/types';
import { analyzeTwist } from './pose3d/twist';
import { analyzeSkills } from './skills/analyzeSkills';
import { analyzeTwist2d } from './skills/twist2d';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from './skills/config';
import { buildSkillReport, toSequencesCsv, toSkillReportJson, toSkillsCsv } from './skills/export';
import { buildPoseSeriesSet, parsePoseSeries, toSeriesJson, type ParsedSeries } from './analysis/timeSeries';
import type { PoseTrack, ScaleSource } from './analysis/types';
import type { ModelVariant, Point, PoseEngineId } from './pose/types';
import { canDecode, decodeProblem, disposeVideo, estimateFps, loadVideo, SeekTimeoutError } from './video/frames';
import { fitTrackToClip } from './motion/fitTrack';
import { receiveHandoff } from './motion/handoff';
import { loadSample, loadSampleSeries, loadSamples, type Sample } from './video/sample';
import { dragHasFiles, pickDroppedSeries, pickDroppedVideo } from './video/drop';
import { matchClip, type ClipIdentity } from './analysis/seriesMatch';
import { transcodeToH264 } from './video/transcode';
import type { CalibrationDraw, OverlayOptions } from './video/overlay';
import { EvaluatePanel, EvaluationReport } from './ui/EvaluationView';
import { setName } from './ui/chrome/RecentSets';
import { Landing } from './ui/Landing';
import { Pose3DView } from './ui/Pose3DView';
import { Playhead, PlayheadContext } from './ui/playhead';
import { StatusBanners } from './ui/StatusBanners';
import { TechnicalData } from './ui/TechnicalData';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { About } from './ui/About';
import { useAbout } from './ui/chrome/aboutRoute';
import { useReviewRoute } from './ui/chrome/reviewRoute';
import { ReviewMode } from './ui/review/mode/ReviewMode';
import { Icon, ActivityToast, type MenuGroupDef } from './ui/kit';
import { useLocalStorage } from './ui/hooks';
import { analysisWarnings } from './ui/quality';
import { AthleteInsights } from './ui/rail/AthleteInsights';
import { AthleteCompare } from './ui/rail/compare/AthleteCompare';
import { ATHLETE_TINTS, type AthleteView } from './ui/rail/compare/compare';
import { CoachRail } from './ui/rail/CoachRail';
import { LiveRail } from './ui/live/LiveRail';
import { SettingsDialog } from './ui/chrome/SettingsDialog';
import { ReadyCard } from './ui/rail/ReadyCard';
import { CalibrationBar } from './ui/stage/CalibrationBar';
import { ProcessingOverlay } from './ui/stage/ProcessingOverlay';
import { clipOrientation, type Size } from './ui/stage/fit';
import { hudJumps } from './ui/stage/hud';
import { Stage, type OtherAthlete } from './ui/stage/Stage';
import { Transport } from './ui/stage/Transport';
import type { Appearance, Audience, CoachTab, StageView, Status } from './ui/types';
import { useAnnotatedExport } from './ui/useAnnotatedExport';
import { formatNumber, t, tp, useLocale } from './i18n';
import { fmt } from './ui/format';

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

/** The id of the clip, whichever athlete's id it is given. */
const clipVideoId = (id: string) => id.replace(/#\d+$/, '');

/** What a video file is, to tell whether a saved analysis is of it. Its size and length stay unknown when the browser cannot decode it. */
async function clipOfVideo(file: File): Promise<ClipIdentity> {
  const videoId = await videoIdOf(file);
  const url = URL.createObjectURL(file);
  try {
    const probe = await loadVideo(url);
    const clip = { videoId, width: probe.videoWidth, height: probe.videoHeight, durationS: probe.duration };
    disposeVideo(probe);
    return clip;
  } catch {
    return { videoId, width: 0, height: 0, durationS: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clipOfSeries({ source, track }: ParsedSeries): ClipIdentity {
  return { videoId: source.videoId, width: track.width, height: track.height, durationS: track.times.at(-1) ?? null };
}

/** Each athlete of a clip is a video of their own for the labels: the first keeps the id of the clip. */
function athleteVideoId(base: string | null, index: number): string | null {
  return base && index > 0 ? `${base}#${index + 1}` : base;
}

/** The masked copy of the clip that the pose model reads, and the clip it stands for. */
interface MaskedCopy {
  url: string;
  /** Its own frame rate: it holds only the frames that are analyzed. */
  fps: number;
  /** The size of the clip that is shown. */
  clip: { width: number; height: number };
}

/**
 * Opens the masked copy of a clip of the size `clip`: an object URL for the pose model, and the rate of its frames. The motion page writes
 * VP9 in the MP4 where its browser cannot encode H.264, and a browser may not decode that: it is then converted to H.264, like an original.
 */
async function openMasked(
  file: File,
  clip: MaskedCopy['clip'],
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<MaskedCopy> {
  let url = URL.createObjectURL(file);
  try {
    let probe: HTMLVideoElement | null = null;
    try {
      probe = await loadVideo(url);
      if (!(await canDecode(probe))) {
        disposeVideo(probe);
        probe = null;
      }
    } catch {
      probe = null;
    }
    if (!probe) {
      onProgress(0);
      const blob = await transcodeToH264(file, { signal, onProgress });
      URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      probe = await loadVideo(url);
    }
    const measured = await estimateFps(probe);
    disposeVideo(probe);
    return { url, fps: measured ?? 30, clip };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function AppView({ playhead }: { playhead: Playhead }) {
  // Text made while analyzing (skill names, tips, warnings) follows the language: it is made again when the language changes.
  const locale = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState(30);
  const [model, setModel] = useState<ModelVariant>('full');
  // Experimental: another pose model than MediaPipe. Only used with the advanced tools on, which are where it is picked.
  const [engine, setEngine] = useState<PoseEngineId>('mediapipe');
  // Athletes to follow; 0 = the app decides: everybody who jumps.
  const [numPoses, setNumPoses] = useState(0);
  const [stride, setStride] = useState(1);
  const [preferGpu, setPreferGpu] = useState(true);
  const [height, setHeight] = useState(1.75);
  const [speed, setSpeed] = useState(1);
  // Where the routine starts: what the analysis detected (undefined), a jump chosen by hand, or no mark (null: the clip is the routine).
  const [routineMark, setRoutineMark] = useState<RoutineMark>(undefined);
  const [overlay, setOverlay] = useState<OverlayOptions>({ skeleton: true, com: true, trail: true, hud: true });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [backend, setBackend] = useState('');
  // One track per athlete followed in the clip; everything below (analysis, skills, exports) is about the one chosen.
  const [tracks, setTracks] = useState<PoseTrack[]>([]);
  const [athleteIdx, setAthleteIdx] = useState(0);
  const athleteCount = tracks.length;
  const track = tracks[Math.min(athleteIdx, Math.max(0, athleteCount - 1))] ?? null;
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
  // The settings are a popup over the app: from the first screen as well as from an open clip.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useAbout();
  // The review mode: one jump at a time, with the buttons that say what it was. It takes the place of the rail.
  const [reviewOpen, setReviewOpen] = useReviewRoute();
  const openSetup = useCallback(() => setSettingsOpen(true), []);
  const closeSetup = useCallback(() => setSettingsOpen(false), []);
  const [coachTab, setCoachTab] = useState<CoachTab>('skill');
  // 2D pose is the analysis; the 3D skeleton is an experimental view next to it and does not feed the classifier.
  const [stageView, setStageView] = useState<StageView>('video');
  // The size of the clip's frames, once the stage knows it: a wide screen lays the page out for a portrait clip.
  const [clipSize, setClipSize] = useState<Size | null>(null);
  const openedSeries = useRef(false);
  const [loop, setLoop] = useState(false);
  const [boomerang, setBoomerang] = useState(false);
  // The video whose analysis starts by itself once it is ready (the live view).
  const [autoUrl, setAutoUrl] = useState<string | null>(null);

  // Evaluation: which video the labels belong to, and whether the report covers this video or every saved one.
  const [fileVideoId, setVideoId] = useState<string | null>(null);
  // Labels are kept per video: each athlete of a clip is a video of their own, so their jumps never mix.
  const videoId = athleteVideoId(fileVideoId, athleteIdx);
  // All the athletes next to each other, instead of one at a time.
  const [compare, setCompare] = useState(false);
  const comparing = compare && athleteCount > 1;
  const [seriesName, setSeriesName] = useState<string | null>(null);
  const [evalScope, setEvalScope] = useState<'video' | 'all'>('video');
  const dataset = useDataset();
  // Every finished analysis is kept on this device, so a set survives leaving it (see history/).
  const history = useHistory();

  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null); // latest selected file, to ignore stale async results
  // The masked copy of the clip (from the motion detector) that the pose model reads while the clip is what is shown; null without one.
  const maskedRef = useRef<MaskedCopy | null>(null);
  /** The masked copy could not be opened: the analysis reads the original, and says so (it starts by clearing the notice). */
  // The notice about a masked copy that could not be opened ('' when it was).
  const maskedFailed = useRef('');

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
    [track, result, locale], // oxlint-disable-line react-hooks/exhaustive-deps
  );
  // The twist counted from the 2D skeleton: used when the 3D one is missing or not reliable, a second opinion otherwise. It reads
  // the raw landmarks, not the smoothed ones, which would flatten a fast twist.
  const twist2d = useMemo(
    () =>
      track && result
        ? analyzeTwist2d({ frames: track.frames, time: result.time, fps: result.meta.fps, cycles: result.jumps.cycles })
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
    () => (result ? analyzeSkills(result, { config: skillConfig, twist, twist2d, references, videoId }) : null),
    [result, skillConfig, twist, twist2d, references, videoId, locale], // oxlint-disable-line react-hooks/exhaustive-deps
  );
  // The side by side view needs every athlete analyzed; the chosen one is already done.
  const athleteViews = useMemo<AthleteView[]>(() => {
    if (!comparing) return [];
    return tracks.map((tr, i) => {
      if (i === athleteIdx && result && skills) return { result, skills };
      const r = computeAnalysis(
        tr,
        { athleteHeightM: height, calibration: analysisCalibration, scaleSource },
        stabilizePose(tr),
      );
      const tw = analyzeTwist({ world: tr.world, time: r.time, fps: r.meta.fps, cycles: r.jumps.cycles });
      return {
        result: r,
        skills: analyzeSkills(r, {
          config: skillConfig,
          twist: tw,
          twist2d: analyzeTwist2d({ frames: tr.frames, time: r.time, fps: r.meta.fps, cycles: r.jumps.cycles }),
          references,
          videoId: athleteVideoId(fileVideoId, i),
        }),
      };
    });
  }, [
    comparing,
    tracks,
    athleteIdx,
    result,
    skills,
    height,
    analysisCalibration,
    scaleSource,
    skillConfig,
    references,
    fileVideoId,
    locale,
  ]); // oxlint-disable-line react-hooks/exhaustive-deps
  const others = useMemo<OtherAthlete[]>(
    () =>
      athleteViews.flatMap((v, i) =>
        i === athleteIdx ? [] : [{ result: v.result, tint: ATHLETE_TINTS[i % ATHLETE_TINTS.length] }],
      ),
    [athleteViews, athleteIdx],
  );
  const jumpCount = skills?.jumps.length ?? 0;
  const jumpSel = Math.min(selectedJump, Math.max(0, jumpCount - 1));

  const notes = useMemo(() => (result ? analysisWarnings(result) : []), [result, locale]); // oxlint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    let live = true;
    void loadSamples().then((found) => live && setSamples(found));
    return () => {
      live = false;
    };
  }, []);

  // The motion detector's page (/motion.html, advanced tools) sends its result here: the clip, which opens like a chosen one, and its masked copy,
  // which the pose model reads in place of the clip.
  useEffect(() => {
    let live = true;
    receiveHandoff().then(
      (video) => {
        if (live && video) void onFile(video.original, undefined, video.masked);
      },
      (err) => live && setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps

  // A new analysis starts at the first jump.
  const firstSkillPending = useRef(false);
  useEffect(() => {
    firstSkillPending.current = true;
    setSelectedJump(0);
    setRoutineMark(undefined);
    // Saved data opens on the 3D skeleton: it is what there is to show until the clip is added.
    setStageView(openedSeries.current ? '3d' : 'video');
    openedSeries.current = false;
  }, [track]);

  // While the video plays or is scrubbed, the jump view follows the jump under the playhead.
  const selectedRef = useRef(0);
  selectedRef.current = jumpSel;
  // The review mode loops one jump and keeps it selected: the run-up and the landing must not move the selection.
  // "Play jump" keeps its jump selected while the playhead stays in its range, even after it stops: the run-up and
  // the landing can touch the neighbouring jumps. Moving out of the range (scrub, normal play) frees the selection.
  const rangeLock = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!result || reviewOpen) return;
    const unsubscribe = playhead.subscribe(() => {
      const t = playhead.getSnapshot();
      const lock = rangeLock.current;
      if (lock) {
        if (t >= lock.from - 0.1 && t <= lock.to + 0.1) return;
        rangeLock.current = null;
      }
      const idx = result.jumps.cycleIndex[sampleIndexAt(result.meta, t)];
      if (idx >= 0 && idx !== selectedRef.current) setSelectedJump(idx);
    });
    return () => {
      unsubscribe();
      rangeLock.current = null;
    };
  }, [result, playhead, reviewOpen]);

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
    if (!c) return;
    // Looping starts right at takeoff and a boomerang turns right at landing; a single play keeps the run-up and landing.
    const from = (c.takeoffTimeS ?? c.apexTimeS) - (loop ? 0 : 0.4);
    const to = (c.landingTimeS ?? c.apexTimeS) + (boomerang ? 0 : 0.3);
    rangeLock.current = { from, to };
    playhead.playRange(from, to, loop, boomerang);
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

  async function onSample(sample: Sample) {
    setStatus({ kind: 'loading', stage: 'downloading', progress: 0 });
    try {
      // The saved analysis (when the store has one) comes along with the video: the pose model is then skipped.
      const [video, series] = await Promise.all([
        loadSample(sample.path, (progress) => setStatus({ kind: 'loading', stage: 'downloading', progress })),
        loadSampleSeries(sample),
      ]);
      await onFile(video, series ?? undefined);
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * `series`: the saved analysis of this very video (a sample's): opened in place of running the pose model.
   * `masked`: the same clip with the background hidden: it is shown as `next` is, and the pose model reads it.
   */
  async function onFile(next: File, series?: string, masked?: File) {
    abort.current?.abort();
    if (url) URL.revokeObjectURL(url);
    dropMasked();
    const nextUrl = URL.createObjectURL(next);
    setTracks([]);
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
      // Why it is converted: shown with the notice, as a phone has no console to read.
      let why = '';
      try {
        probe = await loadVideo(nextUrl);
        const problem = isCurrent() ? await decodeProblem(probe) : null;
        if (problem) {
          why = problem;
          disposeVideo(probe);
          probe = null;
        }
      } catch (err) {
        why = err instanceof Error ? err.message : String(err);
        probe = null;
      }
      if (isCurrent() && !probe) {
        console.warn(`Video converted to H.264, as it cannot be decoded as it is: ${why} [${next.type || 'no type'}]`);
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
        setNotice(`${t('app.converted')} (${why}; ${next.type || '?'}, ${(next.size / 1e6).toFixed(1)} MB)`);
      }
      if (!probe) return;
      if (isCurrent()) setStatus({ kind: 'loading', stage: 'measuring' });
      const measured = isCurrent() ? await estimateFps(probe) : null;
      const shown = { width: probe.videoWidth, height: probe.videoHeight };
      disposeVideo(probe);
      if (!isCurrent()) return;
      setFps(measured ?? 30);
      if (masked) {
        try {
          const copy = await openMasked(masked, shown, ctl.signal, (progress) => {
            if (isCurrent()) setStatus({ kind: 'loading', stage: 'converting', progress });
          });
          if (!isCurrent()) {
            URL.revokeObjectURL(copy.url);
            return;
          }
          maskedRef.current = copy;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Without the masked copy the original is analyzed, background and all: better than no analysis.
          if (!isCurrent()) return;
          // The cause goes with the notice: on a phone there is no console to read it in.
          maskedFailed.current = `${t('app.maskedFallback')} (${err instanceof Error ? err.message : String(err)})`;
          setNotice(maskedFailed.current);
        }
      }
      if (series && openSeriesText(series, next.name, { withVideo: true })) return;
      if (!advanced) {
        // The live view goes straight to the analysis: a coach on the trampoline has nothing to set up first.
        if (!measured) setNotice(t('app.fpsAssumed'));
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
              message: t('app.fpsAssumedAdvanced'),
            },
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (isCurrent()) setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Lets go of the masked copy of the clip, when there is one. */
  function dropMasked() {
    if (maskedRef.current) URL.revokeObjectURL(maskedRef.current.url);
    maskedRef.current = null;
    maskedFailed.current = '';
  }

  async function analyze() {
    if (!url) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setTracks([]);
    setNotice(maskedFailed.current);
    // The pose model loads first, which can take long (a download for the experimental ones).
    setStatus({ kind: 'loading', stage: 'model' });
    // The live view analyzes about 30 frames a second, so a phone film at 60 or 120 fps does not make the wait longer.
    const strideNow = advanced ? stride : analysisStride(fps);
    if (strideNow !== stride) setStride(strideNow);
    try {
      // With a masked copy, the pose model reads it at its own rate (it holds only the frames that are analyzed): every frame of it.
      const masked = maskedRef.current;
      const read = await extractPoseTracks(masked?.url ?? url, {
        engine: advanced ? engine : 'mediapipe',
        model,
        numPoses,
        preferGpu,
        sourceFps: masked ? masked.fps : fps,
        stride: masked ? 1 : strideNow,
        signal: ctl.signal,
        onBackend: setBackend,
        onLoad: (progress) => setStatus({ kind: 'loading', stage: 'model', progress }),
        onProgress: (done, total) => setStatus({ kind: 'analyzing', done, total }),
      });
      const ts = masked
        ? read.map((tr) => fitTrackToClip(tr, { ...masked.clip, sourceFps: fps, stride: strideNow }))
        : read;
      // Left to the app, the people who do not jump (a coach, a judge) are not athletes.
      const athletes =
        numPoses > 0
          ? ts
          : keepAthletes(
              ts,
              (tr) =>
                computeAnalysis(
                  tr,
                  { athleteHeightM: height, calibration: null, scaleSource: 'athlete' },
                  stabilizePose(tr),
                ).summary.jumpCount,
            );
      setAthleteIdx(0);
      // Several athletes are shown together first: that is what they were filmed for.
      setCompare(athletes.length > 1);
      setTracks(athletes);
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus({ kind: 'idle' });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const hint = err instanceof SeekTimeoutError ? '' : t('app.fetchAssets');
      setStatus({ kind: 'error', message: `${msg}${hint}` });
    }
  }

  useEffect(() => {
    if (!autoUrl || autoUrl !== url || status.kind !== 'idle') return;
    setAutoUrl(null);
    void analyze();
  }, [autoUrl, url, status.kind]); // oxlint-disable-line react-hooks/exhaustive-deps

  /** Opens a saved analysis (JSON): no need to run the pose model again. Null when the text is not one (the error is shown). */
  function openSeriesText(text: string, name: string, opts?: { withVideo: boolean }): ParsedSeries | null {
    try {
      const parsed = parsePoseSeries(text);
      // A series opened over its own video (a sample) stays on the video, and keeps the id of that file.
      openedSeries.current = !opts?.withVideo;
      setAthleteIdx(0);
      setTracks(parsed.tracks);
      setCompare(parsed.tracks.length > 1);
      setSeriesName(parsed.source.fileName);
      if (!opts?.withVideo) {
        setVideoId(parsed.source.videoId ?? fileVideoId ?? videoIdFromTrack(parsed.source.fileName, parsed.track));
      }
      setBackend(t('app.fromFile', { backend: parsed.source.backend }));
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
        opts?.withVideo
          ? ''
          : t(url ? 'app.openedWithVideo' : 'app.openedNoVideo', { name, frames: parsed.track.frames.length }),
      );
      return parsed;
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  async function openSeries(saved: File) {
    let text: string;
    try {
      text = await saved.text();
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    openSeriesText(text, saved.name);
  }

  /** Back to the first screen. The set is stored by then (autosave): only when that did not work is the coach asked first. */
  async function goHome() {
    if (result && !(await autosave.flush()) && !window.confirm(t('app.closeAnalysis'))) return;
    autosave.reset();
    abort.current?.abort();
    if (url) URL.revokeObjectURL(url);
    dropMasked();
    fileRef.current = null;
    setUrl(null);
    setFile(null);
    setTracks([]);
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
    () =>
      result && skills && videoId
        ? { videoId, fileName: fileNameForRecords, result, skills, twist, world: track?.world }
        : null,
    [result, skills, videoId, fileNameForRecords, twist, track],
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
      if (r?.truth) void saveRecords([withNote(r, note)]);
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
    [result, skills, twist, labels, locale], // oxlint-disable-line react-hooks/exhaustive-deps
  );
  // What the full screen says about each jump.
  const fullscreenJumps = useMemo(() => hudJumps(session), [session]);
  /** The saved analysis of the clip: every athlete followed in it, the one on screen first. */
  function serializeSeries(name: string, id: string | null, cal: typeof calibration): string {
    const athletes = tracks.map((tr, i) => ({
      result:
        i === athleteIdx && result
          ? result
          : computeAnalysis(
              tr,
              { athleteHeightM: height, calibration: analysisCalibration, scaleSource },
              stabilizePose(tr),
            ),
      track: tr,
      videoId: athleteVideoId(id, i) ?? undefined,
    }));
    return toSeriesJson(buildPoseSeriesSet(athletes, { fileName: name, stride, minVisibility: 0.4, calibration: cal }));
  }
  // The set on screen, as the recent sets keep it: stored when the analysis completes, and again whenever what the live view says about
  // it changes (a skill the coach confirms, changes or deletes). Only when the saved records are read, so a set that is reopened has its labels.
  const setSnapshot = useMemo<SetSnapshot | null>(() => {
    if (!track || !result || !session || !videoId || !dataset.ready) return null;
    const name = file?.name ?? seriesName ?? '';
    return {
      id: clipVideoId(videoId),
      fileName: name,
      track,
      settingsKey: JSON.stringify([height, scaleSource, stride, analysisCalibration]),
      skills: session.summary.skills,
      pending: session.summary.pending,
      difficulty: session.summary.difficulty,
      jumps: session.jumps.length,
      serialize: () => serializeSeries(name, clipVideoId(videoId), analysisCalibration),
    };
  }, [
    track,
    result,
    session,
    videoId,
    dataset.ready,
    file,
    seriesName,
    height,
    scaleSource,
    stride,
    analysisCalibration,
  ]);
  const autosave = useAutosave(history, setSnapshot);

  /** Reopens a recent set: the same analysis, with no video. Its line in the list is already up to date, so nothing is written. */
  async function openRecent(id: string) {
    const stored = await history.load(id);
    if (!stored) {
      setStatus({ kind: 'error', severity: 'warning', message: t('landing.recentMissing') });
      void history.remove(id);
      return;
    }
    const parsed = openSeriesText(stored.series, setName(stored));
    if (parsed) autosave.adopt(stored, parsed.track);
  }

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

  // The routine starts at its first skill. The mark is detected, and can be moved to any jump or taken off.
  const detectedStart = useMemo(() => (session ? detectRoutineStart(session.jumps) : null), [session]);
  const routineJump = routineStartJump(routineMark, detectedStart, jumpCount);
  const clipStartS = result?.time[0] ?? 0;
  const routineStartS = useMemo(
    () => (result && routineJump !== null ? routineStartTime(result.jumps.cycles[routineJump], clipStartS) : null),
    [result, routineJump, clipStartS],
  );
  /** Back to the start of the routine, or of the clip when there is none. */
  const goToStart = () => playhead.seek(routineStartS ?? clipStartS);

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
  const reviewing = reviewOpen && !!result && !!skills && !comparing;
  // Slow motion is what labeling needs: the first time the review opens, a clip at normal speed goes to half speed.
  useEffect(() => {
    if (reviewing) setSpeed((s) => (s === 1 ? 0.5 : s));
  }, [reviewing]);
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

  // Loading the pose model is part of the analysis: the controls stay locked, nothing else can start.
  const analyzing = status.kind === 'analyzing' || (status.kind === 'loading' && status.stage === 'model');
  const loading = status.kind === 'loading';

  /**
   * What is dropped on the page: a video, a saved analysis, or both. An analysis meets the video that is open (or the one dropped
   * with it) only when it is of that clip, and a video dropped on an analysis that has none is added to it when it is its clip.
   */
  async function onDropped(files: ArrayLike<File> | null | undefined) {
    const video = pickDroppedVideo(files);
    const saved = pickDroppedSeries(files);
    if (!saved) {
      if (!video) return;
      if (!url && result && track) {
        // An analysis without its video: that video is added in place, with no new analysis.
        const text = serializeSeries(fileName, videoId && clipVideoId(videoId), calibration);
        if (matchClip(clipOfSeries(parsePoseSeries(text)), await clipOfVideo(video)) !== 'different') {
          await onFile(video, text);
          return;
        }
      }
      await onFile(video);
      return;
    }
    let text: string;
    let parsed: ParsedSeries;
    try {
      text = await saved.text();
      parsed = parsePoseSeries(text);
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    const target = video ?? (url ? file : null);
    if (!target) {
      openSeriesText(text, saved.name);
      return;
    }
    const match = matchClip(clipOfSeries(parsed), await clipOfVideo(target));
    if (match === 'different') {
      setNotice(t('app.seriesOtherVideo', { name: saved.name }));
      return;
    }
    if (video) await onFile(video, text);
    else if (openSeriesText(text, saved.name, { withVideo: true }) && match === 'unknown') {
      setNotice(t('app.openedWithVideo', { name: saved.name, frames: parsed.track.frames.length }));
    }
  }

  // Drop a video or a saved analysis anywhere on the page. The handlers read the latest onFile/analyzing through a ref.
  const dropRef = useRef({ onDropped, analyzing });
  dropRef.current = { onDropped, analyzing };
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
      if (!dropRef.current.analyzing) void dropRef.current.onDropped(e.dataTransfer?.files);
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
  const clipBase = fileName.replace(/\.[^.]+$/, '') || 'trampovision';
  const base = athleteCount > 1 ? `${clipBase}-athlete${athleteIdx + 1}` : clipBase;

  useEffect(() => {
    document.title = url || result ? `${base} – TrampoVision` : 'TrampoVision';
  }, [url, result, base]);

  const calStatus = (() => {
    if (editingCal) {
      return corners.length < 4 ? t('calibration.status.click', { n: corners.length + 1 }) : t('calibration.adjust');
    }
    if (!calibrationModel) return t('calibration.status.optional');
    if (!calibrationModel.ok) return calibrationErrorText(calibrationModel.error);
    const m = calibrationModel.model;
    return t('calibration.status.scale', {
      scale: formatNumber(1 / m.metersPerPixel, 0),
      angle: formatNumber(m.viewAngleDeg, 0),
    });
  })();

  // Labels on the video say more to a coach than to an athlete.
  const overlayOpts = useMemo<OverlayOptions>(
    () => ({ ...overlay, detail: advanced && audience === 'coach' ? 'full' : 'simple' }),
    [overlay, audience, advanced],
  );

  // Side by side, every athlete is one color on the video, the same as in the panel.
  const stageOverlay = useMemo<OverlayOptions>(
    () =>
      comparing ? { ...overlayOpts, hud: false, tint: ATHLETE_TINTS[athleteIdx % ATHLETE_TINTS.length] } : overlayOpts,
    [overlayOpts, comparing, athleteIdx],
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
        title: t('export.video'),
        items: [
          {
            id: 'annotated',
            label: t('export.annotated'),
            hint: t('export.annotatedHint'),
            icon: 'film',
            disabled: !url || !annotated.available || annotated.exporting,
            onSelect: () => void annotated.start(),
          },
        ],
      },
      {
        id: 'data',
        title: t('export.data'),
        items: [
          {
            id: 'frames',
            label: t('export.frames'),
            hint: t('export.framesHint'),
            icon: 'download',
            onSelect: () => download(`${base}-frames.csv`, toCsv(result), 'text/csv'),
          },
          {
            id: 'jumps',
            label: t('export.jumps'),
            hint: t('export.jumpsHint'),
            icon: 'download',
            onSelect: () => download(`${base}-jumps.csv`, toJumpsCsv(result), 'text/csv'),
          },
          {
            id: 'series',
            label: t('export.series'),
            hint: t('export.seriesHint'),
            icon: 'download',
            disabled: !track,
            onSelect: () =>
              track &&
              download(
                `${clipBase}-pose-series.json`,
                serializeSeries(fileName, videoId && clipVideoId(videoId), calibration),
                'application/json',
              ),
          },
        ],
      },
      {
        id: 'skills',
        title: t('export.skills'),
        items: [
          {
            id: 'skills-json',
            label: t('export.skillsJson'),
            hint: t('export.skillsJsonHint'),
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
            label: t('export.skillsCsv'),
            hint: t('export.skillsCsvHint'),
            icon: 'download',
            disabled: !skills,
            onSelect: () => skills && download(`${base}-skills.csv`, toSkillsCsv(skills), 'text/csv'),
          },
          {
            id: 'sequences-csv',
            label: t('export.sequencesCsv'),
            hint: t('export.sequencesCsvHint'),
            icon: 'download',
            disabled: !skills,
            onSelect: () => skills && download(`${base}-sequences.csv`, toSequencesCsv(skills), 'text/csv'),
          },
        ],
      },
    ];
  }, [result, skills, track, url, base, fileName, videoId, stride, calibration, annotated, locale]); // oxlint-disable-line react-hooks/exhaustive-deps

  const hasClip = !!url || !!result;
  // Both audiences of the advanced tools can pick the view. Without a clip only the 3D skeleton has anything to show. The live view is the video.
  const view: StageView = !advanced ? 'video' : !url && twist ? '3d' : stageView;
  const clipDetail = result
    ? t('app.clipDetail', {
        jumps: tp('count.jumps', jumpCount),
        seconds: fmt(result.time[result.time.length - 1] ?? 0, 1),
      })
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

  const settings = (
    <SettingsDialog
      open={settingsOpen}
      onClose={closeSetup}
      clipDetail={clipDetail}
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
      engine={engine}
      onEngine={setEngine}
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
        setTracks([]);
      }}
      backend={backend}
      webgpu={webgpu}
      onAnalyze={() => {
        closeSetup();
        void analyze();
      }}
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
      onEditCalibration={(editing) => {
        // The corners are placed on the video: the popup steps aside, and the bar on the video finishes the job.
        if (editing) closeSetup();
        setEditingCal(editing);
      }}
      onUndoCorner={() => setCorners(corners.slice(0, -1))}
      onClearCalibration={() => {
        setCorners([]);
        closeSetup();
        setEditingCal(true);
      }}
      onBedLong={(m) => setBedLong(m || DEFAULT_BED_M.long)}
      onBedShort={(m) => setBedShort(m || DEFAULT_BED_M.short)}
      onFirstSide={setFirstSide}
      onScaleSource={setScaleSource}
      samples={samples}
      onSample={(sample) => {
        closeSetup();
        void onSample(sample);
      }}
      onOpenSeries={(f) => {
        closeSetup();
        void openSeries(f);
      }}
      appearance={appearance}
      onAppearance={setAppearance}
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
    <div
      className="app"
      data-audience={audience}
      data-mode={advanced ? 'advanced' : 'live'}
      data-review={reviewing ? 'on' : undefined}
    >
      {dragging && (
        <div className="dropzone" role="presentation">
          <Icon name="upload" size={40} strokeWidth={1.5} />
          <span className="dropzone__title">{analyzing ? t('app.dropBusy') : t('app.dropIdle')}</span>
          <span className="dropzone__text">{analyzing ? t('app.dropWait') : t('app.dropFormats')}</span>
        </div>
      )}

      <TopBar
        clip={hasClip ? { name: fileName, detail: clipDetail } : null}
        audience={audience}
        onAudience={setAudience}
        showAudience={!!result && advanced}
        exportGroups={advanced ? exportGroups : null}
        setupOpen={settingsOpen}
        onOpenSetup={openSetup}
        aboutOpen={aboutOpen}
        onAbout={() => setAboutOpen(!aboutOpen)}
        review={result && skills && !comparing ? { open: reviewing, onToggle: () => setReviewOpen(!reviewOpen) } : null}
        onFile={hasClip && !analyzing ? (f) => void onFile(f) : null}
        onHome={aboutOpen ? () => setAboutOpen(false) : hasClip && !analyzing ? () => void goHome() : null}
      />

      {settings}

      <StatusBanners
        status={status}
        notice={notice}
        exportError={annotated.error}
        onDismissStatus={() => setStatus({ kind: 'idle' })}
        onDismissNotice={() => setNotice('')}
        onDismissExportError={annotated.clearError}
      />

      {aboutOpen && (
        <main className="app__main">
          <About onClose={() => setAboutOpen(false)} />
        </main>
      )}

      {/* Kept mounted while the About page is open, so a clip and its analysis are still there on return. */}
      <main className="app__main" hidden={aboutOpen}>
        {hasClip && (
          <h1 className="sr-only">
            {result ? t('app.analysisOf', { name: fileName }) : t('app.setUp', { name: fileName })}
          </h1>
        )}
        {!hasClip ? (
          <>
            {loading && (
              <div className="busy--page">
                <ProcessingOverlay
                  status={status}
                  ready={false}
                  fileName=""
                  backend=""
                  advanced={advanced}
                  onAnalyze={() => undefined}
                  onCancel={() => undefined}
                />
              </div>
            )}
            <Landing
              onFile={(f) => void onFile(f)}
              samples={samples}
              onSample={(sample) => void onSample(sample)}
              onOpenSeries={(f) => void openSeries(f)}
              dataset={dataset}
              recent={{
                sets: history.sets,
                onOpen: (id) => void openRecent(id),
                onRemove: (id) => void history.remove(id),
                onClear: () => void history.clear(),
              }}
              busy={loading}
              advanced={advanced}
            />
          </>
        ) : (
          <>
            <div className="workspace" data-orientation={clipOrientation(clipSize)}>
              <div className="workspace__stage">
                <Stage
                  url={url}
                  fps={fps}
                  result={result}
                  skills={shownSkills}
                  overlay={stageOverlay}
                  others={others}
                  playhead={playhead}
                  speed={speed}
                  calibration={calDraw}
                  onCornersChange={setCorners}
                  onError={(message) => setStatus({ kind: 'error', message })}
                  onPickVideo={(f) => void onFile(f)}
                  view={view}
                  onView={advanced && result && twist ? switchStageView : undefined}
                  onClipSize={setClipSize}
                  pane={pane}
                  fullscreen={{ jumps: fullscreenJumps, selected: jumpSel, onJump: stepJump, onSpeed: setSpeed }}
                  athletes={
                    athleteCount > 1
                      ? {
                          count: athleteCount,
                          value: athleteIdx,
                          onChange: (i) => {
                            setCompare(false);
                            setAthleteIdx(i);
                          },
                          compare: comparing,
                          onCompare: () => setCompare(true),
                        }
                      : undefined
                  }
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
                    advanced={advanced}
                    onAnalyze={() => void analyze()}
                    onCancel={() => abort.current?.abort()}
                  />
                </Stage>
              </div>

              <div className="workspace__dock sheet">
                {(url || result) && (
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
                    onStart={goToStart}
                    startsAtRoutine={routineStartS !== null}
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
                    boomerang={boomerang}
                    onBoomerang={setBoomerang}
                    routine={{
                      jump: routineJump,
                      startS: routineStartS,
                      detected: detectedStart,
                      onMark: setRoutineMark,
                    }}
                  />
                )}
              </div>

              <aside className="workspace__rail sheet" aria-label={result ? t('app.analysis') : t('setup.readyTitle')}>
                {comparing && athleteViews.length > 1 ? (
                  <AthleteCompare athletes={athleteViews} playhead={playhead} />
                ) : !result || !skills ? (
                  <ReadyCard
                    fileName={file?.name ?? seriesName}
                    busy={analyzing ? 'analyzing' : loading ? 'loading' : 'idle'}
                    onOpenSetup={openSetup}
                  />
                ) : reviewing ? (
                  <ReviewMode
                    skills={skills}
                    records={fresh}
                    selected={jumpSel}
                    onSelect={chooseJump}
                    playhead={playhead}
                    speed={speed}
                    onSpeed={setSpeed}
                    videoId={videoId}
                    fileName={fileName}
                    baseName={base}
                    onSave={(records) => void saveRecords(records)}
                    onClose={() => setReviewOpen(false)}
                    storageWarning={dataset.warning}
                  />
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
                    routineStart={routineJump}
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
        <ActivityToast label={t('app.exporting')} progress={annotated.progress ?? 0} onCancel={annotated.cancel} />
      )}
    </div>
  );
}

/** The app, with the player bus offered to every button that plays part of the clip. */
export default function App() {
  const playhead = useMemo(() => new Playhead(), []);
  return (
    <PlayheadContext.Provider value={playhead}>
      <AppView playhead={playhead} />
    </PlayheadContext.Provider>
  );
}
