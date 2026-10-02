import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, NO_ZOOM, isZoomed, overlayScale, pinchView, zoomAt } from './zoom';

const SIZE = { width: 400, height: 200 };
const CENTER = { x: 0, y: 0 };

describe('pinchView', () => {
  it('enlarges around the point the fingers are on', () => {
    const v = pinchView(NO_ZOOM, { x: 50, y: 20 }, { x: 50, y: 20 }, 2, SIZE);
    expect(v.zoom).toBe(2);
    // The point of the picture that was at (50, 20) is still at (50, 20): 2 * 50 + x = 50.
    expect(2 * 50 + v.x).toBeCloseTo(50);
    expect(2 * 20 + v.y).toBeCloseTo(20);
  });

  it('moves the picture with the fingers', () => {
    const v = pinchView({ zoom: 2, x: 0, y: 0 }, CENTER, { x: 30, y: -10 }, 1, SIZE);
    expect(v).toEqual({ zoom: 2, x: 30, y: -10 });
  });

  it('never shows past the edge of the picture', () => {
    const v = pinchView(NO_ZOOM, CENTER, { x: 1000, y: -1000 }, 2, SIZE);
    // Twice as big: it can move by half the frame each way.
    expect(v).toEqual({ zoom: 2, x: 200, y: -100 });
  });

  it('keeps the zoom between the whole picture and the most', () => {
    expect(pinchView(NO_ZOOM, CENTER, CENTER, 50, SIZE).zoom).toBe(MAX_ZOOM);
    expect(pinchView({ zoom: 2, x: 40, y: 10 }, CENTER, CENTER, 0.1, SIZE)).toEqual(NO_ZOOM);
  });

  it('copes with a scale that is not a number', () => {
    expect(pinchView({ zoom: 2, x: 0, y: 0 }, CENTER, CENTER, NaN, SIZE).zoom).toBe(2);
    expect(pinchView({ zoom: 2, x: 0, y: 0 }, CENTER, CENTER, 0, SIZE).zoom).toBe(2);
  });

  it('has nothing to move before the frame has a size', () => {
    expect(pinchView(NO_ZOOM, CENTER, { x: 50, y: 50 }, 2, { width: 0, height: 0 })).toEqual({ zoom: 2, x: 0, y: 0 });
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor where it is', () => {
    const at = { x: -80, y: 30 };
    const v = zoomAt({ zoom: 1.5, x: 10, y: -5 }, 1.2, at, SIZE);
    expect(v.zoom).toBeCloseTo(1.8);
    const u = { x: (at.x - 10) / 1.5, y: (at.y + 5) / 1.5 };
    expect(v.zoom * u.x + v.x).toBeCloseTo(at.x);
    expect(v.zoom * u.y + v.y).toBeCloseTo(at.y);
  });

  it('comes back to the whole picture', () => {
    expect(zoomAt({ zoom: 2, x: 30, y: 10 }, 0.4, CENTER, SIZE)).toEqual(NO_ZOOM);
  });
});

describe('isZoomed', () => {
  it('tells the whole picture from an enlarged one', () => {
    expect(isZoomed(NO_ZOOM)).toBe(false);
    expect(isZoomed({ zoom: 1.2, x: 0, y: 0 })).toBe(true);
  });
});

describe('overlayScale', () => {
  it('is the pixel ratio, times the zoom', () => {
    expect(overlayScale(2, 1)).toBe(2);
    expect(overlayScale(1, 3)).toBe(3);
  });

  it('stays within what a phone can draw', () => {
    expect(overlayScale(3, 5)).toBe(4);
  });

  it('never goes below one', () => {
    expect(overlayScale(0, 0)).toBe(1);
  });
});
