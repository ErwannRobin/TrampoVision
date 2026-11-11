import { solveLinearSystem } from './signal';

/**
 * A body in the air is in free fall whatever it does with its arms and legs: its center of mass follows a parabola from the
 * takeoff to the landing. So where the pose model lost the athlete in the middle of a flight (upside down, folded, blurred), the
 * center of mass is still known: it is on the parabola through the frames seen before and after.
 *
 * Landmarks are only bridged across short gaps (see stabilize.ts): a joint's own path cannot be made up for long. The center of
 * mass can, and it is what the jump detection reads: with a hole at the top of a flight the apex is not found and the jump is lost.
 */

export interface FlightBridgeOptions {
  /** Longest gap bridged, seconds: a little less than the longest flight. */
  maxGapS: number;
  /** Valid samples used on each side of the gap, at most, and at least. */
  sideSamples: number;
  minSideSamples: number;
  /** The fitted downward acceleration must be within these shares of the expected one (the scale is only roughly known). */
  minGravityRatio: number;
  maxGravityRatio: number;
  /** The samples on both sides must lie this close to the parabola, as a share of the body length (root mean square). */
  maxResidual: number;
}

export const DEFAULT_FLIGHT_BRIDGE_OPTIONS: FlightBridgeOptions = {
  maxGapS: 1.6,
  sideSamples: 5,
  minSideSamples: 3,
  minGravityRatio: 0.4,
  maxGravityRatio: 2.5,
  maxResidual: 0.08,
};

export interface FlightBridge {
  x: Float64Array;
  y: Float64Array;
  /** 1 where the position was put on the parabola (it was not measured). */
  bridged: Uint8Array;
  /** Gaps bridged. */
  gaps: number;
}

export interface FlightBridgeInput {
  /** Center of mass, image pixels (y down), NaN where unknown. */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  fps: number;
  /** Gravity in the picture, pixels per second squared (g times the pixels per meter at the athlete). NaN: nothing is bridged. */
  gravityPx: number;
  /** The athlete's length in pixels, the yardstick of the fit. */
  bodyLengthPx: number;
}

/** Least-squares y = c0 + c1 u + c2 u² (or a line when `order` is 1). */
function polyFit(us: number[], ys: number[], order: 1 | 2): number[] | null {
  const m = order + 1;
  const A = new Array<number>(m * m).fill(0);
  const b = new Array<number>(m).fill(0);
  for (let k = 0; k < us.length; k++) {
    const pw = [1, us[k], us[k] ** 2, us[k] ** 3, us[k] ** 4];
    for (let r = 0; r < m; r++) {
      b[r] += pw[r] * ys[k];
      for (let c = 0; c < m; c++) A[r * m + c] += pw[r + c];
    }
  }
  return solveLinearSystem(A, b, m);
}

/**
 * Fills the gaps of the center of mass that lie inside one flight. A gap is inside a flight when the samples around it are in free
 * fall together: one parabola goes through both sides, it opens downward in the world (upward in image y), and its acceleration is
 * gravity, as far as the scale tells. A gap over a bed contact fails all three (the path bends the other way there), and so does a
 * gap while the athlete stands (no acceleration), so nothing is made up on the bed.
 */
export function bridgeFlightGaps(input: FlightBridgeInput, options: Partial<FlightBridgeOptions> = {}): FlightBridge {
  const o = { ...DEFAULT_FLIGHT_BRIDGE_OPTIONS, ...options };
  const { fps, gravityPx, bodyLengthPx } = input;
  const x = Float64Array.from(input.x);
  const y = Float64Array.from(input.y);
  const n = y.length;
  const bridged = new Uint8Array(n);
  let gaps = 0;
  if (!(gravityPx > 0) || !(bodyLengthPx > 0)) return { x, y, bridged, gaps };
  const maxGap = Math.round(o.maxGapS * fps);
  const valid = (i: number) => Number.isFinite(input.x[i]) && Number.isFinite(input.y[i]);

  let i = 0;
  while (i < n) {
    if (valid(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !valid(j)) j++;
    const gap = j - i;
    if (i > 0 && j < n && gap <= maxGap) {
      // The samples on both sides, as they were measured (never an earlier bridge), with u = 0 at the first missing sample.
      const us: number[] = [];
      const ys: number[] = [];
      const xs: number[] = [];
      for (let k = i - 1; k >= 0 && us.length < o.sideSamples && valid(k); k--) {
        us.push(k - i);
        ys.push(input.y[k]);
        xs.push(input.x[k]);
      }
      const left = us.length;
      for (let k = j; k < n && us.length < left + o.sideSamples && valid(k); k++) {
        us.push(k - i);
        ys.push(input.y[k]);
        xs.push(input.x[k]);
      }
      const right = us.length - left;
      const c = left >= o.minSideSamples && right >= o.minSideSamples ? polyFit(us, ys, 2) : null;
      const line = c ? polyFit(us, xs, 1) : null;
      if (c && line) {
        const ratio = (2 * c[2] * fps * fps) / gravityPx;
        let sse = 0;
        for (let k = 0; k < us.length; k++) sse += (ys[k] - (c[0] + c[1] * us[k] + c[2] * us[k] * us[k])) ** 2;
        const rms = Math.sqrt(sse / us.length);
        if (ratio >= o.minGravityRatio && ratio <= o.maxGravityRatio && rms <= o.maxResidual * bodyLengthPx) {
          // The parabola, nudged so that it meets the last sample before the gap and the first one after it.
          const curve = (u: number) => c[0] + c[1] * u + c[2] * u * u;
          const drift = (u: number) => line[0] + line[1] * u;
          const offA = { x: input.x[i - 1] - drift(-1), y: input.y[i - 1] - curve(-1) };
          const offB = { x: input.x[j] - drift(gap), y: input.y[j] - curve(gap) };
          for (let k = i; k < j; k++) {
            const f = (k - i + 1) / (gap + 1);
            x[k] = drift(k - i) + offA.x + (offB.x - offA.x) * f;
            y[k] = curve(k - i) + offA.y + (offB.y - offA.y) * f;
            bridged[k] = 1;
          }
          gaps++;
        }
      }
    }
    i = j;
  }
  return { x, y, bridged, gaps };
}
