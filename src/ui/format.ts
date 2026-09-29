/** Number and time formatting shared by every panel. A missing value is an en dash: never "NaN", never "-0.00". */

export const DASH = '–';

const missing = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v);

/** Fixed decimals. */
export function fmt(v: number | null | undefined, digits = 1): string {
  if (missing(v)) return DASH;
  const s = v.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s.replace('-', '−');
}

/** Fixed decimals with an explicit sign (a real minus sign, not a hyphen). */
export function signed(v: number | null | undefined, digits = 2): string {
  if (missing(v)) return DASH;
  const s = Math.abs(v).toFixed(digits);
  return Number(s) === 0 ? s : `${v < 0 ? '−' : '+'}${s}`;
}

/** A share between 0 and 1 as a percentage. */
export function pct(v: number | null | undefined, digits = 0): string {
  if (missing(v)) return DASH;
  return `${(Math.min(Math.max(v, 0), 1) * 100).toFixed(digits)}%`;
}

/** Seconds as m:ss.mmm, the way a video editor shows a position. */
export function timecode(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
