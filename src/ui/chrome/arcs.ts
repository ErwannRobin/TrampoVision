/**
 * The landing's signature graphic as data: a routine of flights over the bed, in the grammar of the timeline (rising
 * blue, falling orange, the apex in gold). Fixed numbers and no randomness, so it draws the same on every visit.
 */

export const ARCS_VIEW = { width: 800, height: 400, baseline: 330 } as const;

export interface Flight {
  takeoff: number;
  landing: number;
  /** Apex height above the baseline. */
  height: number;
  /** 0 to 1: how strongly the flight is drawn. The others recede, like the unselected jumps in the timeline. */
  strength: number;
  /** The one flight that is fully drawn and carries the takeoff and landing marks. */
  hero?: true;
}

/** Ordered by takeoff: they are drawn from left to right, and the small ones sit next to the text. */
export const FLIGHTS: readonly Flight[] = [
  { takeoff: 24, landing: 200, height: 72, strength: 0.34 },
  { takeoff: 100, landing: 292, height: 116, strength: 0.3 },
  { takeoff: 190, landing: 404, height: 164, strength: 0.38 },
  { takeoff: 300, landing: 524, height: 216, strength: 0.48 },
  { takeoff: 420, landing: 664, height: 290, strength: 1, hero: true },
  { takeoff: 560, landing: 748, height: 198, strength: 0.44 },
  { takeoff: 650, landing: 776, height: 98, strength: 0.28 },
];

export interface FlightGeometry {
  ascent: string;
  descent: string;
  apex: { x: number; y: number };
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * A flight is a parabola, which is one quadratic curve. Cut at the apex it becomes two halves that are each one
 * quadratic curve too, so the rise and the fall can take their own colors.
 */
export function flightGeometry(flight: Flight, baseline: number = ARCS_VIEW.baseline): FlightGeometry {
  const mid = (flight.takeoff + flight.landing) / 2;
  const top = baseline - flight.height;
  return {
    ascent: `M${round(flight.takeoff)} ${baseline}Q${round((flight.takeoff + mid) / 2)} ${round(top)} ${round(mid)} ${round(top)}`,
    descent: `M${round(mid)} ${round(top)}Q${round((mid + flight.landing) / 2)} ${round(top)} ${round(flight.landing)} ${baseline}`,
    apex: { x: round(mid), y: round(top) },
  };
}

/** The timeline's event glyphs: a small up triangle for a takeoff, a down triangle for a landing. */
export function glyphPoints(x: number, baseline: number, direction: 'up' | 'down'): string {
  return direction === 'up'
    ? `${x},${baseline - 8} ${x - 6},${baseline + 4} ${x + 6},${baseline + 4}`
    : `${x},${baseline + 8} ${x - 6},${baseline - 4} ${x + 6},${baseline - 4}`;
}

/** How long one half of a flight takes to draw. */
export const DRAW_MS = 560;
const START_MS = 120;
const STAGGER_MS = 170;

export interface FlightTiming {
  ascent: number;
  descent: number;
  apex: number;
}

/** Start times in ms: each flight begins a little after the one before it; its fall follows its rise. */
export function flightTiming(index: number): FlightTiming {
  const ascent = START_MS + index * STAGGER_MS;
  return { ascent, descent: ascent + DRAW_MS, apex: ascent + Math.round(DRAW_MS * 0.9) };
}
