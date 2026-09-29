import type { JumpCycle } from '../../analysis/jumpCycles';
import { drawGlyph, figureFont, segment, type ChartColors } from './draw';
import { clamp, tickLabel } from './geometry';
import { FALLING, RISING, type TrajectoryLayout } from './trajectory';

/** Canvas drawing of the center-of-mass path plot. The still layer is drawn once; the live layer follows the playhead. */

export interface PathData {
  count: number;
  /** Pixel positions and directions per sample (see trajectory.ts). */
  xs: Float64Array;
  ys: Float64Array;
  dir: Int8Array;
}

/** Strokes samples from..to in runs of one direction, so a long path is a few strokes, not one per sample. */
function strokeRange(
  ctx: CanvasRenderingContext2D,
  p: PathData,
  from: number,
  to: number,
  style: (dir: number) => void,
) {
  let dir = NaN;
  let pen = false;
  const lift = () => {
    if (pen) ctx.stroke();
    pen = false;
  };
  for (let i = Math.max(1, from + 1); i <= to; i++) {
    const a = i - 1;
    if (!Number.isFinite(p.xs[a]) || !Number.isFinite(p.xs[i])) {
      lift();
      dir = NaN;
      continue;
    }
    if (p.dir[i] !== dir) {
      lift();
      dir = p.dir[i];
      style(dir);
      ctx.beginPath();
      ctx.moveTo(p.xs[a], p.ys[a]);
      pen = true;
    }
    ctx.lineTo(p.xs[i], p.ys[i]);
  }
  lift();
}

const colorOf = (c: ChartColors, dir: number) => (dir === RISING ? c.lift : dir === FALLING ? c.drop : c.text3);

/** Grid, bed, the whole path (faint) and the takeoff, apex and landing of every jump. */
export function drawPathStill(
  ctx: CanvasRenderingContext2D,
  layout: TrajectoryLayout,
  p: PathData,
  cycles: readonly Pick<JumpCycle, 'takeoff' | 'apex' | 'landing'>[],
  bedHalf: number,
  c: ChartColors,
) {
  const { box, X, Y } = layout;
  ctx.lineWidth = 1;
  ctx.font = figureFont(c, 11);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of layout.yTicks) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = c.grid;
    segment(ctx, box.x0, y, box.x1, y);
    ctx.fillStyle = c.text3;
    ctx.fillText(tickLabel(v), box.x0 - 8, y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const v of layout.xTicks) {
    const x = Math.round(X(v)) + 0.5;
    ctx.strokeStyle = c.grid;
    segment(ctx, x, box.y0, x, box.y1);
    const label = tickLabel(v);
    const w = ctx.measureText(label).width;
    ctx.fillStyle = c.text3;
    ctx.fillText(label, clamp(X(v) - w / 2, 0, box.x1 + 12 - w), box.y1 + 7);
  }

  // The trampoline bed: a rounded bar on the bed surface with a tick at its center.
  if (Number.isFinite(bedHalf)) {
    const y = Y(0);
    ctx.save();
    ctx.strokeStyle = c.text2;
    ctx.globalAlpha = 0.45;
    ctx.lineCap = 'round';
    ctx.lineWidth = 6;
    segment(ctx, X(-bedHalf), y, X(bedHalf), y);
    ctx.globalAlpha = 0.8;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1.5;
    segment(ctx, X(0), y - 9, X(0), y + 9);
    ctx.restore();
    if (y + 28 < box.y1) {
      ctx.font = figureFont(c, 11);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = c.text3;
      ctx.fillText('Bed', X(0), y + 14);
    }
  }

  // What is still to come is faint; the live layer draws what has been travelled.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeRange(ctx, p, 0, p.count - 1, (dir) => {
    ctx.strokeStyle = colorOf(c, dir);
    ctx.lineWidth = dir === 0 ? 1 : 1.5;
    ctx.globalAlpha = dir === 0 ? 0.3 : 0.32;
  });
  ctx.globalAlpha = 1;

  for (const cy of cycles) {
    const events: [number | null, string][] = [
      [cy.takeoff, 'T'],
      [cy.apex, 'A'],
      [cy.landing, 'L'],
    ];
    for (const [i, label] of events) {
      if (i !== null && Number.isFinite(p.xs[i])) drawGlyph(ctx, label, p.xs[i], p.ys[i], c);
    }
  }
}

/** The path up to sample `cur` at full strength, and the current position as a gold dot with a ring. */
export function drawPathLive(ctx: CanvasRenderingContext2D, p: PathData, cur: number, c: ChartColors) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeRange(ctx, p, 0, cur, (dir) => {
    ctx.strokeStyle = colorOf(c, dir);
    ctx.lineWidth = dir === 0 ? 1.25 : 2.25;
    ctx.globalAlpha = dir === 0 ? 0.75 : 1;
  });
  ctx.globalAlpha = 1;
  if (!Number.isFinite(p.xs[cur])) return;
  const x = p.xs[cur];
  const y = p.ys[cur];
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = c.gold;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = c.goldFill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.surface;
  ctx.stroke();
}
