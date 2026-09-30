import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { sampleIndexAt } from '../../analysis/lookup';
import { t } from '../../i18n';
import type { AnalysisResult } from '../../analysis/types';
import type { Point } from '../../pose/types';
import type { SkillAnalysis } from '../../skills/analyzeSkills';
import { drawCalibration, drawOverlay, type CalibrationDraw, type OverlayOptions } from '../../video/overlay';
import { useElementSize } from '../hooks';
import { Icon, Segmented } from '../kit';
import type { Playhead } from '../playhead';
import type { StageView } from '../types';
import { DEFAULT_RATIO, fitRatio, splitLayout, type Box } from './fit';
import { createPlayer } from './player';

export interface StageProps {
  /** The video; null when only saved data is open (the stage then invites the user to add the matching clip). */
  url: string | null;
  fps: number;
  result: AnalysisResult | null;
  skills: SkillAnalysis | null;
  overlay: OverlayOptions;
  playhead: Playhead;
  speed: number;
  /** Bed outline to draw; while `editing`, clicks add corners and corners can be dragged. */
  calibration: CalibrationDraw | null;
  onCornersChange: (corners: Point[]) => void;
  onError: (message: string) => void;
  /** The user picked or dropped the clip that goes with the saved data. */
  onPickVideo: (file: File) => void;
  view: StageView;
  /** Undefined = no view switcher. Without a video (saved data only) the views that show it are disabled. */
  onView?: (view: StageView) => void;
  /** The 3D skeleton, shown next to the video (split) or instead of it (3d). */
  pane?: ReactNode;
  /** Layers above the video (busy state, calibration bar): each positions itself absolutely inside the stage. */
  children?: ReactNode;
}

const PICK_RADIUS_PX = 16;
/** Space between the video and the pane in the split view. */
const SPLIT_GAP_PX = 12;
const NO_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };

const viewOptions = () =>
  [
    { value: 'video', label: t('stage.viewVideo'), icon: 'video', title: t('stage.viewVideoTitle') },
    { value: 'split', label: t('stage.viewSplit'), icon: 'split', title: t('stage.viewSplitTitle') },
    { value: '3d', label: t('stage.view3d'), icon: 'cube', title: t('stage.view3dTitle') },
  ] as const;

/** Keys that belong to a focused control are not ours. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) || el.isContentEditable;
}

/**
 * The video and everything drawn on it, fitted to the space it is given. It owns the <video> element and publishes it
 * to the rest of the interface through the player bus (`Playhead`): transport, timeline and charts never touch it.
 */
export function Stage({
  url,
  fps,
  result,
  skills,
  overlay,
  playhead,
  speed,
  calibration,
  onCornersChange,
  onError,
  onPickVideo,
  view,
  onView,
  pane,
  children,
}: StageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<ReturnType<typeof createPlayer> | null>(null);
  const dragging = useRef<number | null>(null);
  const dirty = useRef(true);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const size = useElementSize(viewportRef);

  // Where the video goes: the whole viewport, or its share of the split view; in 3D it stays mounted but hidden.
  const layout = useMemo(() => {
    if (view === 'video' || !pane) return { video: fitRatio(ratio, size), pane: NO_BOX, hidden: false, stacked: false };
    if (view === '3d') {
      return {
        video: fitRatio(ratio, size),
        pane: { x: 0, y: 0, width: size.width, height: size.height },
        hidden: true,
        stacked: false,
      };
    }
    const split = splitLayout(size, ratio, SPLIT_GAP_PX);
    return { video: split.video, pane: split.pane, hidden: false, stacked: split.direction === 'column' };
  }, [view, pane, ratio, size]);

  // The latest inputs for the animation loop, which must not restart on every change.
  const live = useRef({ result, skills, overlay, fps, calibration, box: layout.video, hidden: layout.hidden });
  live.current = { result, skills, overlay, fps, calibration, box: layout.video, hidden: layout.hidden };
  useEffect(() => {
    dirty.current = true;
  }, [result, skills, overlay, calibration, layout.video, layout.hidden]);

  // A new clip is laid out as 16:9 until its size is known.
  useEffect(() => {
    setRatio(DEFAULT_RATIO);
  }, [url]);

  // The player bus: everything else in the interface drives the video through these.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const player = createPlayer(video, fps);
    playerRef.current = player;
    playhead.seekHandler = player.seek;
    playhead.playRangeHandler = player.playRange;
    playhead.toggleHandler = player.toggle;
    playhead.pauseHandler = player.pause;
    playhead.stepHandler = player.step;
    return () => {
      playerRef.current = null;
      playhead.seekHandler = null;
      playhead.playRangeHandler = null;
      playhead.toggleHandler = null;
      playhead.pauseHandler = null;
      playhead.stepHandler = null;
    };
  }, [playhead, fps, url]);

  // Without a clip there is nothing to play, and a stale state must not linger in the transport.
  useEffect(() => {
    if (url) return;
    playhead.setPlaying(false);
    playhead.setDuration(0);
  }, [url, playhead]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, url]);

  // Publish the playhead and redraw the overlay whenever the frame or an input changed.
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        playhead.setTime(video.currentTime);
        playerRef.current?.tick();
        const { result: res, skills: sk, overlay: opts, calibration: cal, box, hidden } = live.current;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(box.width * dpr);
        const h = Math.round(box.height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          dirty.current = true;
        }
        const key = `${video.currentTime}`;
        if (!hidden && w > 0 && h > 0 && (dirty.current || key !== lastKey)) {
          lastKey = key;
          dirty.current = false;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (res) drawOverlay(ctx, box.width, box.height, res, sampleIndexAt(res.meta, video.currentTime), opts, sk);
            else ctx.clearRect(0, 0, box.width, box.height);
            if (cal && video.videoWidth)
              drawCalibration(ctx, box.width, box.height, video.videoWidth, video.videoHeight, cal);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playhead]);

  // Keyboard: space = play or pause, arrows = one frame (Shift: ten).
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        playhead.toggle();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        playhead.step((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, playhead]);

  /** Pointer position in video pixels, or null before the video size is known. */
  const toVideoPoint = (e: PointerEvent<HTMLCanvasElement>): { p: Point; cssPerPx: number } | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      p: {
        x: ((e.clientX - rect.left) / rect.width) * v.videoWidth,
        y: ((e.clientY - rect.top) / rect.height) * v.videoHeight,
      },
      cssPerPx: rect.width / v.videoWidth,
    };
  };

  const onCanvasDown = (e: PointerEvent<HTMLCanvasElement>) => {
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
  const onCanvasMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const cal = live.current.calibration;
    const hit = toVideoPoint(e);
    if (dragging.current === null || !cal || !hit) return;
    onCornersChange(cal.corners.map((c, i) => (i === dragging.current ? hit.p : c)));
  };
  const endDrag = useCallback(() => {
    dragging.current = null;
  }, []);

  const editing = !!calibration?.editing;
  const frame = layout.video;
  const showPane = !!pane && view !== 'video';

  return (
    <div className="stage" ref={viewportRef} role="region" aria-label={t('stage.region')}>
      {url ? (
        <div
          className="stage__frame"
          data-hidden={layout.hidden || undefined}
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        >
          <video
            ref={videoRef}
            className="stage__video"
            src={url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const { videoWidth: w, videoHeight: h, duration } = e.currentTarget;
              if (w && h) setRatio(w / h);
              e.currentTarget.playbackRate = speed;
              playhead.setDuration(duration);
            }}
            onDurationChange={(e) => playhead.setDuration(e.currentTarget.duration)}
            onPlay={() => playhead.setPlaying(true)}
            onPause={() => {
              playhead.setPlaying(false);
              playerRef.current?.clearRange();
            }}
            onEnded={() => playhead.setPlaying(false)}
            onError={() => onError(t('stage.cannotPlay'))}
          />
          <canvas
            ref={canvasRef}
            className={editing ? 'stage__overlay stage__overlay--editing' : 'stage__overlay'}
            aria-hidden="true"
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      ) : (
        <div className="stage__empty">
          <Icon name="film" size={28} strokeWidth={1.5} />
          <p className="stage__empty-title">{t('stage.emptyTitle')}</p>
          <p className="stage__empty-text">{t('stage.emptyText')}</p>
          <label className="btn btn--secondary stage__pick">
            <Icon name="upload" size={17} />
            {t('stage.choose')}
            <input
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickVideo(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {showPane && (
        <div
          className="stage__pane"
          style={{ left: layout.pane.x, top: layout.pane.y, width: layout.pane.width, height: layout.pane.height }}
          data-stacked={layout.stacked || undefined}
        >
          {pane}
        </div>
      )}

      {onView && (
        <div className="stage__views">
          <Segmented<StageView>
            ariaLabel={t('stage.views')}
            size="sm"
            value={view}
            onChange={onView}
            options={viewOptions().map((o) =>
              url || o.value === '3d' ? { ...o } : { ...o, disabled: true, title: t('stage.noVideo') },
            )}
          />
        </div>
      )}

      <div className="stage__layer">{children}</div>
    </div>
  );
}
