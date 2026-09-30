import { t, tp } from '../../../i18n/core';
import type { Capabilities } from '../../../pose3d/capabilities';
import type { TwistDirection, TwistEstimate } from '../../../pose3d/twist';
import { DASH, fmt, pct, signed } from '../../format';
import { fig, row, type FigureRow } from './figures';

/** The wording of the twist panel's lists, kept apart from the components like the other coach figures. */

const CHECK_KEYS = {
  rounding: 'twist.check.rounding',
  coverage: 'twist.check.coverage',
  steps: 'twist.check.steps',
  monotonic: 'twist.check.monotonic',
  shoulderHip: 'twist.check.shoulderHip',
  axisDepth: 'twist.check.axisDepth',
  depth: 'twist.check.depth',
} as const;

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
    label: key in CHECK_KEYS ? t(CHECK_KEYS[key as keyof typeof CHECK_KEYS]) : key,
    value: pct(v),
    weak: v < WEAK_CHECK,
  }));
}

const directionText = (d: TwistDirection): string => t(`twist.dir.${d}`);

/** The rows before the ones that follow the playhead: what the estimate says for the whole jump. */
export function twistSummaryRows(e: TwistEstimate): FigureRow[] {
  return [
    row('net', t('twist.row.net'), [
      fig(signed(e.totalDeg, 0), '°'),
      fig(fmt(e.totalDeg === null ? null : Math.abs(e.totalDeg / 360), 2), t('u.turns'), true),
    ]),
    row('half-twists', t('twist.row.halves'), fig(e.halfTwists === null ? DASH : String(e.halfTwists))),
    row('direction', t('twist.row.direction'), fig(directionText(e.direction)), t('twist.row.directionHint')),
    row('peak', t('twist.row.peak'), fig(fmt(e.peakAngularVelocityDps, 0), '°/s')),
    row('mean', t('twist.row.mean'), fig(fmt(e.meanAbsAngularVelocityDps, 0), '°/s')),
  ];
}

export function twistTiltRow(e: TwistEstimate): FigureRow {
  return row('tilt', t('twist.row.tilt'), [
    fig(fmt(e.axisTiltDeg, 0), '°'),
    ...(e.axisTiltDeg !== null ? [fig(t('twist.row.onAverage'), undefined, true)] : []),
  ]);
}

/** The same net twist read from other data, as a check on the main estimate. */
export function crossRows(e: TwistEstimate): FigureRow[] {
  return [
    row('shoulders', t('twist.row.shoulders'), fig(signed(e.cross.shouldersDeg, 0), '°')),
    row('hips', t('twist.row.hips'), fig(signed(e.cross.hipsDeg, 0), '°')),
    row('plane', t('twist.row.plane'), fig(signed(e.cross.inPlaneAxisDeg, 0), '°')),
  ];
}

/** What this browser can run, as rows of words. */
export function capabilityRows(c: Capabilities): FigureRow[] {
  const yes = (v: boolean) => (v ? t('common.yes') : t('common.no'));
  return [
    row(
      'webgpu',
      'WebGPU',
      fig(
        c.webgpu === 'available'
          ? t('common.yes')
          : c.webgpu === 'no-adapter'
            ? t('twist.cap.webgpuNoAdapter')
            : t('common.no'),
      ),
    ),
    row('webgl2', 'WebGL 2', fig(yes(c.webgl2))),
    row('wasm', t('twist.cap.wasm'), fig(`${yes(c.wasm)} / ${yes(c.wasmSimd)}`)),
    row('threads', t('twist.cap.threads'), fig(c.wasmThreads ? t('common.yes') : t('twist.cap.threadsNo'))),
    row('cpu', t('twist.cap.cpu'), fig(`${c.cores ?? '?'} / ${c.deviceMemoryGb ?? '?'} GB`)),
  ];
}

/** Half twists as the annotator counts them: `2 (= 1 twist)`. */
export const halfTwistOption = (v: number) => tp('twist.option', v / 2, { v, twists: String(v / 2) });

/** What one camera can never tell about a twist. The numbers come from the estimator's own limits. */
export function cameraLimits(fps: number, maxStepDeg: number): { signal: string; problem: string; needed?: string }[] {
  const maxRate = 90 * fps;
  return [
    {
      signal: t('twist.limit.depth.signal'),
      problem: t('twist.limit.depth.problem'),
      needed: t('twist.limit.depth.needed'),
    },
    {
      signal: t('twist.limit.error.signal'),
      problem: t('twist.limit.error.problem'),
      needed: t('twist.limit.error.needed'),
    },
    {
      signal: t('twist.limit.swap.signal'),
      problem: t('twist.limit.swap.problem', { max: maxStepDeg }),
      needed: t('twist.limit.swap.needed'),
    },
    {
      signal: t('twist.limit.rate.signal'),
      problem: t('twist.limit.rate.problem', {
        fps: fmt(fps, 0),
        rate: fmt(maxRate, 0),
        perSecond: fmt(maxRate / 360, 1),
      }),
    },
    { signal: t('twist.limit.validated.signal'), problem: t('twist.limit.validated.problem') },
  ];
}
