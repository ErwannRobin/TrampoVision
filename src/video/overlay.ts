import { JUMP_PHASES } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { POSITIONS } from '../skills/types';
import type { Point } from '../pose/types';
import { buildWireframe, type Side } from '../pose/skeleton';

export interface OverlayOptions {
  skeleton: boolean;
  com: boolean;
  trail: boolean;
  /** Body position, rotation and predicted skill as text on the video. */
  hud: boolean;
}

// Video frames are arbitrary imagery, so overlay colors are fixed and drawn with a dark halo.
const COLORS: Record<Side, string> = { left: '#4da3ff', right: '#ff8a4c', center: '#f4f4f4' };
const COM_COLOR = '#ffd400';
const LOW_CONFIDENCE = 0.5;

function stroke(ctx: CanvasRenderingContext2D, width: number, color: string, halo = true) {
  if (halo) {
    ctx.lineWidth = width + 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
  }
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Draws the skeleton, COM marker and COM trajectory for one analysis sample. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  result: AnalysisResult,
  sample: number,
  opts: OverlayOptions,
  skills: SkillAnalysis | null = null,
) {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const sx = cssWidth / result.meta.width;
  const sy = cssHeight / result.meta.height;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (opts.trail) {
    const drawPath = (from: number, to: number, alpha: number) => {
      ctx.beginPath();
      let pen = false;
      for (let i = from; i <= to; i++) {
        const x = result.comX[i];
        const y = result.comY[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x * sx, y * sy);
        else ctx.moveTo(x * sx, y * sy);
        pen = true;
      }
      ctx.globalAlpha = alpha;
      stroke(ctx, 2, COM_COLOR);
      ctx.globalAlpha = 1;
    };
    drawPath(0, result.meta.count - 1, 0.3); // full path, faint
    drawPath(0, sample, 0.95); // travelled part
  }

  const pose = result.landmarks[sample];
  const lowConfidence = result.confidence[sample] < LOW_CONFIDENCE;

  if (opts.skeleton && pose) {
    const wf = buildWireframe(pose);
    ctx.globalAlpha = lowConfidence ? 0.5 : 1;
    if (lowConfidence) ctx.setLineDash([6, 5]);
    for (const b of wf.bones) {
      ctx.beginPath();
      ctx.moveTo(b.a.x * sx, b.a.y * sy);
      ctx.lineTo(b.b.x * sx, b.b.y * sy);
      stroke(ctx, 3, COLORS[b.side]);
    }
    ctx.setLineDash([]);
    if (wf.head) {
      ctx.beginPath();
      ctx.arc(wf.head.x * sx, wf.head.y * sy, wf.headRadius * Math.min(sx, sy), 0, Math.PI * 2);
      stroke(ctx, 3, COLORS.center);
    }
    for (const j of wf.joints) {
      ctx.beginPath();
      ctx.arc(j.p.x * sx, j.p.y * sy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[j.side];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (opts.com && Number.isFinite(result.comX[sample])) {
    // A solid dot (readable on any background) inside a thin ring.
    const x = result.comX[sample] * sx;
    const y = result.comY[sample] * sy;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    stroke(ctx, 1.5, COM_COLOR);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = COM_COLOR;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.stroke();
  }

  // Text block (top left): jump phase, body position, rotation so far, predicted skill, warnings.
  const lines: { text: string; color: string }[] = [];
  const phase = JUMP_PHASES[result.jumps.phase[sample]];
  const flying = result.jumps.cycleIndex[sample];
  if (phase !== 'unknown') {
    lines.push({ text: flying >= 0 ? `Jump ${flying + 1} · ${phase}` : phase, color: phase === 'ground' ? '#f4f4f4' : COM_COLOR });
  }
  if (opts.hud && skills) {
    if (flying >= 0) {
      lines.push({ text: `Body: ${POSITIONS[skills.frames.position[sample]]}`, color: '#f4f4f4' });
      const turns = result.jumps.turnsSinceTakeoff[sample];
      if (Number.isFinite(turns)) lines.push({ text: `Rotation: ${turns.toFixed(2)} turns`, color: '#f4f4f4' });
    }
    // The prediction of the jump in the air, or of the last one that took off.
    let current = flying;
    if (current < 0) for (const c of result.jumps.cycles) if (c.takeoff !== null && c.takeoff <= sample) current = c.index;
    const jump = current >= 0 ? skills.jumps[current] : undefined;
    if (jump) {
      const p = jump.prediction;
      lines.push({
        text: p.skill === 'unclassified' && p.confidence === 0 ? `Jump ${current + 1}: not classified` : `${p.label} · ${Math.round(p.confidence * 100)}%`,
        color: p.skill === 'unclassified' || p.confidence < 0.6 ? '#ffb15c' : '#7dff8f',
      });
    }
  }
  if (lowConfidence) lines.push({ text: pose ? 'low pose confidence' : 'no athlete detected', color: COM_COLOR });
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  lines.forEach((l, k) => {
    ctx.strokeText(l.text, 10, 20 + 18 * k);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, 10, 20 + 18 * k);
  });
}


// --- Trampoline calibration overlay -------------------------------------------------------------

const CAL_COLOR = '#19d3c5';

export interface CalibrationDraw {
  /** Clicked corners in video pixels (0 to 4). */
  corners: Point[];
  /** Bed center in video pixels once the four corners are valid. */
  center: Point | null;
  editing: boolean;
}

/** Draws the bed outline, corner handles and the vertical line through the bed center. */
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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = cal.corners.map((p) => ({ x: p.x * sx, y: p.y * sy }));

  if (pts.length >= 2) {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (pts.length === 4) ctx.closePath();
    ctx.setLineDash([8, 5]);
    stroke(ctx, 2, CAL_COLOR);
    ctx.setLineDash([]);
    if (pts.length === 4) {
      ctx.fillStyle = 'rgba(25, 211, 197, 0.12)';
      ctx.fill();
    }
  }

  if (cal.center) {
    const cx = cal.center.x * sx;
    const cy = cal.center.y * sy;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cssHeight);
    ctx.setLineDash([3, 6]);
    stroke(ctx, 1.5, CAL_COLOR);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy);
    ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx, cy + 9);
    stroke(ctx, 2, CAL_COLOR);
  }

  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, cal.editing ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = CAL_COLOR;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke();
    if (cal.editing) {
      ctx.fillStyle = '#04201d';
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    }
  });
}
