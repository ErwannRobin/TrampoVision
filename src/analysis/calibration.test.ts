import { describe, expect, it } from 'vitest';
import type { Point } from '../pose/types';
import { buildCalibration, type Quad } from './calibration';

/** Pinhole camera looking along +Z (yawed/pitched optionally), world: X right, Y up, Z away from camera. */
function camera(opts: { pos?: [number, number, number]; pitchDeg?: number; f?: number; cx?: number; cy?: number } = {}) {
  const [px, py, pz] = opts.pos ?? [0, 1.5, 0];
  const p = ((opts.pitchDeg ?? 0) * Math.PI) / 180;
  const f = opts.f ?? 1200;
  const cx = opts.cx ?? 640;
  const cy = opts.cy ?? 360;
  return (X: number, Y: number, Z: number): Point => {
    const dx = X - px;
    const dy = Y - py;
    const dz = Z - pz;
    const xc = dx;
    const yc = Math.cos(p) * dy + Math.sin(p) * dz;
    const zc = -Math.sin(p) * dy + Math.cos(p) * dz;
    return { x: cx + (f * xc) / zc, y: cy - (f * yc) / zc };
  };
}

/** Bed on the ground (Y = 0), centered at (0, Zc), rotated by `yawDeg` about its center. c0→c1 is the long side. */
function bedCorners(project: (X: number, Y: number, Z: number) => Point, Zc = 10, yawDeg = 0, long = 4.28, short = 2.14): Quad {
  const t = (yawDeg * Math.PI) / 180;
  const local: [number, number][] = [
    [-long / 2, -short / 2],
    [long / 2, -short / 2],
    [long / 2, short / 2],
    [-long / 2, short / 2],
  ];
  const pts = local.map(([u, v]) => project(u * Math.cos(t) - v * Math.sin(t), 0, Zc + u * Math.sin(t) + v * Math.cos(t)));
  return pts as Quad;
}

const cal = (corners: Quad) => ({ corners, firstSideM: 4.28, secondSideM: 2.14 });
const build = (corners: Quad) => {
  const r = buildCalibration(cal(corners));
  if (!r.ok) throw new Error(r.error);
  return r.model;
};

describe('trampoline calibration', () => {
  it('recovers scale, center and athlete position for a level camera looking at a long side', () => {
    const cam = camera();
    const m = build(bedCorners(cam));
    expect(m.metersPerPixel).toBeCloseTo(10 / 1200, 4);
    expect(m.viewAngleDeg).toBeCloseTo(0, 1);
    expect(m.halfExtentM).toBeCloseTo(2.14, 2);
    const c = cam(0, 0, 10);
    expect(m.center.x).toBeCloseTo(c.x, 1);
    expect(m.center.y).toBeCloseTo(c.y, 1);

    // Athlete center of mass 1.0 m right of the bed center and 3.0 m above the bed, over the bed's depth.
    const n = m.normalize(cam(1.0, 3.0, 10));
    expect(n.xM).toBeCloseTo(1.0, 2);
    expect(n.heightM).toBeCloseTo(3.0, 2);
    expect(n.xNorm).toBeCloseTo(1.0 / 2.14, 2);
  });

  it('the athlete is in the air: mapping it through the plane homography would be wildly wrong', () => {
    const cam = camera();
    const m = build(bedCorners(cam));
    const viaHomography = m.toBed(cam(1.0, 3.0, 10));
    // (documents why normalize() does not use it)
    expect(Math.abs(viaHomography.x - 2.14)).toBeGreaterThan(0.5);
  });

  it('measures the direction along the second side when the camera looks along the bed', () => {
    const cam = camera();
    // Bed turned 90 degrees: the camera now sees the short side face-on.
    const m = build(bedCorners(cam, 10, 90));
    expect(m.viewAngleDeg).toBeCloseTo(90, 0);
    expect(m.halfExtentM).toBeCloseTo(1.07, 2);
    expect(m.normalize(cam(0.5, 2, 10)).xNorm).toBeCloseTo(0.5 / 1.07, 2);
  });

  it('handles a bed that is turned by 30 degrees relative to the camera', () => {
    const cam = camera();
    const m = build(bedCorners(cam, 10, 30));
    expect(m.viewAngleDeg).toBeCloseTo(30, 0);
    expect(m.halfExtentM).toBeCloseTo(Math.min(2.14 / Math.cos(Math.PI / 6), 1.07 / Math.sin(Math.PI / 6)), 2);
    expect(m.normalize(cam(-1.2, 1, 10)).xM).toBeCloseTo(-1.2, 1);
  });

  it('is off by roughly the depth ratio when the athlete is not over the bed center (known limit)', () => {
    const cam = camera();
    const m = build(bedCorners(cam));
    const closer = m.normalize(cam(1.0, 2, 9)).xM; // 1 m closer to the camera
    expect(closer / 1.0).toBeCloseTo(10 / 9, 2);
  });

  it('a camera tilted down 8 degrees adds only a small error at 2 m height (known limit)', () => {
    const cam = camera({ pitchDeg: 8, pos: [0, 3, 0] });
    const m = build(bedCorners(cam));
    const n = m.normalize(cam(1.0, 2.0, 10));
    expect(Math.abs(n.xM - 1.0)).toBeLessThan(0.1);
    expect(Math.abs(n.heightM - 2.0)).toBeLessThan(0.25);
  });

  it('documents how the error grows with a steeper camera tilt (README numbers)', () => {
    // Camera raised so it still sees the bed, tilted down 15 and 25 degrees; athlete 5 m above the bed.
    for (const [pitch, camH, maxX, maxH] of [[15, 5, 0.16, 0.3], [25, 8, 0.26, 0.5]] as const) {
      const cam = camera({ pitchDeg: pitch, pos: [0, camH, 0] });
      const m = build(bedCorners(cam));
      const n = m.normalize(cam(1.0, 5.0, 10));
      expect(Math.abs(n.xM - 1.0)).toBeLessThan(maxX);
      expect(Math.abs(n.heightM - 5.0)).toBeLessThan(maxH);
    }
  });

  it('tolerates a couple of pixels of error when clicking the corners', () => {
    const cam = camera();
    const clean = bedCorners(cam);
    const wobble: [number, number][] = [[2, -1.5], [-2, 1], [1.5, 2], [-1, -2]];
    const noisy = clean.map((p, i) => ({ x: p.x + wobble[i][0], y: p.y + wobble[i][1] })) as Quad;
    const m = build(noisy);
    expect(Math.abs(m.metersPerPixel / (10 / 1200) - 1)).toBeLessThan(0.03);
  });

  it('accepts corners clicked in either direction and from any starting corner', () => {
    const cam = camera();
    const c = bedCorners(cam);
    const reversed = [c[0], c[3], c[2], c[1]] as Quad; // then side 1→2 is the short side
    const r = buildCalibration({ corners: reversed, firstSideM: 2.14, secondSideM: 4.28 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model.metersPerPixel).toBeCloseTo(10 / 1200, 4);
  });

  it('rejects crossed, degenerate or tiny outlines', () => {
    const c = bedCorners(camera());
    expect(buildCalibration(cal([c[0], c[2], c[1], c[3]] as Quad)).ok).toBe(false); // bow-tie
    expect(buildCalibration(cal([c[0], c[0], c[0], c[0]] as Quad)).ok).toBe(false);
    const tiny = c.map((p) => ({ x: 100 + (p.x - c[0].x) * 0.02, y: 100 + (p.y - c[0].y) * 0.02 })) as Quad;
    expect(buildCalibration(cal(tiny)).ok).toBe(false);
    expect(buildCalibration({ corners: c, firstSideM: 0, secondSideM: 2 }).ok).toBe(false);
  });
});
