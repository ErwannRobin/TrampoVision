import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { demoStraddleJump } from '../pose3d/demoJump';
import { drawPose3D, type View } from '../pose3d/draw';
import { useElementSize } from './hooks';
import { pose3dColors, useThemeVersion } from './theme';

/** Where the figure turns to and fro, degrees of yaw: from the side to the front, so the legs of a straddle show. */
const YAW_CENTER = 75;
const PITCH = 8;

/**
 * A 3D skeleton caught at the top of a straddle jump, drawn by the same code as the 3D view of an analysis. It holds still and
 * can be dragged to look from another side; it stays where it was left.
 */
export function DemoSkeleton() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const theme = useThemeVersion();
  // The view after dragging; null until then.
  const [grab, setGrab] = useState<{ yaw: number; pitch: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { width, height } = size;
    if (!canvas || width < 2 || height < 2) return;
    const demo = demoStraddleJump();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const colors = pose3dColors();
    const paint = (i: number, view: View) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawPose3D(ctx, width, height, {
        world: demo.world[i],
        twist: demo.twist,
        takeoff: demo.takeoff,
        i,
        view,
        colors,
        minimal: true,
        zoom: 1.2,
        originY: 0.74,
      });
    };
    paint(demo.apex, grab ?? { yaw: YAW_CENTER, pitch: PITCH });
  }, [size, theme, grab]);

  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setGrab((g) => {
      const from = g ?? { yaw: YAW_CENTER, pitch: PITCH };
      return { yaw: from.yaw + dx * 0.5, pitch: Math.max(-90, Math.min(90, from.pitch + dy * 0.5)) };
    });
  };

  return (
    <div className="demo3d" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="demo3d__canvas"
        style={{ width: size.width, height: size.height }}
        role="img"
        aria-label="A 3D skeleton in a straddle jump. Drag to turn it."
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
    </div>
  );
}
