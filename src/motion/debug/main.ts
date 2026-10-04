import '@fontsource-variable/archivo/wdth.css';
import '../../localOnlyGuard';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/kit.css';
import './debug.css';
import { analysisStride } from '../../analysis/stride';
import { AthleteView, type Prepared } from '../athleteView';
import { createMediaPipeEstimator } from '../../pose/MediaPipePoseEstimator';
import { LM } from '../../pose/landmarks';
import type { PoseDetection, PoseEstimator } from '../../pose/types';
import { disposeVideo, estimateFps, frameSeekTime, loadVideo, seekTo } from '../../video/frames';
import { loadSample, loadSamples, type Sample } from '../../video/sample';
import { DEFAULT_MOTION_CONFIG, type CameraSetting, type CameraType, type MotionConfig } from '../config';
import { focusOnAthletes } from '../focus';
import { APP_WITH_RESULT, putHandoff } from '../handoff';
import { CanvasMaskLayer } from '../layer';
import { hidesSomething } from '../maskedEstimator';
import { maskedName, renderMaskedVideo } from '../resultVideo';
import type { MotionResult } from '../types';
import { Panels } from './panels';

/**
 * The debug page of the motion detector (motion.html): a video goes through the detector and the pose model frame by frame, and the stages
 * are shown side by side. It reads the video like the analysis does (seeking to every frame, on a hidden video element), so what is seen
 * does not depend on the speed of the machine. The video is one the person chooses, or one of the app's samples; and the result, the video
 * with the background hidden, can be sent to the app (`handoff.ts`). English only: it is a tool for the people who work on the detector.
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pickLabel = $('pick');
const fileInput = $<HTMLInputElement>('file');
const sampleSelect = $<HTMLSelectElement>('sample');
const playButton = $<HTMLButtonElement>('play');
const stepButton = $<HTMLButtonElement>('step');
const restartButton = $<HTMLButtonElement>('restart');
const poseBox = $<HTMLInputElement>('pose');
const gpuBox = $<HTMLInputElement>('gpu');
const hideBox = $<HTMLInputElement>('hide');
const zoomBox = $<HTMLInputElement>('zoom');
const turnBox = $<HTMLInputElement>('turn');
const seek = $<HTMLInputElement>('seek');
const clock = $<HTMLOutputElement>('clock');
const status = $('status');
const stats = $('stats');
const loadButton = $<HTMLButtonElement>('load');
const loadCancel = $<HTMLButtonElement>('load-cancel');
const loadProgress = $<HTMLProgressElement>('load-progress');
const loadStatus = $('load-status');

const panels = new Panels({
  original: $<HTMLCanvasElement>('c-original'),
  motion: $<HTMLCanvasElement>('c-motion'),
  mask: $<HTMLCanvasElement>('c-mask'),
  masked: $<HTMLCanvasElement>('c-masked'),
  given: $<HTMLCanvasElement>('c-given'),
  skeleton: $<HTMLCanvasElement>('c-skeleton'),
});
const layer = new CanvasMaskLayer();
/** What is done to the picture before the pose model, once the athlete is found; null when neither box is ticked. Made again when a box changes. */
let viewer: AthleteView | null = null;
function updateViewer(): void {
  viewer =
    zoomBox.checked || turnBox.checked ? new AthleteView({ zoom: zoomBox.checked, rotate: turnBox.checked }) : null;
}

interface Session {
  url: string;
  /** The clip as it was chosen: the app is given it too, to show it. */
  file: File;
  video: HTMLVideoElement;
  fps: number;
  /** Every how many frames of the video are analyzed, so that the analysis runs at about 30 a second as the app does. */
  stride: number;
  total: number;
  /** The frame (of the analyzed ones) shown next. */
  index: number;
  /** Set when another video is opened: what is still going on for this one is dropped. */
  closed: boolean;
}

let session: Session | null = null;
let estimator: PoseEstimator | null = null;
/** MediaPipe wants a time that always increases, even when the video is played again from the start. */
let poseTime = 0;
let playing = false;
let busy = false;
/** What was asked while a frame was being processed. It is done next, so that no click is lost. */
let pending: 'step' | 'show' | null = null;
/** Set while the masked video is being made for the app; aborting it stops the work. */
let rendering: AbortController | null = null;
/** Bumped by every attempt to open a video. One that is overtaken (another video was chosen while it was loading) lets go of what it made. */
let opening = 0;

function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  status.textContent = text;
  status.dataset.kind = kind;
}

function setLoadStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  loadStatus.textContent = text;
  loadStatus.dataset.kind = kind;
}

// --- Measurements ------------------------------------------------------------------------------------------------

const STAT_LABELS = [
  ['frame', 'Frame'],
  ['athlete', 'Athlete region'],
  ['period', 'Jump period'],
  ['fit', 'Rhythm fit'],
  ['kept', 'Picture kept'],
  ['shot', 'Kind of shot'],
  ['readings', 'What the shot is read from'],
  ['camera', 'Camera move'],
  ['shake', 'Camera shake'],
  ['noise', 'Noise level'],
  ['view', 'Given to the pose model'],
  ['people', 'People found'],
  ['detector', 'Detector'],
  ['pose', 'Pose model'],
] as const;
type StatKey = (typeof STAT_LABELS)[number][0];

for (const [key, label] of STAT_LABELS) {
  const box = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.id = `stat-${key}`;
  dd.textContent = '–';
  box.append(dt, dd);
  stats.append(box);
}
const stat = (key: StatKey, text: string) => ($(`stat-${key}`).textContent = text);
const ms = (value: number) => `${value.toFixed(1)} ms`;

const SHOT_NAMES: Record<CameraType, string> = {
  fixed: 'Fixed wide-angle',
  tracking: 'Close-up that follows',
  lowAngle: 'Low-angle',
};

/** How the picture moved since the last frame, picture pixels, or why it could not be told. */
function cameraMove(result: MotionResult): string {
  const { camera } = result;
  return camera.known ? `${camera.dx.toFixed(1)}, ${camera.dy.toFixed(1)} px` : 'Not known';
}

/** The two readings the kind of shot is made from, against the level at which each one counts: how fast the camera goes, and how big the athlete is. */
function shotReadings(result: MotionResult): string {
  const { speed, athleteShare } = result.camera;
  const D = DEFAULT_MOTION_CONFIG;
  const fast = `camera ${(speed * 100).toFixed(1)} % of the picture a second (a move from ${(D.cameraMovingSpeed * 100).toFixed(1)} %)`;
  const big =
    athleteShare > 0
      ? `athlete ${Math.round(athleteShare * 100)} % wide (low-angle from ${Math.round(D.lowAngleShare * 100)} %)`
      : 'no athlete yet';
  return `${fast}; ${big}`;
}

/** What was done to the picture before the pose model: how it was cut and turned, or that nothing was. */
function viewText(prepared: Prepared | null, frame: { width: number; height: number }): string {
  if (!viewer) return 'The frame as it is';
  if (!prepared?.view) return 'The frame as it is (no athlete yet, or nothing to do)';
  const { view } = prepared;
  // The square of the frame that was cut, against the frame's shorter side: 2 is a square half as high as the frame.
  const side = view.width / view.scale;
  const zoom = view.scale !== 1 ? `zoomed ×${(Math.min(frame.width, frame.height) / side).toFixed(1)}` : 'whole frame';
  const turn =
    view.angle !== 0 ? `, turned ${Math.round(-view.angle)}° (the athlete leans ${Math.round(view.angle)}°)` : '';
  return `${zoom}${turn}`;
}

function showStats(
  s: Session,
  result: MotionResult | null,
  people: PoseDetection[] | null,
  athlete: PoseDetection[] | null,
  prepared: Prepared | null,
  timing: [number, number],
): void {
  stat('frame', `${s.index + 1} of ${s.total}`);
  stat('athlete', result ? (result.found ? `Found (${result.athletes.length})` : 'Not yet') : '–');
  stat('period', result?.periodS ? `${result.periodS.toFixed(2)} s` : '–');
  stat('fit', result?.rhythmFit ? `${Math.round(result.rhythmFit * 100)} %` : '–');
  stat('kept', result ? `${Math.round(result.coverage * 100)} %` : '–');
  stat('shot', result ? SHOT_NAMES[result.camera.type] : '–');
  stat('readings', result ? shotReadings(result) : '–');
  stat('camera', result ? cameraMove(result) : '–');
  stat('shake', result ? `${result.shift.toFixed(2)} px` : '–');
  stat('noise', result ? `${(result.noise * 100).toFixed(2)} %` : '–');
  stat('view', viewText(prepared, { width: s.video.videoWidth, height: s.video.videoHeight }));
  stat(
    'people',
    people
      ? athlete && athlete.length < people.length
        ? `${people.length} (${athlete.length} jumps)`
        : String(people.length)
      : '–',
  );
  stat('detector', ms(timing[0]));
  stat('pose', people ? ms(timing[1]) : '–');
}

// --- The settings ------------------------------------------------------------------------------------------------

/** A slider that changes a threshold of the detector while it runs. */
function bindSlider(
  id: string,
  initial: number,
  show: (value: number) => string,
  apply: (value: number) => Partial<MotionConfig>,
): void {
  const input = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(`${id}-out`);
  input.value = String(initial);
  out.textContent = show(initial);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    out.textContent = show(value);
    layer.detector.configure(apply(value));
    if (session && !playing) void run('show');
  });
}
const D = DEFAULT_MOTION_CONFIG;
bindSlider(
  'margin',
  D.marginShare,
  (v) => `${Math.round(v * 100)} %`,
  (v) => ({ marginShare: v }),
);
bindSlider(
  'hold',
  D.holdS,
  (v) => `${v.toFixed(1)} s`,
  (v) => ({ holdS: v }),
);
// The threshold has a low end (a little) and a high end (fully): both move, keeping their ratio.
bindSlider(
  'threshold',
  D.minSignificance,
  (v) => v.toFixed(1),
  (v) => ({ minSignificance: v, fullSignificance: (v * D.fullSignificance) / D.minSignificance }),
);
bindSlider(
  'close',
  D.fadeInS,
  (v) => `${v.toFixed(1)} s`,
  (v) => ({ fadeInS: v }),
);
$<HTMLSelectElement>('camera').addEventListener('change', (event) => {
  layer.detector.configure({ cameraType: (event.target as HTMLSelectElement).value as CameraSetting });
  if (session && !playing) void run('show');
});
$<HTMLSelectElement>('athletes').addEventListener('change', (event) => {
  layer.detector.configure({ maxAthletes: Number((event.target as HTMLSelectElement).value) });
  if (session && !playing) void run('show');
});
$<HTMLSelectElement>('fill').addEventListener('change', (event) => {
  layer.fill = (event.target as HTMLSelectElement).value;
  if (session && !playing) void run('show');
});

// --- The video ---------------------------------------------------------------------------------------------------

function closeSession(): void {
  playing = false;
  pending = null;
  if (!session) return;
  session.closed = true;
  disposeVideo(session.video);
  URL.revokeObjectURL(session.url);
  session = null;
}

function updateControls(): void {
  const ready = session !== null;
  // While the masked video is made, the clip and the settings stay as they are: the video is being read, with these settings.
  const working = rendering !== null;
  playButton.disabled = !ready || working;
  stepButton.disabled = !ready || working || playing || (session !== null && session.index >= session.total);
  restartButton.disabled = !ready || working;
  seek.disabled = !ready || working;
  playButton.textContent = playing ? 'Pause' : session && session.index >= session.total ? 'Play again' : 'Play';
  fileInput.disabled = working;
  sampleSelect.disabled = working;
  pickLabel.classList.toggle('is-busy', working);
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    '.md-settings input, .md-settings select',
  ))
    control.disabled = working;
  loadButton.disabled = !ready || working;
  loadCancel.hidden = !working;
  loadProgress.hidden = !working;
}

async function openVideo(file: File): Promise<void> {
  const mine = ++opening;
  closeSession();
  updateControls();
  const url = URL.createObjectURL(file);
  try {
    setStatus('Opening the video…');
    const video = await loadVideo(url);
    const fps = (await estimateFps(video)) ?? 30;
    if (mine !== opening) {
      // Another video was chosen while this one was opening: that one is the one that counts.
      disposeVideo(video);
      URL.revokeObjectURL(url);
      return;
    }
    const stride = analysisStride(fps);
    const total = Math.max(1, Math.floor((video.duration * fps) / stride));
    session = { url, file, video, fps, stride, total, index: 0, closed: false };
    panels.resize(video.videoWidth, video.videoHeight);
    layer.detector.reset();
    seek.max = String(total - 1);
    seek.value = '0';
    setLoadStatus('');
    setStatus(
      `${file.name}: ${video.videoWidth} × ${video.videoHeight}, ${fps} frames a second, every ${stride === 1 ? 'frame' : `${stride}th frame`} is analyzed. Press Play.`,
    );
    updateControls();
    await run('show');
  } catch (error) {
    URL.revokeObjectURL(url);
    if (mine === opening) setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

/** Downloads one of the app's samples and opens it like a video that was chosen. */
async function openSample(sample: Sample): Promise<void> {
  const mine = ++opening;
  closeSession();
  updateControls();
  try {
    setStatus(`Downloading ${sample.label}…`);
    const file = await loadSample(sample.path, (done) => {
      if (mine === opening) setStatus(`Downloading ${sample.label}… ${Math.round(done * 100)} %`);
    });
    if (mine === opening) await openVideo(file);
  } catch (error) {
    if (mine === opening) setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

// The samples of the app. None without an asset host (nor an index of its samples): the picker stays hidden, as the app's sample menu does.
void loadSamples().then((samples) => {
  if (samples.length === 0) return;
  for (const sample of samples) sampleSelect.append(new Option(sample.label, sample.id));
  sampleSelect.hidden = false;
  sampleSelect.addEventListener('change', () => {
    const sample = samples.find((s) => s.id === sampleSelect.value);
    // Back to the first line: choosing the same sample again (after another video) is a change too.
    sampleSelect.value = '';
    if (sample) void openSample(sample);
  });
});

/** The pose model's turn: it gets `given`, and its people are returned (null when the pose model is off or did not load). */
async function detectPose(s: Session, given: CanvasImageSource): Promise<PoseDetection[] | null> {
  if (!poseBox.checked) return null;
  if (!estimator) {
    setStatus('Loading the pose model…');
    try {
      estimator = await createMediaPipeEstimator({ model: 'full', numPoses: 4, preferGpu: gpuBox.checked });
    } catch (error) {
      poseBox.checked = false;
      setStatus(
        `The pose model did not load (${error instanceof Error ? error.message : String(error)}). Run "npm run fetch-assets".`,
        'error',
      );
      return null;
    }
  }
  poseTime += Math.max(1, Math.round((1000 * s.stride) / s.fps));
  // MediaPipe reads a canvas as well as a video; the types of the pose code say video, and that code is not changed (see withMotionMask).
  return await estimator.detect(given as unknown as HTMLVideoElement, poseTime);
}

/**
 * Tells whoever listens (a test that drives the page) what a frame came to: `motion-frame` on the document, with the index of the frame,
 * whether the athlete was found, the share of the picture that was kept and where the pose model found people (the middle of their hips,
 * 0 to 1 of the picture; null when the pose model did not run).
 */
function announce(s: Session, result: MotionResult | null, people: PoseDetection[] | null): void {
  const centers =
    people?.map((p) => ({
      x: (p.landmarks[LM.L_HIP].x + p.landmarks[LM.R_HIP].x) / 2,
      y: (p.landmarks[LM.L_HIP].y + p.landmarks[LM.R_HIP].y) / 2,
    })) ?? null;
  document.dispatchEvent(
    new CustomEvent('motion-frame', {
      detail: { index: s.index, found: result?.found ?? false, kept: result?.coverage ?? 1, people: centers },
    }),
  );
}

/** Runs the frame at `s.index` through the detector and the pose model, and draws it. */
async function processFrame(s: Session): Promise<void> {
  const frame = s.index * s.stride;
  await seekTo(s.video, Math.min(frameSeekTime(frame, s.fps), s.video.duration - 1e-3));
  if (s.closed) return;

  const t0 = performance.now();
  const result = layer.process(s.video, Math.round((frame / s.fps) * 1000));
  const masked = layer.render(s.video);
  const t1 = performance.now();
  // What the pose model is given: the frame with the background painted over (once the detector hides something), or the video.
  const given = hideBox.checked && hidesSomething(result) ? masked : s.video;
  // Once the athlete is found the picture can be cut around them and turned upright (the boxes under the video), and what the pose model finds is put back in the frame.
  const size = { width: s.video.videoWidth, height: s.video.videoHeight };
  const prepared = viewer && result ? viewer.prepare(given, size, result.athletes[0] ?? null, result) : null;
  const found = await detectPose(s, prepared?.source ?? given);
  if (s.closed) return;
  const t2 = performance.now();
  const people =
    found && viewer && prepared && result ? viewer.finish(found, prepared, size, result.athletes, result) : found;
  // Of the people the pose model found, the one who jumps: the others are people who stand near the bed.
  const athlete = people && result ? focusOnAthletes(people, result.athletes, result) : people;

  panels.draw({
    video: s.video,
    result,
    masked,
    given,
    people,
    athlete,
    view: prepared?.view ? prepared.source : null,
  });
  showStats(s, result, people, athlete, prepared, [t1 - t0, t2 - t1]);
  announce(s, result, people);
  seek.value = String(s.index);
  clock.textContent = `${(frame / s.fps).toFixed(2)} s`;
}

const nextPaint = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 120);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolve();
    });
  });

/**
 * Processes frames until there is nothing left to do: the one that was asked for (a step, or the same frame again after a seek or a new
 * setting), then the next ones while playing. One loop, so that what is asked while a frame is in progress is picked up after it.
 */
async function run(request: 'step' | 'show' | null): Promise<void> {
  // A step moves on; showing the frame again is already what a step does first.
  if (request && pending !== 'step') pending = request;
  if (busy) return;
  busy = true;
  let current: Session | null = null;
  try {
    for (;;) {
      const s = session;
      if (!s) break;
      current = s;
      const mode = pending ?? (playing && s.index < s.total ? 'play' : null);
      if (!mode) break;
      pending = null;
      await processFrame(s);
      if (s.closed) continue;
      if (mode !== 'show') s.index = Math.min(s.index + 1, s.total);
      if (mode === 'play') {
        setStatus('Playing…');
        await nextPaint();
      }
    }
    if (session) {
      const atEnd = session.index >= session.total;
      if (atEnd) playing = false;
      setStatus(atEnd ? 'The end of the video. Play again, or move the position.' : 'Paused.');
    }
  } catch (error) {
    if (!current?.closed) {
      playing = false;
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  } finally {
    busy = false;
    updateControls();
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openVideo(file);
  fileInput.value = '';
});

playButton.addEventListener('click', () => {
  if (!session) return;
  if (playing) {
    playing = false;
    updateControls();
    return;
  }
  if (session.index >= session.total) restart();
  playing = true;
  updateControls();
  void run(null);
});

stepButton.addEventListener('click', () => {
  if (session && !playing) void run('step');
});

function restart(): void {
  if (!session) return;
  session.index = 0;
  layer.detector.reset();
  viewer?.reset();
  updateControls();
}

restartButton.addEventListener('click', () => {
  restart();
  void run('show');
});

// Seeking cuts the video: the detector starts again from that frame (a gap in time resets it by itself).
seek.addEventListener('input', () => {
  if (!session) return;
  session.index = Number(seek.value);
  layer.detector.reset();
  viewer?.reset();
  void run('show');
});

for (const box of [zoomBox, turnBox]) {
  box.addEventListener('change', () => {
    updateViewer();
    if (session && !playing) void run('show');
  });
}

// The pose model is made again, with the other delegate, at the next frame.
gpuBox.addEventListener('change', () => {
  estimator?.dispose();
  estimator = null;
});

// --- The result, in the app --------------------------------------------------------------------------------------

/**
 * Makes the masked video of the whole clip with the settings as they are now, leaves it with the clip itself for the app and goes there. The
 * app shows the clip and gives the masked video (named after the clip) to the pose model: its analysis is unchanged.
 */
async function loadInApp(): Promise<void> {
  const s = session;
  if (!s || rendering) return;
  playing = false;
  pending = null;
  const control = new AbortController();
  rendering = control;
  loadProgress.value = 0;
  setLoadStatus('Making the video…');
  updateControls();
  let shown = -1;
  try {
    const made = await renderMaskedVideo({
      url: s.url,
      sourceFps: s.fps,
      stride: s.stride,
      config: { ...layer.detector.config },
      fill: layer.fill,
      signal: control.signal,
      onScout: (done, total) => {
        const percent = Math.floor((100 * done) / total);
        if (percent === shown) return;
        shown = percent;
        setLoadStatus(`Looking at the start of the clip to find where the athlete jumps: ${percent} %.`);
      },
      onProgress: (done, total, hidden) => {
        loadProgress.value = done / total;
        // The text is a live region: it says something new when the percent moves, not at every frame.
        const percent = Math.floor((100 * done) / total);
        if (percent === shown) return;
        shown = percent;
        setLoadStatus(
          `Making the video: ${percent} %. The background is hidden in ${Math.round((100 * hidden) / Math.max(1, done))} % of the frames so far.`,
        );
      },
    });
    const share = Math.round((100 * made.hidden) / made.frames);
    if (made.hidden === 0) {
      // The mask never closed in: what the app would be given is the clip as it was, under a name that says it is masked.
      const ask =
        'The detector did not find an athlete in this video, so it hid nothing and the video would be the clip as it was. Open it in TrampoVision anyway?';
      if (!window.confirm(ask)) {
        setLoadStatus('Nothing was loaded: the detector hid nothing in this video.');
        return;
      }
    }
    setLoadStatus(`The background is hidden in ${share} % of the frames. Opening TrampoVision…`);
    await putHandoff({
      original: s.file,
      masked: new File([made.blob], maskedName(s.file.name), { type: made.blob.type }),
    });
    location.assign(APP_WITH_RESULT);
  } catch (error) {
    if (control.signal.aborted) setLoadStatus('Cancelled.');
    else setLoadStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    rendering = null;
    updateControls();
  }
}

loadButton.addEventListener('click', () => void loadInApp());
loadCancel.addEventListener('click', () => rendering?.abort());

window.addEventListener('pagehide', () => {
  rendering?.abort();
  closeSession();
  estimator?.dispose();
});

// Back from the app can bring this page back from the browser's cache, after `pagehide` has closed its video: it starts again instead.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
