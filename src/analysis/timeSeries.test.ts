import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT } from '../pose/landmarks';
import { computeAnalysis } from './computeAnalysis';
import { addNoise, syntheticRoutine } from './testTracks';
import { buildFeatureMatrix, buildPoseSeries, parsePoseSeries, SERIES_SCHEMA, toSeriesJson } from './timeSeries';
import type { TrampolineCalibration } from './calibration';

const calibration: TrampolineCalibration = {
  corners: [{ x: 106, y: 640 }, { x: 534, y: 640 }, { x: 534, y: 560 }, { x: 106, y: 560 }],
  firstSideM: 4.28,
  secondSideM: 2.14,
};
const info = (cal: TrampolineCalibration | null = null) => ({ fileName: 'clip.mp4', stride: 1, minVisibility: 0.4, calibration: cal });

describe('frame-by-frame store', () => {
  const { track } = syntheticRoutine({ jumps: [{ v0: 4.5, turns: 2, driftM: 0.5 }, { v0: 4.5 }] });
  const noisy = addNoise(track, 1);
  noisy.frames[12] = null;
  const result = computeAnalysis(noisy, { calibration });
  const series = buildPoseSeries(result, noisy, info(calibration));

  it('holds one complete record per frame: timestamp, all joints with scores, COM, orientation, phase', () => {
    expect(series.frames).toHaveLength(result.meta.count);
    const f = series.frames[30];
    expect(f.t).toBeCloseTo(30 / 30, 3);
    expect(f.frame).toBe(30);
    expect(f.joints).toHaveLength(LANDMARK_COUNT);
    for (const [x, y, score, state] of f.joints!) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect([0, 1, 2, 3]).toContain(state);
    }
    expect(f.com).not.toBeNull();
    expect(f.com!.heightM).toBeGreaterThan(0);
    expect(f.orientation).not.toBeNull();
    expect(typeof f.phase).toBe('string');
    expect(series.landmarkNames).toHaveLength(LANDMARK_COUNT);
    expect(series.stateCodes).toEqual(['missing', 'measured', 'interpolated', 'corrected']);
  });

  it('marks the dropout as not detected but still provides a (bridged) skeleton', () => {
    const f = series.frames[12];
    expect(f.detected).toBe(false);
    expect(f.joints).not.toBeNull();
    expect(f.joints!.every((j) => j[3] === 2)).toBe(true); // interpolated
    expect(f.confidence).toBe(0);
  });

  it('stores orientation both wrapped and continuous', () => {
    const wrapped = series.frames.map((f) => f.orientation!.wrappedDeg);
    const unwrapped = series.frames.map((f) => f.orientation!.unwrappedDeg);
    expect(Math.max(...wrapped)).toBeLessThanOrEqual(180);
    expect(Math.min(...wrapped)).toBeGreaterThan(-180.01);
    expect(Math.max(...unwrapped) - Math.min(...unwrapped)).toBeGreaterThan(650);
  });

  it('carries the jump cycles and normalized (bed) coordinates', () => {
    expect(series.jumps).toHaveLength(2);
    expect(series.calibration).toEqual(calibration);
    expect(series.scale.heightReference).toBe('bed');
    expect(series.frames.some((f) => f.com!.xNorm !== null)).toBe(true);
    expect(series.frames.some((f) => f.jump === 0 && f.phase === 'descent')).toBe(true);
  });

  it('round-trips through JSON so the analysis can be re-run identically', () => {
    const parsed = parsePoseSeries(toSeriesJson(series));
    expect(parsed.calibration).toEqual(calibration);
    expect(parsed.track.frames).toHaveLength(noisy.frames.length);
    expect(parsed.track.frames[12]).toBeNull();
    expect(Math.abs(parsed.track.frames[40]![23].x - noisy.frames[40]![23].x)).toBeLessThan(0.01);
    const again = computeAnalysis(parsed.track, { calibration: parsed.calibration, athleteHeightM: parsed.settings.athleteHeightM });
    expect(again.jumps.cycles).toHaveLength(result.jumps.cycles.length);
    again.jumps.cycles.forEach((c, k) => {
      expect(c.flightTimeS!).toBeCloseTo(result.jumps.cycles[k].flightTimeS!, 1);
      expect(c.quarterTurns).toBe(result.jumps.cycles[k].quarterTurns);
    });
  });

  it('rejects files that are not a pose series', () => {
    expect(() => parsePoseSeries('not json')).toThrow(/JSON/);
    expect(() => parsePoseSeries('{"schema":"other"}')).toThrow(/not a TrampoVision/);
    expect(() => parsePoseSeries(JSON.stringify({ schema: SERIES_SCHEMA, version: 99 }))).toThrow(/version/);
    expect(() => parsePoseSeries(JSON.stringify({ schema: SERIES_SCHEMA, version: 1, source: {}, frames: [], raw: [] }))).toThrow(/no frame data/);
    const bad = JSON.parse(toSeriesJson(series));
    bad.raw[3] = [[1, 2, 3]];
    expect(() => parsePoseSeries(JSON.stringify(bad))).toThrow(/33 landmarks/);
  });
});

describe('feature matrix for a future temporal model', () => {
  const { track } = syntheticRoutine({ jumps: [{ v0: 4.5, turns: 1 }] });
  track.frames[20] = null;
  for (let i = 30; i < 45; i++) track.frames[i] = null; // long dropout
  const result = computeAnalysis(track);
  const fm = buildFeatureMatrix(result);

  it('has a fixed number of named columns and one row per frame', () => {
    expect(fm.frames).toBe(result.meta.count);
    expect(fm.names).toHaveLength(fm.features);
    expect(fm.data).toHaveLength(fm.frames * fm.features);
    expect(new Set(fm.names).size).toBe(fm.names.length);
    expect(fm.names).toContain('left_wrist_dx');
    expect(fm.names).toContain('orient_turns');
  });

  it('flags frames without a usable skeleton in the mask', () => {
    expect(fm.mask[5]).toBe(1);
    expect(fm.mask[38]).toBe(0);
    expect(Array.from(fm.data.slice(38 * fm.features, 39 * fm.features)).every(Number.isFinite)).toBe(true);
  });

  it('describes pose shape independently of where the athlete is in the image', () => {
    const shifted = { ...track, frames: track.frames.map((f) => f && f.map((p) => ({ ...p, x: p.x + 57, y: p.y - 31 }))) };
    const fm2 = buildFeatureMatrix(computeAnalysis(shifted));
    const shapeCols = 2 * LANDMARK_COUNT;
    for (const i of [3, 20, 60]) {
      for (let c = 0; c < shapeCols; c++) expect(fm2.data[i * fm.features + c]).toBeCloseTo(fm.data[i * fm.features + c], 3);
    }
  });
});

describe('3D landmarks and the video id in the stored series', () => {
  const { track } = syntheticRoutine({ jumps: [{ v0: 4.5 }] });
  const world = track.frames.map((f, i) =>
    f && i !== 5 ? f.map((_, k) => ({ x: k / 100, y: -k / 50, z: 0.123456789 + i, visibility: 0.9 })) : null,
  );
  const withWorld = { ...track, world };
  const result = computeAnalysis(withWorld);

  it('round-trips the raw 3D landmarks (rounded to 0.1 mm) and the video id', () => {
    const text = toSeriesJson(buildPoseSeries(result, withWorld, { ...info(), videoId: 'v-abc123' }));
    const parsed = parsePoseSeries(text);
    expect(parsed.source.videoId).toBe('v-abc123');
    expect(parsed.track.world).toHaveLength(track.frames.length);
    expect(parsed.track.world![5]).toBeNull();
    expect(parsed.track.world![10]![7].z).toBeCloseTo(10.1235, 4);
    expect(parsed.track.world![10]![7].visibility).toBeCloseTo(0.9, 3);
  });

  it('still opens a file saved before 3D support: no world, no video id', () => {
    const text = toSeriesJson(buildPoseSeries(computeAnalysis(track), track, info()));
    expect(text).not.toContain('rawWorld');
    const parsed = parsePoseSeries(text);
    expect(parsed.track.world).toBeUndefined();
    expect(parsed.source.videoId).toBeUndefined();
  });

  it('refuses a 3D frame with the wrong number of landmarks', () => {
    const data = JSON.parse(toSeriesJson(buildPoseSeries(result, withWorld, info())));
    data.rawWorld[10] = data.rawWorld[10].slice(0, 5);
    expect(() => parsePoseSeries(JSON.stringify(data))).toThrow(/3D frame/);
  });
});
