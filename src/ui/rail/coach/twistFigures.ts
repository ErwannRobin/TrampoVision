import type { Capabilities } from '../../../pose3d/capabilities';
import type { TwistDirection, TwistEstimate } from '../../../pose3d/twist';
import { DASH, fmt, pct, signed } from '../../format';
import { fig, row, type FigureRow } from './figures';

/** The wording of the twist panel's lists, kept apart from the components like the other coach figures. */

const CHECK_LABELS: Record<string, string> = {
  rounding: 'Close to a whole number of half twists',
  coverage: 'Shoulders and hips found in 3D',
  steps: 'No jumps between frames (left/right swaps)',
  monotonic: 'Turns one way only',
  shoulderHip: 'Shoulders and hips agree',
  axisDepth: 'Same answer with the axis kept in the image plane',
  depth: 'Constant 3D shoulder width',
};

/** A check under this share counts as weak. */
export const WEAK_CHECK = 0.8;

export interface CheckRow {
  key: string;
  label: string;
  value: string;
  weak: boolean;
}

/** The factors whose product is the consistency of a twist estimate, each with its share. */
export function checkRows(parts: TwistEstimate['parts']): CheckRow[] {
  return Object.entries(parts).map(([key, v]) => ({
    key,
    label: CHECK_LABELS[key] ?? key,
    value: pct(v),
    weak: v < WEAK_CHECK,
  }));
}

const DIRECTION_TEXT: Record<TwistDirection, string> = {
  none: 'None',
  positive: 'Counter-clockwise',
  negative: 'Clockwise',
};

/** The rows before the ones that follow the playhead: what the estimate says for the whole jump. */
export function twistSummaryRows(e: TwistEstimate): FigureRow[] {
  return [
    row('net', 'Net twist, takeoff to landing', [
      fig(signed(e.totalDeg, 0), '°'),
      fig(fmt(e.totalDeg === null ? null : Math.abs(e.totalDeg / 360), 2), 'turns', true),
    ]),
    row('half-twists', 'Estimated half twists', fig(e.halfTwists === null ? DASH : String(e.halfTwists))),
    row(
      'direction',
      'Direction',
      fig(DIRECTION_TEXT[e.direction]),
      'Seen from above the head: + is counter-clockwise, − is clockwise.',
    ),
    row('peak', 'Peak twist speed', fig(fmt(e.peakAngularVelocityDps, 0), '°/s')),
    row('mean', 'Mean twist speed', fig(fmt(e.meanAbsAngularVelocityDps, 0), '°/s')),
  ];
}

export function twistTiltRow(e: TwistEstimate): FigureRow {
  return row('tilt', 'Trunk axis out of the image plane', [
    fig(fmt(e.axisTiltDeg, 0), '°'),
    ...(e.axisTiltDeg !== null ? [fig('on average', undefined, true)] : []),
  ]);
}

/** The same net twist read from other data, as a check on the main estimate. */
export function crossRows(e: TwistEstimate): FigureRow[] {
  return [
    row('shoulders', 'Shoulder line only', fig(signed(e.cross.shouldersDeg, 0), '°')),
    row('hips', 'Hip line only', fig(signed(e.cross.hipsDeg, 0), '°')),
    row('plane', 'Axis kept in the image plane', fig(signed(e.cross.inPlaneAxisDeg, 0), '°')),
  ];
}

/** What this browser can run, as rows of words. */
export function capabilityRows(c: Capabilities): FigureRow[] {
  const yes = (v: boolean) => (v ? 'Yes' : 'No');
  return [
    row(
      'webgpu',
      'WebGPU',
      fig(c.webgpu === 'available' ? 'Yes' : c.webgpu === 'no-adapter' ? 'API present, no GPU adapter' : 'No'),
    ),
    row('webgl2', 'WebGL 2', fig(yes(c.webgl2))),
    row('wasm', 'WebAssembly / SIMD', fig(`${yes(c.wasm)} / ${yes(c.wasmSimd)}`)),
    row('threads', 'WASM threads', fig(c.wasmThreads ? 'Yes' : 'No (not cross-origin isolated)')),
    row('cpu', 'CPU cores / memory', fig(`${c.cores ?? '?'} / ${c.deviceMemoryGb ?? '?'} GB`)),
  ];
}

/** Half twists as the annotator counts them: `2 (= 1 twist)`. */
export const halfTwistOption = (v: number) => `${v} (= ${v / 2} twist${v === 2 ? '' : 's'})`;

/** What one camera can never tell about a twist. The numbers come from the estimator's own limits. */
export function cameraLimits(fps: number, maxStepDeg: number): { signal: string; problem: string; needed?: string }[] {
  const maxRate = 90 * fps;
  return [
    {
      signal: 'Depth is guessed',
      problem:
        'The 3D pose comes from a single image. The twist is the spin of the shoulder line about the body axis, and in a side view that line points at the camera, so it is read only from which shoulder the model puts nearer.',
      needed: 'A second camera, or a depth sensor.',
    },
    {
      signal: 'A small depth error becomes a large twist',
      problem:
        'Measured on real model output (a still photo turned in the image plane): the model tilted the trunk 15° out of the plane, which produced a phantom −94° of twist over one somersault. Only the “axis in the image plane” check caught it.',
      needed: 'Measured depth.',
    },
    {
      signal: 'Left and right can swap',
      problem: `If the model swaps the two shoulders, the twist jumps by 180° between two frames. Steps above ${maxStepDeg}° are folded back and counted; the half-twist count can then be off by one.`,
      needed: 'A pose model that keeps sides stable, or a higher frame rate.',
    },
    {
      signal: 'Frame rate limits the speed',
      problem: `At ${fmt(fps, 0)} fps a twist faster than ${fmt(maxRate, 0)} °/s (${fmt(maxRate / 360, 1)} twists per second) cannot be told from a swap.`,
    },
    {
      signal: 'Not validated on real twisting athletes',
      problem:
        'The estimator is exact on a simulated 3D athlete and was checked for phantom twist on one still photo. No twisting trampolinist has been tested. The sign (+ = counter-clockwise seen from above the head) matches the model’s axes on that photo only.',
    },
  ];
}
