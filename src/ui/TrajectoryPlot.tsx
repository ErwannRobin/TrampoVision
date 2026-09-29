import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react';
import type { CalibrationModel } from '../analysis/calibration';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import { drawPathLive, drawPathStill, type PathData } from './charts/drawPath';
import { fitCanvas, readColors, type ChartColors } from './charts/draw';
import { layoutTrajectory, nearestSample, pathDirections, pathPixels, trajectoryExtent } from './charts/trajectory';
import { useElementSize } from './hooks';
import type { Playhead } from './playhead';
import { useThemeVersion } from './theme';

interface Props {
  result: AnalysisResult;
  playhead: Playhead;
  /** Trampoline calibration, to draw the bed under the path. */
  calibration?: CalibrationModel | null;
  height?: number;
}

/** How close (px) a press must be to the path to pick a moment on it. */
const PICK_RADIUS = 28;

/**
 * The center of mass in the image plane: horizontal offset against height, with the same scale on both axes. Rising
 * is blue, falling is orange; press on the path to move the video to that moment.
 */
export function TrajectoryPlot({ result, playhead, calibration = null, height = 340 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stillRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const { width } = useElementSize(wrapRef);
  const theme = useThemeVersion();
  const { meta } = result;

  // Half of the bed along the on-screen horizontal, in the meters used for x (only when calibrated).
  const bedHalf = calibration ? calibration.halfExtentM / calibration.metersPerPixel / meta.pixelsPerMeter : NaN;
  const extent = useMemo(
    () => trajectoryExtent(result.x, result.height, meta.count, bedHalf),
    [result.x, result.height, meta.count, bedHalf],
  );
  const layout = useMemo(
    () => (extent && width > 0 ? layoutTrajectory(extent, width, height) : null),
    [extent, width, height],
  );
  const path = useMemo<PathData | null>(() => {
    if (!layout) return null;
    const { xs, ys } = pathPixels(layout, result.x, result.height, meta.count);
    return { count: meta.count, xs, ys, dir: pathDirections(result.jumps.phase, result.vy, meta.count) };
  }, [layout, result.x, result.height, result.jumps.phase, result.vy, meta.count]);
  const colors = useMemo<ChartColors>(
    () => readColors([]),
    // A new theme means new colors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );

  useEffect(() => {
    const canvas = stillRef.current;
    if (!canvas || width === 0) return;
    const ctx = fitCanvas(canvas, width, height);
    if (ctx && layout && path) drawPathStill(ctx, layout, path, result.jumps.cycles, bedHalf, colors);
  }, [layout, path, result.jumps.cycles, bedHalf, colors, width, height]);

  const paintLive = useCallback(() => {
    const canvas = liveRef.current;
    if (!canvas || width === 0) return;
    const ctx = fitCanvas(canvas, width, height);
    if (ctx && path) drawPathLive(ctx, path, sampleIndexAt(meta, playhead.getSnapshot()), colors);
  }, [path, colors, width, height, meta, playhead]);

  useEffect(() => {
    paintLive();
    return playhead.subscribe(paintLive);
  }, [paintLive, playhead]);

  const pick = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!path) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = nearestSample(path.xs, path.ys, path.count, e.clientX - rect.left, e.clientY - rect.top, PICK_RADIUS);
    if (i >= 0) playhead.seek(result.time[i]);
  };

  return (
    <figure className="chart chart--path">
      <figcaption className="chart__head">
        <span className="chart__title">
          Center of mass path
          <span className="chart__unit">m, x from {meta.calibrated ? 'bed center' : 'start'} against height</span>
        </span>
      </figcaption>
      <div ref={wrapRef} className="chart__body" style={{ height }}>
        {extent ? (
          <>
            <canvas ref={stillRef} className="chart__canvas" style={{ width, height }} aria-hidden="true" />
            <canvas
              ref={liveRef}
              className="chart__canvas chart__cursor"
              style={{ width, height }}
              role="img"
              aria-label="Center of mass path: press on the path to move the video to that moment"
              onPointerDown={pick}
            />
          </>
        ) : (
          <p className="chart__empty">No path: the scale could not be estimated.</p>
        )}
      </div>
    </figure>
  );
}
