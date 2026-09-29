import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleIndexAt } from '../analysis/lookup';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { frameAtTime, frameSeekTime } from '../video/frames';
import type { Point } from '../pose/types';
import { drawCalibration, drawOverlay, type CalibrationDraw, type OverlayOptions } from '../video/overlay';
import { Playhead, usePlayheadTime } from './playhead';

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2];

interface Props {
  url: string;
  fps: number;
  result: AnalysisResult | null;
  /** Skill labels drawn on the video (body position, rotation, predicted skill). */
  skills?: SkillAnalysis | null;
  overlay: OverlayOptions;
  playhead: Playhead;
  speed: number;
  onSpeed: (s: number) => void;
  onError: (message: string) => void;
  /** Trampoline outline to draw; while `editing`, clicks add corners and corners can be dragged. */
  calibration: CalibrationDraw | null;
  onCornersChange: (corners: Point[]) => void;
}

const PICK_RADIUS_PX = 16;

export function VideoPlayer({ url, fps, result, skills = null, overlay, playhead, speed, onSpeed, onError, calibration, onCornersChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(16 / 9);
  const [playing, setPlaying] = useState(false);

  // Latest props for the rAF loop (avoids restarting the loop on every change).
  const live = useRef({ result, skills, overlay, fps, calibration });
  live.current = { result, skills, overlay, fps, calibration };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  }, [result, skills, overlay, calibration]);
  /** A stretch of the video that is being played on request ("play this jump"). */
  const playing_ = useRef<{ from: number; to: number; loop: boolean } | null>(null);
  const dragging = useRef<number | null>(null);

  /** Pointer position in video pixels, or null before the video size is known. */
  const toVideoPoint = (e: React.PointerEvent<HTMLCanvasElement>): { p: Point; cssPerPx: number } | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      p: { x: ((e.clientX - rect.left) / rect.width) * v.videoWidth, y: ((e.clientY - rect.top) / rect.height) * v.videoHeight },
      cssPerPx: rect.width / v.videoWidth,
    };
  };

  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cal = live.current.calibration;
    const hit = toVideoPoint(e);
    if (!cal?.editing || !hit) return;
    let nearest = -1;
    let best = PICK_RADIUS_PX / hit.cssPerPx;
    cal.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - hit.p.x, c.y - hit.p.y);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest >= 0) {
      dragging.current = nearest;
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (cal.corners.length < 4) {
      onCornersChange([...cal.corners, hit.p]);
    }
  };
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cal = live.current.calibration;
    const hit = toVideoPoint(e);
    if (dragging.current === null || !cal || !hit) return;
    onCornersChange(cal.corners.map((c, i) => (i === dragging.current ? hit.p : c)));
  };

  const totalFrames = () => {
    const v = videoRef.current;
    return v && Number.isFinite(v.duration) ? Math.max(1, Math.floor(v.duration * fps)) : 1;
  };

  const seekFrame = useCallback(
    (k: number) => {
      const v = videoRef.current;
      if (!v) return;
      const frames = Math.max(1, Math.floor(v.duration * fps));
      const clamped = Math.min(Math.max(k, 0), frames - 1);
      v.currentTime = Math.min(frameSeekTime(clamped, fps), Math.max(0, v.duration - 1e-3));
    },
    [fps],
  );

  const step = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      seekFrame(frameAtTime(v.currentTime, fps) + delta);
    },
    [fps, seekFrame],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended || v.currentTime >= v.duration - 0.05) v.currentTime = 0;
      void v.play();
    } else v.pause();
  }, []);

  // Seek requests coming from the charts.
  useEffect(() => {
    playhead.seekHandler = (t) => seekFrame(frameAtTime(t, fps));
    return () => {
      playhead.seekHandler = null;
    };
  }, [playhead, fps, seekFrame]);

  useEffect(() => {
    playhead.playRangeHandler = (from, to, loop) => {
      const v = videoRef.current;
      if (!v) return;
      seekFrame(frameAtTime(from, fps));
      playing_.current = { from, to, loop };
      void v.play();
    };
    return () => {
      playhead.playRangeHandler = null;
    };
  }, [playhead, fps, seekFrame]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, url]);

  // Render loop: publish the playhead and redraw the overlay whenever the frame or options change.
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c) {
        playhead.setTime(v.currentTime);
        const range = playing_.current;
        if (range && !v.paused && v.currentTime >= range.to) {
          if (range.loop) seekFrame(frameAtTime(range.from, live.current.fps));
          else {
            playing_.current = null;
            v.pause();
          }
        }
        const { result: res, skills: sk, overlay: opts, fps: f, calibration: cal } = live.current;
        const rect = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
          dirty.current = true;
        }
        const key = `${v.currentTime}|${f}`;
        if (dirty.current || key !== lastKey) {
          lastKey = key;
          dirty.current = false;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (res) drawOverlay(ctx, rect.width, rect.height, res, sampleIndexAt(res.meta, v.currentTime), opts, sk);
            else ctx.clearRect(0, 0, rect.width, rect.height);
            if (cal && v.videoWidth) drawCalibration(ctx, rect.width, rect.height, v.videoWidth, v.videoHeight, cal);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playhead, seekFrame]);

  // Keyboard: space = play/pause, arrows = frame step (shift = 10 frames).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        step((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, step]);

  return (
    <div className="player">
      <div className="stage" style={{ aspectRatio: ratio, maxWidth: `calc(70vh * ${ratio})` }}>
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const { videoWidth: w, videoHeight: h } = e.currentTarget;
            if (w && h) setRatio(w / h);
            e.currentTarget.playbackRate = speed;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            playing_.current = null;
          }}
          onEnded={() => setPlaying(false)}
          onError={() => onError('This browser cannot play the video. Try an MP4 (H.264) file.')}
        />
        <canvas
          ref={canvasRef}
          className={calibration?.editing ? 'overlay editing' : 'overlay'}
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerUp={() => (dragging.current = null)}
          onPointerCancel={() => (dragging.current = null)}
        />
      </div>
      <Transport
        playhead={playhead}
        fps={fps}
        total={totalFrames}
        playing={playing}
        onToggle={togglePlay}
        onStep={step}
        onSeekFrame={seekFrame}
        speed={speed}
        onSpeed={onSpeed}
      />
    </div>
  );
}

interface TransportProps {
  playhead: Playhead;
  fps: number;
  total: () => number;
  playing: boolean;
  onToggle: () => void;
  onStep: (d: number) => void;
  onSeekFrame: (k: number) => void;
  speed: number;
  onSpeed: (s: number) => void;
}

function Transport({ playhead, fps, total, playing, onToggle, onStep, onSeekFrame, speed, onSpeed }: TransportProps) {
  const time = usePlayheadTime(playhead);
  const frame = frameAtTime(time, fps);
  const frames = total();
  return (
    <div className="transport">
      <button onClick={() => onStep(-10)} title="Back 10 frames (Shift+←)">« 10</button>
      <button onClick={() => onStep(-1)} title="Previous frame (←)">‹ frame</button>
      <button className="primary" onClick={onToggle} title="Play / pause (Space)">{playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button onClick={() => onStep(1)} title="Next frame (→)">frame ›</button>
      <button onClick={() => onStep(10)} title="Forward 10 frames (Shift+→)">10 »</button>
      <label className="inline">
        Speed
        <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </label>
      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(0, frames - 1)}
        step={1}
        value={Math.min(frame, frames - 1)}
        onChange={(e) => onSeekFrame(Number(e.target.value))}
        aria-label="Frame"
      />
      <span className="readout mono">
        {time.toFixed(3)} s · frame {frame + 1}/{frames}
      </span>
    </div>
  );
}
