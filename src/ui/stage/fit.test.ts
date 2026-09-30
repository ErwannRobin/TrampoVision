import { describe, expect, it } from 'vitest';
import { clipOrientation, DEFAULT_RATIO, fitRatio, portraitStageWidth, splitLayout, type Box, type Size } from './fit';

const inside = (box: Box, outer: Size) =>
  box.x >= 0 && box.y >= 0 && box.x + box.width <= outer.width && box.y + box.height <= outer.height;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('fitRatio', () => {
  it('fits a portrait video by height and centers it in a wide box', () => {
    const box = fitRatio(9 / 16, { width: 1000, height: 640 });
    expect(box.height).toBe(640);
    expect(box.width).toBe(360);
    expect(box.x).toBe(320);
    expect(box.y).toBe(0);
  });

  it('fits a landscape video by width and centers it in a tall box', () => {
    const box = fitRatio(16 / 9, { width: 320, height: 500 });
    expect(box.width).toBe(320);
    expect(box.height).toBe(180);
    expect(box.x).toBe(0);
    expect(box.y).toBe(160);
  });

  it('fills a box that has exactly the video ratio', () => {
    expect(fitRatio(2, { width: 800, height: 400 })).toEqual({ x: 0, y: 0, width: 800, height: 400 });
  });

  it('keeps the ratio to within a pixel and never leaves the box', () => {
    for (const ratio of [9 / 16, 3 / 4, 1, 4 / 3, 16 / 9, 21 / 9]) {
      for (const size of [
        { width: 320, height: 260 },
        { width: 958.4, height: 579.6 },
        { width: 1440, height: 720 },
        { width: 390, height: 640 },
      ]) {
        const box = fitRatio(ratio, size);
        expect(inside(box, size)).toBe(true);
        expect(Math.abs(box.width / box.height - ratio)).toBeLessThan(0.02);
      }
    }
  });

  it('returns nothing for an empty box', () => {
    expect(fitRatio(16 / 9, { width: 0, height: 300 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(fitRatio(16 / 9, { width: 300, height: -4 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('lays out 16:9 until the ratio is known', () => {
    const size = { width: 800, height: 800 };
    expect(fitRatio(NaN, size)).toEqual(fitRatio(DEFAULT_RATIO, size));
    expect(fitRatio(0, size)).toEqual(fitRatio(DEFAULT_RATIO, size));
    expect(fitRatio(-1, size)).toEqual(fitRatio(DEFAULT_RATIO, size));
  });
});

describe('splitLayout', () => {
  it('puts a portrait video and the pane side by side in a wide viewport', () => {
    const outer = { width: 1000, height: 600 };
    const layout = splitLayout(outer, 9 / 16, 8);
    expect(layout.direction).toBe('row');
    expect(layout.video.x).toBe(0);
    expect(layout.video.width).toBe(337);
    expect(layout.pane.x).toBe(layout.video.width + 8);
    expect(layout.pane.x + layout.pane.width).toBe(outer.width);
    expect(layout.pane.height).toBe(outer.height);
  });

  it('caps a wide video at its share so the pane keeps room', () => {
    const outer = { width: 1000, height: 600 };
    const layout = splitLayout(outer, 16 / 9, 8);
    expect(layout.direction).toBe('row');
    expect(layout.video.width).toBe(595);
    expect(layout.pane.width).toBe(outer.width - 595 - 8);
    expect(layout.video.y).toBeGreaterThan(0);
  });

  it('stacks the two in a tall viewport', () => {
    const outer = { width: 400, height: 900 };
    const layout = splitLayout(outer, 16 / 9, 8);
    expect(layout.direction).toBe('column');
    expect(layout.video).toEqual({ x: 0, y: 0, width: 400, height: 225 });
    expect(layout.pane).toEqual({ x: 0, y: 233, width: 400, height: 667 });
  });

  it('centers a portrait video above the pane and caps its height', () => {
    const outer = { width: 400, height: 900 };
    const layout = splitLayout(outer, 9 / 16, 8);
    expect(layout.direction).toBe('column');
    expect(layout.video.height).toBe(535);
    expect(layout.video.x).toBeGreaterThan(0);
    expect(layout.pane.y).toBe(layout.video.height + 8);
    expect(layout.pane.y + layout.pane.height).toBe(outer.height);
  });

  it('keeps a near-square viewport side by side, with or without the height the browser toolbars take', () => {
    // An iPad in landscape: the same width in Safari and in the home-screen app, about 100px more height in the latter.
    for (const height of [664, 764]) {
      const layout = splitLayout({ width: 760, height }, 16 / 9, 12);
      expect(layout.direction).toBe('row');
      expect(layout.pane.width).toBeGreaterThanOrEqual(220);
    }
  });

  it('stacks when the pane beside the video would be too narrow to use, even in a viewport that is not tall', () => {
    expect(splitLayout({ width: 390, height: 450 }, 16 / 9, 12).direction).toBe('column');
    expect(splitLayout({ width: 500, height: 520 }, 16 / 9, 12).direction).toBe('column');
  });

  it('never overlaps the two and stays inside the viewport', () => {
    for (const ratio of [9 / 16, 1, 16 / 9, 21 / 9]) {
      for (const outer of [
        { width: 320, height: 260 },
        { width: 390, height: 640 },
        { width: 958, height: 580 },
        { width: 2000, height: 500 },
        { width: 700, height: 700 },
      ]) {
        const layout = splitLayout(outer, ratio, 8);
        expect(inside(layout.video, outer)).toBe(true);
        expect(inside(layout.pane, outer)).toBe(true);
        expect(overlaps(layout.video, layout.pane)).toBe(false);
        expect(layout.video.width).toBeGreaterThan(0);
        expect(layout.pane.width).toBeGreaterThan(0);
        expect(layout.pane.height).toBeGreaterThan(0);
      }
    }
  });

  it('returns empty boxes for an empty viewport', () => {
    const layout = splitLayout({ width: 0, height: 0 }, 16 / 9, 8);
    expect(layout.video.width).toBe(0);
    expect(layout.pane.width).toBe(0);
  });
});

describe('clipOrientation', () => {
  it('is portrait when the frames are taller than wide', () => {
    expect(clipOrientation({ width: 1080, height: 1920 })).toBe('portrait');
    expect(clipOrientation({ width: 720, height: 960 })).toBe('portrait');
    expect(clipOrientation({ width: 999, height: 1000 })).toBe('portrait');
  });

  it('is landscape when they are wider, or square', () => {
    expect(clipOrientation({ width: 1920, height: 1080 })).toBe('landscape');
    expect(clipOrientation({ width: 1000, height: 999 })).toBe('landscape');
    expect(clipOrientation({ width: 1080, height: 1080 })).toBe('landscape');
  });

  it('keeps the starting layout while the size is not known, or is not a size', () => {
    expect(clipOrientation(null)).toBe('landscape');
    expect(clipOrientation(undefined)).toBe('landscape');
    expect(clipOrientation({ width: 0, height: 0 })).toBe('landscape');
    expect(clipOrientation({ width: 0, height: 1920 })).toBe('landscape');
    expect(clipOrientation({ width: 1080, height: 0 })).toBe('landscape');
    expect(clipOrientation({ width: Number.NaN, height: 1920 })).toBe('landscape');
    expect(clipOrientation({ width: 1080, height: Number.POSITIVE_INFINITY })).toBe('portrait');
  });
});

describe('portraitStageWidth', () => {
  it('is the width of the video at the height of the stage', () => {
    expect(portraitStageWidth(9 / 16, 640)).toBe(360);
    expect(portraitStageWidth(3 / 4, 562)).toBe(422);
  });

  it('leaves no letterbox: the viewport of that size fits the video exactly', () => {
    for (const ratio of [9 / 16, 0.6, 3 / 4, 4 / 5, 0.98]) {
      for (const height of [392, 462, 562, 742, 1010]) {
        const width = portraitStageWidth(ratio, height);
        const box = fitRatio(ratio, { width, height });
        expect(box.width * box.height).toBeGreaterThanOrEqual(width * height * 0.99);
      }
    }
  });

  it('asks for nothing before the stage has a height, and ignores a ratio that is not one', () => {
    expect(portraitStageWidth(9 / 16, 0)).toBe(0);
    expect(portraitStageWidth(9 / 16, -5)).toBe(0);
    expect(portraitStageWidth(Number.NaN, 450)).toBe(Math.round(450 * DEFAULT_RATIO));
  });
});
