import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { demoStraddleJump } from '../pose3d/demoJump';
import { drawPose3D, type View } from '../pose3d/draw';
import { useElementSize, useReducedMotion } from './hooks';
import { pose3dColors, useThemeVersion } from './theme';

/** Where the figure turns to and fro, degrees of yaw: from the side to the front, so the legs of a straddle show. */
const YAW_CENTER = 50;
const YAW_SWING = 40;
const PITCH = 8;

/**
 * The 3D skeleton doing a straddle jump, drawn by the same code as the 3D view of an analysis. It loops on its own, turns slowly
 * so the depth shows, and can be dragged to look from another side. With reduced motion it holds the moment the legs are open.
 */
export function DemoSkeleton() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const reduced = useReducedMotion();
  const theme = useThemeVersion();
  // Yaw offset from dragging; while it is held the automatic turn pauses.
  const [grab, setGrab] = useState<{ yaw: number; pitch: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // The loop's clock outlives the effect, so restarting it for a drag does not restart the jump.
  const clock = useRef(performance.now());

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
        // Room for the arms overhead at the top of the jump and the feet on the bed.
        zoom: 0.8,
        originY: 0.61,
      });
    };
    if (reduced) {
      paint(demo.apex, grab ?? { yaw: YAW_CENTER, pitch: PITCH });
      return;
    }
    let raf = 0;
    const frame = (now: number) => {
      const s = (now - clock.current) / 1000;
      const i = Math.floor(s * demo.fps) % demo.world.length;
      const view = grab ?? { yaw: YAW_CENTER + YAW_SWING * Math.sin(s * 0.6), pitch: PITCH };
      paint(i, view);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, reduced, theme, grab]);

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
        aria-label="A 3D skeleton doing a straddle jump. Drag to turn it."
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
          setGrab((g) => g ?? { yaw: YAW_CENTER, pitch: PITCH });
        }}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
          setGrab(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setGrab(null);
        }}
      />
      <p className="demo3d__caption">Straddle jump · drag to turn</p>
    </div>
  );
}
