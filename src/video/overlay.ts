import { JUMP_PHASES, type JumpPhase } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';
import { lower, t } from '../i18n/core';
import { buildWireframe, type Side } from '../pose/skeleton';
import type { Keypoint, Point } from '../pose/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { POSITIONS, type SkillPrediction } from '../skills/types';
import { fmt } from '../ui/format';
import { confidenceTier, skillName, type ConfidenceTier } from '../ui/insights';

export interface OverlayOptions {
  skeleton: boolean;
  com: boolean;
  trail: boolean;
  /** The label chips: jump phase, predicted skill and, in full detail, body position and rotation. */
  hud: boolean;
  /** How much the labels say: 'simple' for the athlete (phase and skill), 'full' for the coach (adds body position and rotation). */
  detail?: 'simple' | 'full';
  /** Draws the skeleton in this one color instead of the left/right colors: how athletes are told apart when several are shown. */
  tint?: string;
}

/*
 * Everything here is drawn on footage of any brightness, so the colors are fixed instead of read from the page. They
 * are the data colors of the interface: the left of the body is the "lift" blue, the right the "drop" orange, and the
 * center of mass is gold, the one bright thing on the frame. Marks are thin and quiet; a soft dark glow (a blurred
 * shadow, never a hard outline) keeps them readable on bright footage.
 *
 * Export calls these functions on a canvas that already holds the video frame, at a 960 px reference width with a
 * scaling transform applied: geometry comes only from the css size passed in, nothing is cleared unless asked, and
 * every function restores the context state it changes.
 */
const SIDE: Record<Side, string> = { left: '#62b0ff', right: '#ff9a55', center: '#f4f6f8' };
const GOLD = '#ffc933';
const WHITE = '#ffffff';
const INK = 'rgba(8, 10, 14, 0.75)';
const HALO = 'rgba(0, 0, 0, 0.45)';
const GLOW = 'rgba(0, 0, 0, 0.6)';
const NO_SHADOW = 'rgba(0, 0, 0, 0)';
const TEAL = '#19d3c5';
const TEAL_FILL = 'rgba(25, 211, 197, 0.1)';
const CHIP_FILL = 'rgba(12, 13, 15, 0.55)';
const CHIP_STROKE = 'rgba(255, 255, 255, 0.2)';
const CHIP_DASHED = 'rgba(255, 255, 255, 0.6)';
const CHIP_TEXT = '#f5f6f8';
const CHIP_MUTED = 'rgba(245, 246, 248, 0.66)';
const FONT = '"Archivo Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

/** Pose confidence under which the skeleton is drawn dashed: solid means sure, dashed means not sure. */
const UNCLEAR_BELOW = 0.5;
/** The travelled path of the last stretch is a comet; older path is a hairline. */
const TAIL_SECONDS = 1.5;
const TAIL_BANDS = 8;
const TAU = Math.PI * 2;

interface Frame {
  /** Css size of the picture being drawn on. */
  w: number;
  h: number;
  /** Video pixels to css pixels. */
  sx: number;
  sy: number;
  /** One unit of mark size: 1 at the 720 px reference width, never below 0.7 so marks stay legible on a phone. */
  u: number;
  /** Device pixels per css pixel. Shadow sizes ignore the transform, so they are multiplied by this by hand. */
  k: number;
}

function deviceScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

const markUnit = (cssWidth: number) => Math.max(0.7, cssWidth / 720);

// --- Labels --------------------------------------------------------------------------------------------------

export type ChipMark = 'lift' | 'drop' | 'apex' | 'neutral' | ConfidenceTier;

export interface ChipPart {
  text: string;
  /** The quiet second voice of a chip: a unit, a percentage. */
  muted?: boolean;
}

export interface ChipSpec {
  parts: ChipPart[];
  /** A dot before the text. Phases use the data colors; a skill's dot is the classifier's confidence: green, amber or red, solid when sure and a dashed ring when not. */
  mark?: ChipMark;
  dashed?: boolean;
}

export interface Labels {
  left: ChipSpec[];
  /** A warning about the pose at this frame. */
  right: ChipSpec | null;
}

const PHASE_MARK: Record<Exclude<JumpPhase, 'unknown'>, ChipMark> = {
  ground: 'neutral',
  takeoff: 'lift',
  ascent: 'lift',
  apex: 'apex',
  descent: 'drop',
  landing: 'drop',
};

const MARK_COLOR: Record<ChipMark, string> = {
  lift: SIDE.left,
  drop: SIDE.right,
  apex: GOLD,
  neutral: 'rgba(255, 255, 255, 0.5)',
  high: '#4cd48b',
  medium: '#f2b04c',
  low: '#ff7b72',
  none: 'rgba(255, 255, 255, 0.6)',
};

function phaseText(phase: Exclude<JumpPhase, 'unknown'>, jump: number): string {
  if (phase === 'ground') return t('phase.ground');
  return jump >= 0 ? t('overlay.jumpPhase', { n: jump + 1, phase: lower(t(`phase.${phase}`)) }) : t(`phase.${phase}`);
}

/** The jump the playhead is in, else the last one that took off: what the labels and the path markers describe. */
function currentJump(result: AnalysisResult, sample: number): number {
  const flying = result.jumps.cycleIndex[sample];
  if (flying >= 0) return flying;
  let current = -1;
  for (const c of result.jumps.cycles) if (c.takeoff !== null && c.takeoff <= sample) current = c.index;
  return current;
}

/** The confidence is the dot before the name, not words: the numbers live in the panel. */
export function skillChip(p: SkillPrediction, minConfidence: number): ChipSpec {
  return { parts: [{ text: skillName(p) }], mark: confidenceTier(p, minConfidence) };
}

/** What the label chips say at one sample. Pure: drawing them is `drawLabels`. */
export function buildLabels(
  result: AnalysisResult,
  sample: number,
  skills: SkillAnalysis | null,
  detail: 'simple' | 'full',
): Labels {
  const full = detail === 'full';
  const left: ChipSpec[] = [];
  const phase = JUMP_PHASES[result.jumps.phase[sample]] ?? 'unknown';
  const flying = result.jumps.cycleIndex[sample] ?? -1;
  if (phase !== 'unknown') left.push({ parts: [{ text: phaseText(phase, flying) }], mark: PHASE_MARK[phase] });

  if (skills) {
    const jump = skills.jumps[currentJump(result, sample)];
    if (jump) left.push(skillChip(jump.prediction, skills.config.minConfidence));
    if (full && flying >= 0) {
      const position = POSITIONS[skills.frames.position[sample]];
      if (position) {
        left.push({
          parts: [
            { text: t('overlay.body'), muted: true },
            { text: position === 'unknown' ? lower(t('fig.between')) : lower(t(`pos.${position}`)) },
          ],
        });
      }
      const turns = result.jumps.turnsSinceTakeoff[sample];
      if (Number.isFinite(turns)) {
        const text = `${turns < 0 ? '−' : ''}${fmt(Math.abs(turns), 2)} ${t('u.turns')}`;
        left.push({ parts: [{ text: t('row.rotation'), muted: true }, { text }] });
      }
    }
  }

  const unclear = result.confidence[sample] < UNCLEAR_BELOW;
  const right: ChipSpec | null = unclear
    ? { parts: [{ text: t(result.landmarks[sample] ? 'overlay.lowConfidence' : 'overlay.noAthlete') }], dashed: true }
    : null;
  return { left, right };
}

interface TypeScale {
  font: string;
  size: number;
  height: number;
  padX: number;
  margin: number;
  gap: number;
  markWidth: number;
  partGap: number;
}

/** Text does not shrink below what is readable on a phone, even where the marks do. */
function typeScale(u: number): TypeScale {
  const size = Math.round(12 * Math.max(u, 0.95));
  return {
    font: `600 ${size}px ${FONT}`,
    size,
    height: Math.round(size * 1.85),
    padX: Math.round(size * 0.8),
    margin: Math.round(size * 0.9),
    gap: Math.round(size * 0.4),
    markWidth: size * 0.95,
    partGap: size * 0.55,
  };
}

interface LaidChip {
  chip: ChipSpec;
  parts: { text: string; muted: boolean; width: number }[];
  width: number;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** Measures a chip with the font that is set on the context. Only the first part gives way when the chip is too wide. */
function layoutChip(ctx: CanvasRenderingContext2D, chip: ChipSpec, ts: TypeScale, maxWidth: number): LaidChip {
  const parts = chip.parts.map((p) => ({ text: p.text, muted: !!p.muted, width: ctx.measureText(p.text).width }));
  const fixed = 2 * ts.padX + (chip.mark ? ts.markWidth : 0) + ts.partGap * (parts.length - 1);
  const rest = parts.slice(1).reduce((sum, p) => sum + p.width, 0);
  if (parts[0] && fixed + parts[0].width + rest > maxWidth) {
    parts[0].text = ellipsize(ctx, parts[0].text, Math.max(0, maxWidth - fixed - rest));
    parts[0].width = ctx.measureText(parts[0].text).width;
  }
  return { chip, parts, width: fixed + parts.reduce((sum, p) => sum + p.width, 0) };
}

/** A rounded rectangle path; older browsers have no `roundRect`. */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints a laid-out chip with its top left corner at (x, y). Expects `ctx.font` to be the chip font. */
function paintChip(ctx: CanvasRenderingContext2D, laid: LaidChip, x: number, y: number, ts: TypeScale) {
  const { chip, parts, width } = laid;
  const cy = y + ts.height / 2;
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, x, y, width, ts.height, ts.height / 2);
  ctx.fillStyle = CHIP_FILL;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = chip.dashed ? CHIP_DASHED : CHIP_STROKE;
  if (chip.dashed) ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  let tx = x + ts.padX;
  if (chip.mark) {
    const r = ts.size * 0.25;
    ctx.beginPath();
    ctx.arc(tx + r, cy, r, 0, TAU);
    if (chip.mark === 'medium' || chip.mark === 'low' || chip.mark === 'none') {
      // Not sure: a dashed ring, so the meaning does not rest on the color alone. A faint fill keeps the hue readable at this size.
      const dash = Math.max(1.2, ts.size * 0.14);
      if (chip.mark !== 'none') {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = MARK_COLOR[chip.mark];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([dash, dash]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = MARK_COLOR[chip.mark];
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = MARK_COLOR[chip.mark];
      ctx.fill();
    }
    tx += ts.markWidth;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const p of parts) {
    ctx.fillStyle = p.muted ? CHIP_MUTED : CHIP_TEXT;
    ctx.fillText(p.text, tx, cy + ts.size * 0.35);
    tx += p.width + ts.partGap;
  }
  ctx.restore();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  result: AnalysisResult,
  sample: number,
  skills: SkillAnalysis | null,
  detail: 'simple' | 'full',
  f: Frame,
) {
  const { left, right } = buildLabels(result, sample, skills, detail);
  if (left.length === 0 && !right) return;
  const ts = typeScale(f.u);
  const room = f.w - 2 * ts.margin;
  ctx.save();
  ctx.font = ts.font;
  const rows = left.map((chip) => layoutChip(ctx, chip, ts, room));
  let warning = right && layoutChip(ctx, right, ts, room);
  // On a narrow picture the warning would run into the first chip: it joins the column instead.
  if (warning && rows[0] && rows[0].width + 2 * ts.gap + warning.width > room) {
    rows.push(warning);
    warning = null;
  }
  let y = ts.margin;
  for (const row of rows) {
    paintChip(ctx, row, ts.margin, y, ts);
    y += ts.height + ts.gap;
  }
  if (warning) paintChip(ctx, warning, f.w - ts.margin - warning.width, ts.margin, ts);
  ctx.restore();
}

// --- Trajectory ----------------------------------------------------------------------------------------------

/** Adds the path of the center of mass between two samples to a new path; a missing sample lifts the pen. */
function tracePath(ctx: CanvasRenderingContext2D, result: AnalysisResult, f: Frame, from: number, to: number) {
  const { comX, comY } = result;
  ctx.beginPath();
  let pen = false;
  for (let i = from; i <= to; i++) {
    const x = comX[i];
    const y = comY[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(x * f.sx, y * f.sy);
    else ctx.moveTo(x * f.sx, y * f.sy);
    pen = true;
  }
}

/** Takeoff (points up) and landing (points down): the same glyphs as the timeline. */
function drawTriangle(ctx: CanvasRenderingContext2D, p: Point, u: number, pointing: 'up' | 'down') {
  const s = pointing === 'up' ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - s * 4.4 * u);
  ctx.lineTo(p.x + 3.8 * u, p.y + s * 2.8 * u);
  ctx.lineTo(p.x - 3.8 * u, p.y + s * 2.8 * u);
  ctx.closePath();
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.lineWidth = 0.9 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Takeoff, apex and landing of the current jump on the path; the apex height is a label in full detail. */
function drawJumpMarks(
  ctx: CanvasRenderingContext2D,
  result: AnalysisResult,
  sample: number,
  detail: 'simple' | 'full',
  f: Frame,
) {
  const cycle = result.jumps.cycles[currentJump(result, sample)];
  if (!cycle) return;
  const at = (i: number | null): Point | null => {
    if (i === null) return null;
    const x = result.comX[i];
    const y = result.comY[i];
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x * f.sx, y: y * f.sy } : null;
  };
  // A jump cut off by the clip has no takeoff or no landing: nothing is drawn for the missing one.
  const takeoff = at(cycle.takeoff);
  const apex = at(cycle.apex);
  const landing = at(cycle.landing);
  if (takeoff) drawTriangle(ctx, takeoff, f.u, 'up');
  if (landing) drawTriangle(ctx, landing, f.u, 'down');
  if (!apex) return;

  ctx.beginPath();
  ctx.arc(apex.x, apex.y, 3.6 * f.u, 0, TAU);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineWidth = 1.3 * f.u;
  ctx.strokeStyle = WHITE;
  ctx.stroke();

  if (detail === 'full' && Number.isFinite(cycle.apexHeightM)) {
    const ts = typeScale(f.u);
    ctx.font = ts.font;
    const laid = layoutChip(ctx, { parts: [{ text: `${fmt(cycle.apexHeightM, 2)} m` }] }, ts, f.w - 2 * ts.margin);
    const offset = 7 * f.u;
    const x = apex.x + offset + laid.width <= f.w - ts.margin ? apex.x + offset : apex.x - offset - laid.width;
    const y = Math.min(Math.max(apex.y - ts.height / 2, ts.margin), f.h - ts.height - ts.margin);
    paintChip(ctx, laid, x, y, ts);
  }
}

/**
 * The path of the center of mass as a comet: the last 1.5 s are solid and thin out with age, older path is a faint
 * hairline, and the path still to come is a faint dotted line.
 */
function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  result: AnalysisResult,
  sample: number,
  detail: 'simple' | 'full',
  f: Frame,
) {
  const last = result.meta.count - 1;
  const tailStart = Math.max(0, sample - Math.max(2, Math.round(TAIL_SECONDS * result.meta.fps)));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = f.u;
  tracePath(ctx, result, f, 0, tailStart);
  ctx.stroke();

  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 1.5 * f.u;
  ctx.setLineDash([0.1, 5 * f.u]);
  tracePath(ctx, result, f, sample, last);
  ctx.stroke();
  ctx.setLineDash([]);

  // A few bands rather than a stroke per sample: cheap, and the taper still reads as continuous.
  const span = sample - tailStart;
  const bands = Math.min(TAIL_BANDS, span);
  ctx.strokeStyle = GOLD;
  for (let b = 0; b < bands; b++) {
    const age = (b + 1) / bands;
    ctx.globalAlpha = 0.15 + 0.8 * age;
    ctx.lineWidth = (0.6 + 2 * age) * f.u;
    tracePath(
      ctx,
      result,
      f,
      tailStart + Math.round((span * b) / bands),
      tailStart + Math.round((span * (b + 1)) / bands),
    );
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  drawJumpMarks(ctx, result, sample, detail, f);
  ctx.restore();
}

// --- Skeleton and center of mass -----------------------------------------------------------------------------

const SIDES: Side[] = ['center', 'left', 'right'];

/** Thin rounded bones and small joints. Dashed and translucent while the pose is unclear. */
function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Keypoint[], f: Frame, unclear: boolean, tint?: string) {
  const wf = buildWireframe(pose);
  const { sx, sy, u } = f;
  const head = wf.head;
  const headRadius = head ? wf.headRadius * Math.min(sx, sy) : 0;

  // Where each bone runs on screen. The neck starts at the edge of the head ring, not at its center.
  const segments = wf.bones.map((b) => {
    let ax = b.a.x * sx;
    let ay = b.a.y * sy;
    const bx = b.b.x * sx;
    const by = b.b.y * sy;
    const length = Math.hypot(bx - ax, by - ay);
    if (head && b.a === head && length > headRadius) {
      ax += ((bx - ax) / length) * headRadius;
      ay += ((by - ay) / length) * headRadius;
    }
    return { ax, ay, bx, by, side: b.side };
  });
  const trace = (side?: Side) => {
    ctx.beginPath();
    for (const s of segments) {
      if (side && s.side !== side) continue;
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
    }
    if (head && (!side || side === 'center')) {
      const hx = head.x * sx;
      const hy = head.y * sy;
      ctx.moveTo(hx + headRadius, hy);
      ctx.arc(hx, hy, headRadius, 0, TAU);
    }
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = unclear ? 0.55 : 1;
  const width = 2.4 * u;

  if (!unclear) {
    // One blurred pass behind the whole figure: a soft dark glow instead of an outline.
    ctx.shadowColor = GLOW;
    ctx.shadowBlur = 5 * u * f.k;
    ctx.strokeStyle = HALO;
    ctx.lineWidth = width + 1.2 * u;
    trace();
    ctx.stroke();
    ctx.shadowColor = NO_SHADOW;
    ctx.shadowBlur = 0;
  }

  ctx.lineWidth = width;
  if (unclear) ctx.setLineDash([5 * u, 4 * u]);
  for (const side of SIDES) {
    ctx.strokeStyle = tint ?? SIDE[side];
    trace(side);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const radius = 3.2 * u;
  ctx.lineWidth = 0.9 * u;
  ctx.strokeStyle = INK;
  for (const side of SIDES) {
    ctx.beginPath();
    for (const j of wf.joints) {
      if (j.side !== side || j.name === 'head') continue;
      const x = j.p.x * sx;
      const y = j.p.y * sy;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, TAU);
    }
    ctx.fillStyle = tint ?? SIDE[side];
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A gold dot with a white ring inside a soft halo: the one bright mark on the frame. */
function drawCenterOfMass(ctx: CanvasRenderingContext2D, x: number, y: number, f: Frame) {
  const { u } = f;
  ctx.save();
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 20 * u);
  halo.addColorStop(0, 'rgba(255, 201, 51, 0.55)');
  halo.addColorStop(0.5, 'rgba(255, 201, 51, 0.2)');
  halo.addColorStop(1, 'rgba(255, 201, 51, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, 20 * u, 0, TAU);
  ctx.fill();

  ctx.shadowColor = GLOW;
  ctx.shadowBlur = 4 * u * f.k;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(x, y, 5.6 * u, 0, TAU);
  ctx.fill();
  ctx.shadowColor = NO_SHADOW;
  ctx.shadowBlur = 0;

  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x, y, 4 * u, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Draws the trajectory, skeleton, center of mass and label chips for one analysis sample. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  result: AnalysisResult,
  sample: number,
  opts: OverlayOptions,
  skills: SkillAnalysis | null = null,
  clear = true,
) {
  if (clear) ctx.clearRect(0, 0, cssWidth, cssHeight);
  const f: Frame = {
    w: cssWidth,
    h: cssHeight,
    sx: cssWidth / result.meta.width,
    sy: cssHeight / result.meta.height,
    u: markUnit(cssWidth),
    k: deviceScale(ctx),
  };
  const detail = opts.detail ?? 'full';

  if (opts.trail) drawTrajectory(ctx, result, sample, detail, f);
  const pose = result.landmarks[sample];
  if (opts.skeleton && pose) drawSkeleton(ctx, pose, f, result.confidence[sample] < UNCLEAR_BELOW, opts.tint);
  if (opts.com && Number.isFinite(result.comX[sample]) && Number.isFinite(result.comY[sample])) {
    drawCenterOfMass(ctx, result.comX[sample] * f.sx, result.comY[sample] * f.sy, f);
  }
  if (opts.hud) drawLabels(ctx, result, sample, skills, detail, f);
}

// --- Trampoline calibration ----------------------------------------------------------------------------------

export interface CalibrationDraw {
  /** Clicked corners in video pixels (0 to 4). */
  corners: Point[];
  /** Bed center in video pixels once the four corners are valid. */
  center: Point | null;
  editing: boolean;
}

/**
 * Draws the bed outline (dashed while it is being edited, solid once it is set), its faint fill, a plumb line through
 * the bed center and the corner handles: large and numbered only while editing.
 */
export function drawCalibration(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  videoWidth: number,
  videoHeight: number,
  cal: CalibrationDraw,
) {
  const sx = cssWidth / videoWidth;
  const sy = cssHeight / videoHeight;
  const u = markUnit(cssWidth);
  const points = cal.corners.map((p) => ({ x: p.x * sx, y: p.y * sy }));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length >= 2) {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (points.length === 4) {
      ctx.closePath();
      ctx.fillStyle = TEAL_FILL;
      ctx.fill();
    }
    ctx.shadowColor = GLOW;
    ctx.shadowBlur = 4 * u * deviceScale(ctx);
    ctx.lineWidth = 1.6 * u;
    ctx.strokeStyle = TEAL;
    if (cal.editing) ctx.setLineDash([6 * u, 5 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = NO_SHADOW;
    ctx.shadowBlur = 0;
  }

  if (cal.center) {
    const x = cal.center.x * sx;
    const y = cal.center.y * sy;
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 1.2 * u;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([2 * u, 5 * u]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath();
    ctx.moveTo(x - 5 * u, y);
    ctx.lineTo(x + 5 * u, y);
    ctx.moveTo(x, y - 5 * u);
    ctx.lineTo(x, y + 5 * u);
    ctx.stroke();
  }

  const radius = cal.editing ? Math.max(9, 8 * u) : 2.8 * u;
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fillStyle = TEAL;
    ctx.fill();
    ctx.lineWidth = (cal.editing ? 1.5 : 0.9) * u;
    ctx.strokeStyle = cal.editing ? WHITE : INK;
    ctx.stroke();
    if (cal.editing) {
      ctx.font = `700 ${Math.round(radius * 1.1)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#04201d';
      ctx.fillText(String(i + 1), p.x, p.y + radius * 0.4);
    }
  });
  ctx.restore();
}
