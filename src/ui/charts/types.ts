import type { ReactNode } from 'react';
import type { Playhead } from '../playhead';

export interface ChartSeries {
  label: string;
  values: Float64Array;
  /** CSS variable holding the series color, e.g. "--series-1". */
  color: string;
}

export interface ChartMarker {
  /** Time in seconds (in x units with an `axis`). */
  t: number;
  /** T = takeoff (up triangle), A = apex (gold dot), L = landing (down triangle). */
  label: string;
}

export interface ChartBand {
  from: number;
  to: number;
}

export interface ChartGuide {
  /** y value of a dashed horizontal reference line. */
  value: number;
  label?: string;
}

/** For charts whose x axis is not the video time (e.g. normalized jump time 0..1). */
export interface ChartAxis {
  /** Playhead seconds -> x. */
  toX: (seconds: number) => number;
  /** x -> playhead seconds (a click on the chart seeks there). */
  toSeconds: (x: number) => number;
  /** Tick label for an x value. */
  tick: (x: number) => string;
}

export interface ChartProps {
  title: string;
  unit: string;
  time: Float64Array;
  series: ChartSeries[];
  playhead: Playhead;
  /** Samples with confidence below 0.5 are hatched. */
  confidence?: Float64Array;
  decimals?: number;
  zeroLine?: boolean;
  height?: number;
  /** Fixed y range (e.g. [0, 1]); otherwise the range follows the data. */
  yDomain?: [number, number];
  /** Smallest y range to show, so measurement noise isn't blown up to full height. */
  minSpan?: number;
  /** Lift the pen when consecutive samples differ by more than this (e.g. 180 for wrapped angles). */
  breakOnJump?: number;
  /** Events of the jumps (takeoff, apex, landing), drawn as the timeline's glyphs. */
  markers?: ChartMarker[];
  /** Shaded time ranges (e.g. the flights). */
  bands?: ChartBand[];
  /** Dashed horizontal reference lines; they also widen the y range. */
  guides?: ChartGuide[];
  /** `time`, `markers` and `bands` are then in x units, not seconds. */
  axis?: ChartAxis;
  /** A line under the chart that says how to read it. */
  note?: ReactNode;
}
