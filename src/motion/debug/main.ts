import '@fontsource-variable/archivo/wdth.css';
import '../../localOnlyGuard';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/kit.css';
import './debug.css';
import { analysisStride } from '../../analysis/stride';
import { AthleteView, type Prepared } from '../athleteView';
import { LM } from '../../pose/landmarks';
import type { PoseDetection, PoseSource } from '../../pose/types';
import { disposeVideo, estimateFps, frameSeekTime, loadVideo, seekTo } from '../../video/frames';
import { loadSample, loadSamples, type Sample } from '../../video/sample';
import { DEFAULT_MOTION_CONFIG, type CameraSetting, type CameraType, type MotionConfig } from '../config';
import { bodyBox, focusOnAthletes } from '../focus';
import { APP_WITH_RESULT, putHandoff, type PageSettings } from '../handoff';
import { CanvasMaskLayer } from '../layer';
import { FollowWatch, hidesSomething, ZoomGate } from '../maskedEstimator';
import { maskedName, renderMaskedVideo, resultPlan, scoutAthlete, ZOOM_WINS_SHARE } from '../resultVideo';
import type { Box, MotionResult } from '../types';
import { attachGestures } from './gestures';
import {
  addFrame,
  DEFAULT_MODEL,
  describeTally,
  emptyTally,
  ModelSlot,
  POSE_MODELS,
  pointsSeen,
  type PoseModel,
} from './models';
import { Panels } from './panels';

/**
 * The debug page of the motion detector (motion.html): a video goes through the detector and the pose models frame by frame, and the
 * stages are shown side by side, with one panel for each pose model that is ticked so that they can be compared on the same picture. It
 * reads the video like the analysis does (seeking to every frame, on a hidden video element), so what is seen does not depend on the
 * speed of the machine. The video is one the person chooses, or one of the app's samples; and the result, the video with the background
 * hidden, can be sent to the app (`handoff.ts`). English only: it is a tool for the people who work on the detector.
 *
 * A desktop has the playback controls in a bar above the panels. On a touch screen every panel is its own control: a tap plays or
 * pauses, a finger moved sideways moves the position, and up and down still scrolls the page (`gestures.ts`).
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sourceBox = $('source');
const pickLabel = $('pick');
const fileInput = $<HTMLInputElement>('file');
const sampleSelect = $<HTMLSelectElement>('sample');
const loadedBox = $('loaded');
const videoName = $('video-name');
const resetButton = $<HTMLButtonElement>('reset');
const playButton = $<HTMLButtonElement>('play');
const stepButton = $<HTMLButtonElement>('step');
const restartButton = $<HTMLButtonElement>('restart');
const modelList = $('models');
const gpuBox = $<HTMLInputElement>('gpu');
const hideBox = $<HTMLInputElement>('hide');
const keepBodyBox = $<HTMLInputElement>('keep-body');
const zoomBox = $<HTMLInputElement>('zoom');
const turnBox = $<HTMLInputElement>('turn');
const seek = $<HTMLInputElement>('seek');
const clock = $<HTMLOutputElement>('clock');
const status = $('status');
const panelSection = $('panels');
const compareRows = $('compare-rows');
const stats = $('stats');
const loadButton = $<HTMLButtonElement>('load');
const loadCancel = $<HTMLButtonElement>('load-cancel');
const loadProgress = $<HTMLProgressElement>('load-progress');
const loadStatus = $('load-status');

/** A touch screen: the panels are the controls (the CSS reads the same query). */
const touch = window.matchMedia('(pointer: coarse)');

const panels = new Panels({
  original: $<HTMLCanvasElement>('c-original'),
  motion: $<HTMLCanvasElement>('c-motion'),
  mask: $<HTMLCanvasElement>('c-mask'),
  masked: $<HTMLCanvasElement>('c-masked'),
  given: $<HTMLCanvasElement>('c-given'),
});

// Off when the page opens, as in the app (`searchAbove`, see config.ts): a box in the settings turns it on, and the app is sent that choice.
const layer = new CanvasMaskLayer();
/** Whether the camera follows the athlete: the detector then steps aside, as it does in the app (`FollowWatch`). */
const follow = new FollowWatch();
/** The frames in which the zoom helps (a small athlete on a steady shot): the only ones zoomed, as in the app (`ZoomGate`). */
let zoomGate = new ZoomGate();
/** What is done to the picture before the pose models, once the athlete is found; null when neither box is ticked. Made again when a box changes. */
let viewer: AthleteView | null = null;
function updateViewer(): void {
  viewer =
    zoomBox.checked || turnBox.checked ? new AthleteView({ zoom: zoomBox.checked, rotate: turnBox.checked }) : null;
}
updateViewer();

interface Session {
  url: string;
  /** The clip as it was chosen: the app is given it too, to show it. */
  file: File;
  video: HTMLVideoElement;
  fps: number;
  /** Every how many frames of the video are analyzed, so that the analysis runs at about 30 a second as the app does. */
  stride: number;
  total: number;
  /** The frame (of the analyzed ones) shown next: the one after the frame on the panels, or the one a seek asked for. */
  index: number;
  /** The frame on the panels now. */
  shown: number;
  /** Where the athlete jumps, from a look at the start of the clip (null until it is done, or when nobody is found): the mask is drawn from it right after a seek. */
  hint: Box | null;
  /** Bumped at every cut (a seek, a restart): a frame that was being processed when it happened leaves the position and the mask alone. */
  cuts: number;
  /** Set when another video is opened: what is still going on for this one is dropped. */
  closed: boolean;
}

let session: Session | null = null;
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

// --- The controls on the panels ----------------------------------------------------------------------------------

/** What every panel shows on top of its picture on a touch screen: play and pause, the time, and how far into the clip. */
interface Hud {
  play: HTMLButtonElement;
  time: HTMLElement;
  fill: HTMLElement;
}
const huds = new Set<Hud>();

const PLAY_ICONS = `
  <svg class="md-icon md-icon--play" viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4.5 19.5 12 7 19.5" /></svg>
  <svg class="md-icon md-icon--pause" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </svg>`;

/** Puts the controls on a panel: its picture becomes a control (tap, slide), with a play button, the time and a progress line on it. */
function addHud(figure: HTMLElement): Hud {
  const canvas = figure.querySelector('canvas')!;
  const view = document.createElement('div');
  view.className = 'md-panel__view';
  canvas.before(view);
  view.append(canvas);
  const overlay = document.createElement('div');
  overlay.className = 'md-hud';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'md-hud__play';
  play.setAttribute('aria-label', 'Play');
  play.innerHTML = PLAY_ICONS;
  play.addEventListener('click', togglePlay);
  const time = document.createElement('span');
  time.className = 'md-hud__time num';
  time.textContent = '0.00 s';
  const bar = document.createElement('span');
  bar.className = 'md-hud__bar';
  const fill = document.createElement('span');
  fill.className = 'md-hud__fill';
  bar.append(fill);
  overlay.append(play, time, bar);
  view.append(overlay);
  attachGestures(view, {
    scrubs: () => touch.matches,
    position: () => (session && !rendering ? { index: session.shown, total: session.total } : null),
    tap: togglePlay,
    scrubStart: () => {
      playing = false;
      updateControls();
    },
    scrub: (index) => {
      if (session && index !== session.shown) moveTo(index);
    },
    scrubEnd: () => undefined,
  });
  const hud = { play, time, fill };
  huds.add(hud);
  return hud;
}

for (const figure of panelSection.querySelectorAll<HTMLElement>('.md-panel')) addHud(figure);

/** Shows the position on the bar, the clock and every panel: frame `index` of the analyzed ones, at `timeS` seconds. */
function showPosition(index: number, timeS: number): void {
  seek.value = String(index);
  const text = `${timeS.toFixed(2)} s`;
  clock.textContent = text;
  const share = session && session.total > 1 ? index / (session.total - 1) : 0;
  for (const hud of huds) {
    hud.time.textContent = text;
    hud.fill.style.width = `${(share * 100).toFixed(2)}%`;
  }
}

// --- The pose models ---------------------------------------------------------------------------------------------

/** A pose model that is ticked: its runtime, its panel, and its row of the comparison. */
interface ModelView {
  model: PoseModel;
  slot: ModelSlot;
  figure: HTMLElement;
  canvas: HTMLCanvasElement;
  /** What it found in the frame on the panels, under its name. */
  now: HTMLElement;
  hud: Hud;
  row: HTMLTableRowElement;
}
const ticked = new Map<string, ModelView>();

/** The models that are ticked, in the order of the list: the first one's skeleton is kept in the mask. */
const tickedModels = (): ModelView[] => POSE_MODELS.flatMap((m) => ticked.get(m.id) ?? []);

function addModel(model: PoseModel): void {
  const figure = document.createElement('figure');
  figure.className = 'md-panel';
  figure.dataset.panel = model.id;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `The skeletons found by ${model.label}`);
  const caption = document.createElement('figcaption');
  const name = document.createElement('strong');
  name.textContent = `${model.label} skeleton`;
  const now = document.createElement('span');
  now.className = 'md-panel__now';
  now.textContent = 'Not run yet.';
  caption.append(name, now);
  figure.append(canvas, caption);
  const row = document.createElement('tr');
  for (let k = 0; k < 6; k++) row.append(document.createElement(k === 0 ? 'th' : 'td'));
  row.cells[0].setAttribute('scope', 'row');
  for (let k = 2; k < 6; k++) row.cells[k].className = 'num';
  // In the order of the list, after the fixed panels and the models before it.
  const next = tickedModels().find((m) => POSE_MODELS.indexOf(m.model) > POSE_MODELS.indexOf(model));
  panelSection.insertBefore(figure, next?.figure ?? null);
  compareRows.insertBefore(row, next?.row ?? null);
  const hud = addHud(figure);
  ticked.set(model.id, { model, slot: new ModelSlot(model), figure, canvas, now, hud, row });
  if (session) panels.shape(canvas);
  else panels.clear([canvas]);
  updateCompare();
}

function removeModel(id: string): void {
  const view = ticked.get(id);
  if (!view) return;
  view.slot.dispose();
  view.figure.remove();
  view.row.remove();
  huds.delete(view.hud);
  ticked.delete(id);
  updateCompare();
}

/** The comparison table, and the tag of the model whose skeleton the mask keeps. */
function updateCompare(): void {
  tickedModels().forEach((view, k) => {
    const cells = describeTally(view.slot.tally);
    const [name, backend, frames, found, points, ms] = Array.from(view.row.cells);
    name.textContent = view.model.label;
    if (k === 0 && keepBodyBox.checked) {
      const tag = document.createElement('span');
      tag.className = 'md-tag md-tag--small';
      tag.textContent = 'kept in the mask';
      name.append(' ', tag);
    }
    backend.textContent = view.slot.backend;
    frames.textContent = cells.frames;
    found.textContent = cells.found;
    points.textContent = cells.points;
    ms.textContent = cells.ms;
  });
}

function resetTallies(): void {
  for (const view of ticked.values()) view.slot.tally = emptyTally();
  updateCompare();
}

for (const model of POSE_MODELS) {
  const label = document.createElement('label');
  label.className = 'md-chip';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = model.id;
  box.checked = model.id === DEFAULT_MODEL;
  box.addEventListener('change', () => {
    if (box.checked) addModel(model);
    else removeModel(model.id);
    reshow();
  });
  label.append(box, ` ${model.label}`);
  modelList.append(label);
  if (box.checked) addModel(model);
}

/** Loads a model the first time it is needed, and says so: a big model takes a while to download. */
async function loadModel(view: ModelView): Promise<boolean> {
  if (view.slot.ready) return true;
  const { label } = view.model;
  setStatus(`Loading ${label}…`);
  updateCompare();
  const estimator = await view.slot.load(gpuBox.checked, (fraction) =>
    setStatus(fraction === undefined ? `Loading ${label}…` : `Loading ${label}… ${Math.round(fraction * 100)} %`),
  );
  updateCompare();
  if (!estimator && view.slot.error) {
    setStatus(`${label} did not load (${view.slot.error}). Run "npm run fetch-assets".`, 'error');
  }
  return estimator !== null;
}

// The models are made again, with the other delegate, at the next frame.
gpuBox.addEventListener('change', () => {
  for (const view of ticked.values()) {
    view.slot.dispose();
    view.slot = new ModelSlot(view.model);
  }
  updateCompare();
  reshow();
});

keepBodyBox.addEventListener('change', () => {
  updateCompare();
  reshow();
});

// --- Measurements ------------------------------------------------------------------------------------------------

const STAT_LABELS = [
  ['frame', 'Frame'],
  ['athlete', 'Athlete region'],
  ['period', 'Jump period'],
  ['fit', 'Rhythm fit'],
  ['kept', 'Picture kept'],
  ['mask', 'Mask in use'],
  ['shot', 'Kind of shot'],
  ['readings', 'What the shot is read from'],
  ['camera', 'Camera move'],
  ['shake', 'Camera shake'],
  ['noise', 'Noise level'],
  ['view', 'Given to the pose models'],
  ['detector', 'Detector'],
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

/** What was done to the picture before the pose models: how it was cut and turned, or that nothing was. */
function viewText(prepared: Prepared | null, frame: { width: number; height: number }): string {
  if (!viewer) return 'The frame as it is';
  if (!prepared?.view)
    return 'The frame as it is (no athlete yet, nothing to turn, or the athlete is not small on a steady shot)';
  const { view } = prepared;
  // The square of the frame that was cut, against the frame's shorter side: 2 is a square half as high as the frame.
  const side = view.width / view.scale;
  const zoom = view.scale !== 1 ? `zoomed ×${(Math.min(frame.width, frame.height) / side).toFixed(1)}` : 'whole frame';
  const turn =
    view.angle !== 0 ? `, turned ${Math.round(-view.angle)}° (the athlete leans ${Math.round(view.angle)}°)` : '';
  return `${zoom}${turn}`;
}

/** Whether the pose models were given the masked picture, and why not. */
function maskText(result: MotionResult | null, following: boolean): string {
  if (following) return 'No: the camera follows the athlete (the app reads such a clip as it is)';
  if (!hideBox.checked) return 'No: switched off';
  if (!hidesSomething(result)) return 'No: nothing hidden yet';
  return result!.bodies.length ? 'Yes, with the skeleton of the frame before' : 'Yes';
}

function showStats(
  s: Session,
  result: MotionResult | null,
  following: boolean,
  prepared: Prepared | null,
  detectorMs: number,
): void {
  stat('frame', `${s.shown + 1} of ${s.total}`);
  stat('athlete', result ? (result.found ? `Found (${result.athletes.length})` : 'Not yet') : '–');
  stat('period', result?.periodS ? `${result.periodS.toFixed(2)} s` : '–');
  stat('fit', result?.rhythmFit ? `${Math.round(result.rhythmFit * 100)} %` : '–');
  stat('kept', result ? `${Math.round(result.coverage * 100)} %` : '–');
  stat('mask', maskText(result, following));
  stat('shot', result ? SHOT_NAMES[result.camera.type] : '–');
  stat('readings', result ? shotReadings(result) : '–');
  stat('camera', result ? cameraMove(result) : '–');
  stat('shake', result ? `${result.shift.toFixed(2)} px` : '–');
  stat('noise', result ? `${(result.noise * 100).toFixed(2)} %` : '–');
  stat('view', viewText(prepared, { width: s.video.videoWidth, height: s.video.videoHeight }));
  stat('detector', ms(detectorMs));
}

function clearStats(): void {
  for (const [key] of STAT_LABELS) stat(key, '–');
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
    reshow();
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
  reshow();
});
$<HTMLSelectElement>('athletes').addEventListener('change', (event) => {
  layer.detector.configure({ maxAthletes: Number((event.target as HTMLSelectElement).value) });
  reshow();
});
$<HTMLInputElement>('above').addEventListener('change', (event) => {
  layer.detector.configure({ searchAbove: (event.target as HTMLInputElement).checked });
  reshow();
});
$<HTMLSelectElement>('fill').addEventListener('change', (event) => {
  layer.fill = (event.target as HTMLSelectElement).value;
  reshow();
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
  // Where the video comes from while there is none; its name, and the way back, once there is one.
  sourceBox.hidden = ready;
  loadedBox.hidden = !ready;
  videoName.textContent = session?.file.name ?? '';
  resetButton.disabled = working;
  playButton.disabled = !ready || working;
  stepButton.disabled = !ready || working || playing || (session !== null && session.index >= session.total);
  restartButton.disabled = !ready || working;
  seek.disabled = !ready || working;
  const atEnd = session !== null && session.index >= session.total;
  const label = playing ? 'Pause' : atEnd ? 'Play again' : 'Play';
  playButton.setAttribute('aria-label', label);
  playButton.title = label;
  document.body.classList.toggle('is-playing', playing);
  document.body.classList.toggle('has-video', ready);
  for (const hud of huds) {
    hud.play.setAttribute('aria-label', label);
    hud.play.disabled = !ready || working;
  }
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

/** Back to no video: the panels are cleared and the ways to open one come back. */
function resetVideo(): void {
  if (rendering) return;
  ++opening;
  closeSession();
  layer.detector.reset();
  layer.detector.hint(null);
  follow.reset();
  viewer?.reset();
  zoomGate = new ZoomGate();
  panels.clear(tickedModels().map((m) => m.canvas));
  for (const view of ticked.values()) view.now.textContent = 'Not run yet.';
  seek.max = '0';
  showPosition(0, 0);
  clearStats();
  resetTallies();
  setLoadStatus('');
  setStatus('Choose a video to start.');
  updateControls();
}

resetButton.addEventListener('click', resetVideo);

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
    session = { url, file, video, fps, stride, total, index: 0, shown: 0, hint: null, cuts: 0, closed: false };
    panels.resize(
      video.videoWidth,
      video.videoHeight,
      tickedModels().map((m) => m.canvas),
    );
    layer.detector.reset();
    layer.detector.hint(null);
    follow.reset();
    viewer?.reset();
    zoomGate = new ZoomGate();
    resetTallies();
    seek.max = String(total - 1);
    showPosition(0, 0);
    setLoadStatus('');
    setStatus(
      `${file.name}: ${video.videoWidth} × ${video.videoHeight}, ${fps} frames a second, every ${stride === 1 ? 'frame' : `${stride}th frame`} is analyzed. ${touch.matches ? 'Tap a video to play it, slide sideways on it to move.' : 'Press Play.'}`,
    );
    updateControls();
    void scoutSession(session);
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

/**
 * Tells whoever listens (a test that drives the page) what a frame came to: `motion-frame` on the document, with the index of the frame,
 * whether the athlete was found, the share of the picture that was kept, where the first pose model found people (the middle of their
 * hips, 0 to 1 of the picture; null when no model ran) and what every model found.
 */
function announce(
  s: Session,
  result: MotionResult | null,
  people: PoseDetection[] | null,
  models: { id: string; people: number; athlete: boolean; ms: number }[],
): void {
  const centers =
    people?.map((p) => ({
      x: (p.landmarks[LM.L_HIP].x + p.landmarks[LM.R_HIP].x) / 2,
      y: (p.landmarks[LM.L_HIP].y + p.landmarks[LM.R_HIP].y) / 2,
    })) ?? null;
  document.dispatchEvent(
    new CustomEvent('motion-frame', {
      detail: { index: s.shown, found: result?.found ?? false, kept: result?.coverage ?? 1, people: centers, models },
    }),
  );
}

/**
 * Shows the effect of a setting that changed, on the next frame (when playing, the next frames have it anyway). Not the same frame again:
 * the detector reads the frames in order, and the same frame twice is a cut to it, which forgets the athlete.
 */
function reshow(): void {
  if (!session || playing) return;
  void run('show');
}

/** Runs the frame at `s.index` through the detector and every pose model that is ticked, and draws it. */
async function processFrame(s: Session): Promise<void> {
  const index = s.index;
  const cut = s.cuts;
  const frame = index * s.stride;
  await seekTo(s.video, Math.min(frameSeekTime(frame, s.fps), s.video.duration - 1e-3));
  if (s.closed) return;
  s.shown = index;

  const t0 = performance.now();
  const timeMs = Math.round((frame / s.fps) * 1000);
  const result = layer.process(s.video, timeMs);
  // On a camera that follows the athlete the detector steps aside, as in the app: its box sits off the athlete there.
  const following = follow.push(result, timeMs);
  const masked = layer.render(s.video);
  const detectorMs = performance.now() - t0;
  // What the pose models are given: the frame with the background painted over (once the detector hides something), or the video.
  const given: PoseSource = hideBox.checked && hidesSomething(result) && !following ? masked : s.video;
  // Once the athlete is found the picture can be cut around them and turned upright (the boxes above), and what the models find is put back in the frame.
  const size = { width: s.video.videoWidth, height: s.video.videoHeight };
  const prepared =
    viewer && result && !following
      ? viewer.prepare(given, size, result.athletes[0] ?? null, result, zoomGate.helps(result, timeMs))
      : null;
  const source = (prepared?.source ?? given) as PoseSource;
  panels.draw({ video: s.video, result, masked, given, view: prepared?.view ? prepared.source : null });

  // The models one after the other, on the same picture, so that each one's time is its own.
  const views = tickedModels();
  let firstPeople: PoseDetection[] | null = null;
  let firstAthletes: PoseDetection[] | null = null;
  const found: { id: string; people: number; athlete: boolean; ms: number }[] = [];
  // A model unticked, or made again (the GPU box), while the frame was processed is left alone.
  const current = (view: ModelView, slot: ModelSlot) => ticked.get(view.model.id) === view && view.slot === slot;
  for (const [k, view] of views.entries()) {
    const slot = view.slot;
    const loaded = await loadModel(view);
    if (s.closed) return;
    if (!current(view, slot)) continue;
    if (!loaded) {
      panels.drawSkeletons(view.canvas, given, null, null, view.slot.error ? 'The model did not load' : 'Loading…');
      view.now.textContent = view.slot.error ? 'Did not load.' : 'Loading…';
      continue;
    }
    const answer = await slot.detect(source, (1000 * s.stride) / s.fps);
    if (s.closed) return;
    if (!answer || !current(view, slot)) continue;
    const people = viewer && prepared ? viewer.toFrame(answer.people, prepared, size) : answer.people;
    // The person who jumps is the one in the box of what moves; on a camera that follows, everybody (the app's tracker chooses there).
    const athletes = result && !following ? focusOnAthletes(people, result.athletes, result) : people;
    const judged = Boolean(result?.athletes.length) || following;
    const athlete = judged ? (athletes[0] ?? null) : null;
    addFrame(slot.tally, judged, athlete, answer.ms);
    panels.drawSkeletons(view.canvas, given, people, athletes);
    view.now.textContent = `${answer.ms.toFixed(0)} ms · ${people.length === 1 ? '1 person' : `${people.length} people`}${
      athlete ? ` · the athlete, ${Math.round(pointsSeen(athlete) * 13)} of 13 points seen` : ''
    }`;
    found.push({ id: view.model.id, people: people.length, athlete: athlete !== null, ms: answer.ms });
    if (k === 0) {
      firstPeople = people;
      firstAthletes = athletes;
    }
  }
  updateCompare();
  showStats(s, result, following, prepared, detectorMs);
  announce(s, result, firstPeople, found);
  // A seek or a restart while the models ran: the detector starts again elsewhere, and the position shows where it goes.
  if (s.cuts !== cut) return;
  // The mask keeps the first model's athletes next frame, where they do not move enough to be seen moving; the turn learns from them.
  if (result && !following) {
    const bodies = keepBodyBox.checked && firstAthletes && result.athletes.length ? firstAthletes : [];
    layer.seeBodies(bodies.map((p) => bodyBox(p, result)).filter((b) => b !== null));
  }
  if (firstAthletes) viewer?.learn(result?.athletes.length ? (firstAthletes[0] ?? null) : null, size);
  showPosition(index, frame / s.fps);
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
  // Both show the frame at `index` and move on; a step asked while another frame is processed is not lost to a show.
  if (request && pending !== 'step') pending = request;
  if (busy) return;
  busy = true;
  let current: Session | null = null;
  // A frame of a video that was closed failed (its video let go of in the middle of a seek): the next video's frame is still to show.
  let again = false;
  try {
    for (;;) {
      const s = session;
      if (!s) break;
      current = s;
      const mode = pending ?? (playing && s.index < s.total ? 'play' : null);
      if (!mode) break;
      pending = null;
      // A frame asked for at the end of the clip is the last one.
      s.index = Math.min(s.index, s.total - 1);
      const index = s.index;
      const cut = s.cuts;
      await processFrame(s);
      if (s.closed) continue;
      // The next frame is the one after it, unless a seek or a restart while the frame was processed has moved the position already.
      if (s.cuts === cut) s.index = Math.min(index + 1, s.total);
      if (mode === 'play') {
        setStatus('Playing…');
        await nextPaint();
      }
    }
    if (session) {
      const atEnd = session.index >= session.total;
      if (atEnd) playing = false;
      setStatus(
        atEnd
          ? 'The end of the video. Play again, or move the position.'
          : playing
            ? 'Playing…'
            : touch.matches
              ? 'Paused. Tap a video to play it, slide sideways on it to move.'
              : 'Paused.',
      );
    }
  } catch (error) {
    if (!current?.closed) {
      playing = false;
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    } else {
      again = session !== null;
    }
  } finally {
    busy = false;
    updateControls();
  }
  if (again) void run(null);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openVideo(file);
  fileInput.value = '';
});

// --- Drag and drop -----------------------------------------------------------------------------------------------

/** A video file: the type the system gives, or the extension when it gives none (some systems do not know .mkv or .mov). */
function isVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i.test(file.name);
}
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
/** dragenter and dragleave fire for every element the drag crosses: the page is left when as many have left as were entered. */
let dragDepth = 0;
const setDragging = (on: boolean) => document.body.classList.toggle('is-dragging', on);

document.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  setDragging(rendering === null);
});
document.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return;
  // Without this the browser opens the file in the tab instead of giving it to the page.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = rendering ? 'none' : 'copy';
});
document.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragging(false);
});
document.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  setDragging(false);
  if (rendering) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  const file = files.find(isVideo);
  if (file) void openVideo(file);
  else if (files.length > 0) setStatus(`${files[0].name} is not a video.`, 'error');
});

// --- Playing -----------------------------------------------------------------------------------------------------

function togglePlay(): void {
  if (!session || rendering) return;
  if (playing) {
    playing = false;
    updateControls();
    return;
  }
  if (session.index >= session.total) restart();
  playing = true;
  updateControls();
  void run(null);
}

playButton.addEventListener('click', togglePlay);

stepButton.addEventListener('click', () => {
  if (session && !playing) void run('step');
});

// Space plays and pauses, unless a control that takes it has the focus.
document.addEventListener('keydown', (event) => {
  if (event.key !== ' ' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, select, textarea, button, summary, label, [contenteditable]')) return;
  if (!session) return;
  event.preventDefault();
  togglePlay();
});

/** Starts the detector again (the video was cut: a seek, a restart), with the place of the athlete when it is known, so that the mask is there at once. */
function resetDetector(s: Session): void {
  s.cuts++;
  layer.detector.reset();
  layer.detector.hint(s.hint);
  viewer?.reset();
  zoomGate = new ZoomGate();
}

function restart(): void {
  if (!session) return;
  session.index = 0;
  resetDetector(session);
  // From the start, as the app reads it: the camera has not been seen to follow yet, and the comparison starts again.
  follow.reset();
  resetTallies();
  updateControls();
}

/**
 * The look at the start of the clip (the same one that makes the video for the app), on a video of its own, in the background: it says where the
 * athlete jumps. Until it is done a seek shows the picture as it is until the detector is sure; after, the mask is there from the first frame.
 */
async function scoutSession(s: Session): Promise<void> {
  let video: HTMLVideoElement | null = null;
  try {
    video = await loadVideo(s.url);
    const plan = resultPlan(video.duration, s.fps, s.stride);
    const box = await scoutAthlete(
      video,
      { sourceFps: s.fps, stride: s.stride, config: { ...layer.detector.config } },
      plan,
    );
    if (s.closed) return;
    s.hint = box;
    // The video may be at its first frame, with nothing learned yet: the athlete is shown there too.
    if (!playing && s.shown === 0 && s.index <= 1 && box) {
      resetDetector(s);
      s.index = 0;
      void run('show');
    }
  } catch {
    // The look is a help for the mask, not a need: the detector goes on without it.
  } finally {
    if (video) disposeVideo(video);
  }
}

restartButton.addEventListener('click', () => {
  restart();
  void run('show');
});

// Seeking cuts the video: the detector starts again from that frame (a gap in time resets it by itself).
function moveTo(index: number): void {
  if (!session) return;
  session.index = index;
  resetDetector(session);
  showPosition(index, (index * session.stride) / session.fps);
  void run('show');
}

seek.addEventListener('input', () => moveTo(Number(seek.value)));

for (const box of [zoomBox, turnBox]) {
  box.addEventListener('change', () => {
    updateViewer();
    reshow();
  });
}

hideBox.addEventListener('change', () => {
  reshow();
});

// --- The result, in the app --------------------------------------------------------------------------------------

/**
 * The settings as they are now, for the app (`PageSettings`): it analyzes the clip with them, the way this page shows it. The pose model is
 * the first one ticked, the one whose skeleton the mask keeps (the app's own when none is ticked: the mask then keeps no skeleton).
 */
function pageSettings(): PageSettings {
  const first = tickedModels()[0]?.model;
  const model = first ?? POSE_MODELS.find((m) => m.id === DEFAULT_MODEL)!;
  return {
    config: { ...layer.detector.config },
    fill: layer.fill,
    hide: hideBox.checked,
    keepBodies: keepBodyBox.checked && first !== undefined,
    zoom: zoomBox.checked,
    rotate: turnBox.checked,
    engine: model.engine,
    model: model.variant,
    preferGpu: gpuBox.checked,
  };
}

/**
 * Makes the masked video of the whole clip with the settings as they are now, leaves it with the clip itself and the settings for the app
 * and goes there. The app shows the clip and analyzes it live through the detector with these settings; the masked video (named after
 * the clip) is what its pose model reads instead when its motion detector is switched off.
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
      settings: pageSettings(),
      original: s.file,
      masked: new File([made.blob], maskedName(s.file.name), { type: made.blob.type }),
      // Whether the athlete is small on a steady shot. The app reads it only from a record without settings (one an earlier page left).
      zoom: made.zoomShare >= ZOOM_WINS_SHARE,
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
  for (const view of ticked.values()) view.slot.dispose();
});

// Back from the app can bring this page back from the browser's cache, after `pagehide` has closed its video: it starts again instead.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});

updateControls();
