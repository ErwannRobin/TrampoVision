import type { CalibrationModel } from '../../analysis/calibration';
import type { JumpCycle } from '../../analysis/jumpCycles';
import type { AnalysisResult } from '../../analysis/types';
import { POSITIONS, type BodyPosition, type JumpSequence } from '../../skills/types';
import { finiteExtent } from './geometry';
import type { ChartAxis, ChartBand, ChartGuide, ChartMarker } from './types';

/** What the charts draw besides their curves: the events of the jumps, the flights, and the reference lines. */

export interface Decorations {
  markers: ChartMarker[];
  bands: ChartBand[];
  bedGuides: ChartGuide[];
  turnGuides: ChartGuide[];
}

const turns = (n: number) => `${n} turn${Math.abs(n) === 1 ? '' : 's'}`;

/** Events, flights, bed edges and whole turns of a clip, in seconds and in the units of the whole-clip charts. */
export function clipDecorations(
  result: Pick<AnalysisResult, 'jumps' | 'time' | 'meta' | 'orientation'>,
  calibration: CalibrationModel | null,
): Decorations {
  const { cycles } = result.jumps;
  const { time, meta } = result;
  const markers = cycles.flatMap((c) => [
    ...(c.takeoffTimeS !== null ? [{ t: c.takeoffTimeS, label: 'T' }] : []),
    { t: c.apexTimeS, label: 'A' },
    ...(c.landingTimeS !== null ? [{ t: c.landingTimeS, label: 'L' }] : []),
  ]);
  // A jump cut off by the clip is shaded to the edge of the clip.
  const bands = cycles.map((c) => ({ from: c.takeoffTimeS ?? time[0], to: c.landingTimeS ?? time[time.length - 1] }));
  const halfBed =
    calibration && meta.calibrated ? calibration.halfExtentM / calibration.metersPerPixel / meta.pixelsPerMeter : NaN;
  const bedGuides = Number.isFinite(halfBed)
    ? [
        { value: -halfBed, label: 'Bed edge' },
        { value: halfBed, label: 'Bed edge' },
      ]
    : [];
  const turnGuides: ChartGuide[] = [];
  const extent = finiteExtent(result.orientation);
  if (extent) {
    const lo = Math.ceil(extent[0] / 360);
    const hi = Math.floor(extent[1] / 360);
    for (let k = lo; k <= hi && k - lo < 40; k++) turnGuides.push({ value: k * 360, label: turns(k) });
  }
  return { markers, bands, bedGuides, turnGuides };
}

/** Half twists of the accumulated twist angle: a line at every 180 degrees. */
export function twistGuides(angle: Float64Array): ChartGuide[] {
  const extent = finiteExtent(angle);
  if (!extent) return [];
  const lo = Math.ceil(extent[0] / 180);
  const hi = Math.floor(extent[1] / 180);
  const out: ChartGuide[] = [];
  for (let k = lo; k <= hi && out.length < 30; k++)
    out.push({
      value: k * 180,
      label: k === 0 ? undefined : `${Math.abs(k) / 2} twist${Math.abs(k) === 2 ? '' : 's'}`,
    });
  return out;
}

/** Takeoff, apex and landing of a jump on its normalized time (0 = takeoff, 1 = landing). */
export function jumpMarkers(
  cycle: Pick<JumpCycle, 'apexTimeS'>,
  seq: Pick<JumpSequence, 'takeoffTimeS' | 'durationS'>,
) {
  return [
    { t: 0, label: 'T' },
    { t: (cycle.apexTimeS - seq.takeoffTimeS) / seq.durationS, label: 'A' },
    { t: 1, label: 'L' },
  ];
}

/** A line at every half turn of the rotation since takeoff. */
export function jumpTurnGuides(rotation: Float64Array): ChartGuide[] {
  const extent = finiteExtent(rotation);
  if (!extent) return [];
  const lo = Math.ceil(extent[0] * 2) / 2;
  const hi = Math.floor(extent[1] * 2) / 2;
  const out: ChartGuide[] = [];
  for (let v = lo; v <= hi + 1e-9 && out.length < 12; v += 0.5) out.push({ value: v, label: turns(v) });
  return out;
}

/** The columns of a normalized jump sequence the charts read. NaN where the sequence has no value. */
export interface SequenceColumns {
  u: Float64Array;
  height: Float64Array;
  xBed: Float64Array;
  xBody: Float64Array;
  turns: Float64Array;
  hip: Float64Array;
  knee: Float64Array;
  position: Float64Array;
  quality: Float64Array;
}

export function sequenceColumns(seq: Pick<JumpSequence, 'columns' | 'data'>): SequenceColumns {
  const get = (name: string) => {
    const c = seq.columns.indexOf(name);
    return Float64Array.from(seq.data, (row) => (typeof row[c] === 'number' ? row[c] : NaN));
  };
  return {
    u: get('u'),
    height: get('com_h_body'),
    xBed: get('com_x_bed'),
    xBody: get('com_x_body'),
    turns: get('orient_turns'),
    hip: get('hip_angle_deg'),
    knee: get('knee_angle_deg'),
    position: get('position'),
    quality: get('quality'),
  };
}

/** The x axis of the selected-jump charts: 0 = takeoff, 1 = landing. The ends are named, the rest are fractions. */
export function sequenceAxis(seq: Pick<JumpSequence, 'takeoffTimeS' | 'durationS'>): ChartAxis {
  return {
    toX: (s) => (s - seq.takeoffTimeS) / seq.durationS,
    toSeconds: (x) => seq.takeoffTimeS + x * seq.durationS,
    tick: (x) => (x === 0 ? 'takeoff' : x === 1 ? 'landing' : x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')),
  };
}

export interface PositionRun {
  position: BodyPosition;
  /** The pose measurements under this stretch were mostly unusable: it is drawn hatched. */
  unsure: boolean;
  /** Normalized time of its first and last sample. */
  from: number;
  to: number;
  /** Its share of the strip. Samples sit on a 0..1 line and each owns the stretch around it, so the ends own half. */
  weight: number;
}

/** The body position of a jump as stretches of one shape, so the strip is a handful of elements and not one per sample. */
export function positionRuns(position: ArrayLike<number>, quality: ArrayLike<number>): PositionRun[] {
  const n = position.length;
  const runs: { position: BodyPosition; unsure: boolean; first: number; last: number }[] = [];
  for (let k = 0; k < n; k++) {
    const shape = POSITIONS[position[k]] ?? 'unknown';
    const unsure = !(quality[k] >= 0.5);
    const prev = runs[runs.length - 1];
    if (prev && prev.position === shape && prev.unsure === unsure) prev.last = k;
    else runs.push({ position: shape, unsure, first: k, last: k });
  }
  const span = Math.max(1, n - 1);
  return runs.map((r) => ({
    position: r.position,
    unsure: r.unsure,
    from: r.first / span,
    to: r.last / span,
    weight: Math.max(0.001, r.last - r.first + 1 - (r.first === 0 ? 0.5 : 0) - (r.last === n - 1 ? 0.5 : 0)),
  }));
}
