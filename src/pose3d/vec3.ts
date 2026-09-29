/** Minimal 3D vector helpers. Vectors are plain triples so they can be stored, compared and serialized as they are. */
export type Vec3 = [number, number, number];

export const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Unit vector; NaN triple when the input has (almost) no length. */
export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : [NaN, NaN, NaN];
}

export const finite3 = (a: Vec3): boolean => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

/** `a` with its component along the unit vector `axis` removed. */
export const perpendicular = (a: Vec3, axis: Vec3): Vec3 => sub(a, scale(axis, dot(a, axis)));

/** Signed angle from `a` to `b` in degrees, positive counter-clockwise seen from the tip of the unit vector `axis` (right-hand rule). Both inputs must be perpendicular to `axis`. */
export const signedAngleDeg = (a: Vec3, b: Vec3, axis: Vec3): number =>
  (Math.atan2(dot(axis, cross(a, b)), dot(a, b)) * 180) / Math.PI;

/** Rotates `v` about the unit vector `axis` by `deg` (right-hand rule). */
export function rotateAbout(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

/**
 * Carries `v` along with the axis when it turns from `from` to `to` by the smallest possible rotation
 * (rotation-minimizing transport). What is left when the result is compared with the real vector is the spin about the axis.
 */
export function transport(v: Vec3, from: Vec3, to: Vec3): Vec3 | null {
  const c = dot(from, to);
  if (c < -0.99) return null; // the axis flipped over in one step: no meaningful smallest rotation
  const w = cross(from, to);
  const k = 1 / (1 + c);
  const a = cross(w, v);
  const b = cross(w, a);
  return [v[0] + a[0] + k * b[0], v[1] + a[1] + k * b[1], v[2] + a[2] + k * b[2]];
}
