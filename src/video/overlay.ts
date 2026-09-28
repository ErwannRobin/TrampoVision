import { buildWireframe, type Side } from '../pose/skeleton';
import type { AnalysisResult } from '../analysis/types';

export interface OverlayOptions {
  skeleton: boolean;
  com: boolean;
  trail: boolean;
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
    const x = result.comX[sample] * sx;
    const y = result.comY[sample] * sy;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    stroke(ctx, 3, COM_COLOR);
    ctx.beginPath();
    ctx.moveTo(x - 13, y);
    ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x, y + 13);
    stroke(ctx, 2, COM_COLOR);
  }

  if (lowConfidence) {
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = '#ffd400';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    const msg = pose ? 'low pose confidence' : 'no athlete detected';
    ctx.strokeText(msg, 10, 20);
    ctx.fillText(msg, 10, 20);
  }
}
