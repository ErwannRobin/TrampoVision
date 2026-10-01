import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
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
import { clipOrientation, DEFAULT_RATIO, fitRatio, portraitStageWidth, splitLayout, type Box, type Size } from './fit';
import { createClockVideo } from './clockVideo';
import { FullscreenHud } from './FullscreenHud';
import type { HudJump } from './hud';
import { createPlayer } from './player';
import { useScrub } from './scrub';

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
  /**
   * The size of the clip's frames once known (from the video, or from the saved analysis when there is no video), null before.
   * The shell lays the page out for a portrait clip from it.
   */
  onClipSize?: (size: Size | null) => void;
  /** Several athletes were followed: which one the analysis shows, or all of them side by side. Undefined = a single athlete, no switcher. */
  athletes?: {
    count: number;
    value: number;
    onChange: (index: number) => void;
    compare: boolean;
    onCompare: () => void;
  };
  /** The other athletes, drawn on the video next to the main one (side by side view). */
  others?: OtherAthlete[];
  /** The 3D skeleton, shown next to the video (split) or instead of it (3d). */
  pane?: ReactNode;
  /**
   * The full screen (a phone held in the hand): only the picture, the skill under the playhead and a slim bar, and a swipe right or
   * left moves the video. Undefined = no full screen button.
   */
  fullscreen?: {
    jumps: HudJump[];
    /** The jump under the playhead. */
    selected: number;
    onJump: (delta: -1 | 1) => void;
    onSpeed: (speed: number) => void;
  };
  /** Layers above the video (busy state, calibration bar): each positions itself absolutely inside the stage. */
  children?: ReactNode;
}

/** An athlete drawn on the video next to the main one: their analysis and the one color of their skeleton. */
export interface OtherAthlete {
  result: AnalysisResult;
  tint: string;
}

/** Draws the skeletons of the other athletes over what `drawOverlay` painted. */
function drawOthers(ctx: CanvasRenderingContext2D, w: number, h: number, others: OtherAthlete[], time: number) {
  for (const o of others) {
    const opts = { skeleton: true, com: false, trail: false, hud: false, tint: o.tint };
    drawOverlay(ctx, w, h, o.result, sampleIndexAt(o.result.meta, time), opts, null, false);
  }
}

/** The value of the switcher's "all athletes side by side" choice. */
const COMPARE = 'compare';
const NO_OTHERS: OtherAthlete[] = [];
const PICK_RADIUS_PX = 16;
/** Space between the video and the pane in the split view. */
const SPLIT_GAP_PX = 12;
const NO_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };
/** How long the hint about swiping stays up when the full screen opens. */
const HINT_MS = 3500;

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
  onClipSize,
  athletes,
  others = NO_OTHERS,
  pane,
  fullscreen,
  children,
}: StageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<ReturnType<typeof createPlayer> | null>(null);
  const dragging = useRef<number | null>(null);
  const dirty = useRef(true);
  // What the video says its frames measure. Only valid for the clip it was read from.
  const [videoSize, setVideoSize] = useState<{ url: string; width: number; height: number } | null>(null);
  const size = useElementSize(viewportRef);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  /** The player says when it starts and stops playing backwards; the video itself never does. */
  const onReverse = useCallback(
    (active: boolean) => {
      playhead.setReverse(active);
      playhead.setPlaying(active);
    },
    [playhead],
  );

  // The size of the clip: from the video, or, for a saved analysis without one, from the analysis. Unknown until then: the
  // clip is laid out as 16:9 and the page in the landscape layout.
  const dataMeta = !url && result ? result.meta : null;
  const fromVideo = url && videoSize?.url === url ? videoSize : null;
  const clipWidth = fromVideo?.width ?? dataMeta?.width ?? 0;
  const clipHeight = fromVideo?.height ?? dataMeta?.height ?? 0;
  const ratio = clipWidth > 0 && clipHeight > 0 ? clipWidth / clipHeight : DEFAULT_RATIO;
  const portrait = clipOrientation({ width: clipWidth, height: clipHeight }) === 'portrait';
  useLayoutEffect(() => {
    onClipSize?.(clipWidth > 0 && clipHeight > 0 ? { width: clipWidth, height: clipHeight } : null);
    return () => onClipSize?.(null);
  }, [onClipSize, clipWidth, clipHeight]);

  // The full screen: the same stage, fixed over the page (the <video> is never remounted), and the browser's own full screen where it has one.
  const [full, setFull] = useState(false);
  const [swiping, setSwiping] = useState(false);
  const [hint, setHint] = useState(false);
  // Only with a video and its analysis: what the full screen shows is the analysis.
  const canFull = !!fullscreen && !!url && !!result;
  const isFull = full && canFull;
  const enterFull = () => {
    setFull(true);
    // Not every browser can (a phone's Safari cannot for anything but a video): the fixed stage is the full screen then.
    void Promise.resolve(viewportRef.current?.requestFullscreen?.()).catch(() => undefined);
  };
  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!isFull) return;
    const root = document.documentElement;
    root.dataset.stageFullscreen = '';
    setHint(true);
    const timer = window.setTimeout(() => setHint(false), HINT_MS);
    const viewport = viewportRef.current;
    viewport?.querySelector<HTMLElement>('[data-fs-close]')?.focus();
    // The browser's own way out (Escape, the back gesture) must bring the stage back as well.
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFull();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      delete root.dataset.stageFullscreen;
      window.clearTimeout(timer);
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
      setSwiping(false);
      viewport?.querySelector<HTMLElement>('[data-fs-open]')?.focus();
    };
  }, [isFull, exitFull]);
  // Gone with the video (a new clip, saved data only): leave the browser's full screen too.
  useEffect(() => {
    if (!canFull && document.fullscreenElement === viewportRef.current)
      void document.exitFullscreen().catch(() => undefined);
  }, [canFull]);
  const onSwipe = useCallback((on: boolean) => {
    setSwiping(on);
    if (on) setHint(false);
  }, []);
  const toggleOnTap = useCallback(() => playhead.toggle(), [playhead]);
  const scrub = useScrub({ enabled: isFull, playhead, onTap: toggleOnTap, onSwipe });
  // The labels are drawn by the full screen itself, in the page's type, where a finger does not cover them.
  const shownOverlay = useMemo(() => (isFull ? { ...overlay, hud: false } : overlay), [overlay, isFull]);

  // Where the video goes: the whole viewport, or its share of the split view; in 3D it stays mounted but hidden.
  const layout = useMemo(() => {
    if (view === 'video' || !pane || isFull)
      return { video: fitRatio(ratio, size), pane: NO_BOX, hidden: false, stacked: false };
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
  }, [view, pane, ratio, size, isFull]);

  // The latest inputs for the animation loop, which must not restart on every change.
  const live = useRef({
    result,
    skills,
    overlay: shownOverlay,
    fps,
    calibration,
    box: layout.video,
    hidden: layout.hidden,
    others,
  });
  live.current = {
    result,
    skills,
    overlay: shownOverlay,
    fps,
    calibration,
    box: layout.video,
    hidden: layout.hidden,
    others,
  };
  useEffect(() => {
    dirty.current = true;
  }, [result, skills, shownOverlay, calibration, layout.video, layout.hidden, others]);

  // The player bus: everything else in the interface drives the video through these.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const player = createPlayer(video, fps, { rate: () => speedRef.current, onReverse });
    playerRef.current = player;
    playhead.seekHandler = player.seek;
    playhead.playRangeHandler = player.playRange;
    playhead.toggleHandler = player.toggle;
    playhead.pauseHandler = player.pause;
    playhead.stepHandler = player.step;
    playhead.reverseHandler = player.reverse;
    return () => {
      playerRef.current = null;
      playhead.seekHandler = null;
      playhead.playRangeHandler = null;
      playhead.toggleHandler = null;
      playhead.pauseHandler = null;
      playhead.stepHandler = null;
      playhead.reverseHandler = null;
      playhead.setReverse(false);
    };
  }, [playhead, fps, url, onReverse]);

  // Without a clip or saved data there is nothing to play, and a stale state must not linger in the transport.
  const hasData = !!result;
  useEffect(() => {
    if (url || hasData) return;
    playhead.setPlaying(false);
    playhead.setDuration(0);
  }, [url, hasData, playhead]);

  // Saved data without its video: a clock plays the analysis, through the same player the video would use.
  const dataCount = dataMeta?.count ?? 0;
  const dataFps = dataMeta?.fps ?? 0;
  useEffect(() => {
    if (!dataCount || !dataFps) return;
    const duration = dataCount / dataFps;
    const clock = createClockVideo(
      duration,
      (playing) => {
        playhead.setPlaying(playing);
        if (!playing) player.clearRange();
      },
      playhead.getSnapshot(),
    );
    const player = createPlayer(clock, fps, { rate: () => speedRef.current, onReverse });
    playhead.seekHandler = player.seek;
    playhead.playRangeHandler = player.playRange;
    playhead.toggleHandler = player.toggle;
    playhead.pauseHandler = player.pause;
    playhead.stepHandler = player.step;
    playhead.reverseHandler = player.reverse;
    playhead.setDuration(duration);
    playhead.setPlaying(false);
    playhead.setTime(clock.currentTime);
    let raf = 0;
    let last = performance.now();
    let lastKey = -1;
    const loop = (now: number) => {
      clock.advance(((now - last) / 1000) * speedRef.current);
      last = now;
      playhead.setTime(clock.currentTime);
      player.tick();
      const canvas = canvasRef.current;
      const { result: res, skills: sk, overlay: opts, calibration: cal, box, hidden, others: more } = live.current;
      if (canvas && res) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(box.width * dpr);
        const h = Math.round(box.height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          dirty.current = true;
        }
        if (!hidden && w > 0 && h > 0 && (dirty.current || clock.currentTime !== lastKey)) {
          lastKey = clock.currentTime;
          dirty.current = false;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawOverlay(ctx, box.width, box.height, res, sampleIndexAt(res.meta, clock.currentTime), opts, sk);
            drawOthers(ctx, box.width, box.height, more, clock.currentTime);
            if (cal) drawCalibration(ctx, box.width, box.height, res.meta.width, res.meta.height, cal);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      playhead.seekHandler = null;
      playhead.playRangeHandler = null;
      playhead.toggleHandler = null;
      playhead.pauseHandler = null;
      playhead.stepHandler = null;
      playhead.reverseHandler = null;
      playhead.setReverse(false);
      playhead.setPlaying(false);
    };
  }, [playhead, fps, dataCount, dataFps, onReverse]);

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
        const { result: res, skills: sk, overlay: opts, calibration: cal, box, hidden, others: more } = live.current;
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
            if (res) {
              drawOverlay(ctx, box.width, box.height, res, sampleIndexAt(res.meta, video.currentTime), opts, sk);
              drawOthers(ctx, box.width, box.height, more, video.currentTime);
            } else ctx.clearRect(0, 0, box.width, box.height);
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

  // Keyboard: space = play or pause (Shift: play backwards), arrows = one frame (Shift: ten).
  useEffect(() => {
    if (!url && !hasData) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) playhead.reverse();
        else playhead.toggle();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        playhead.step((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, hasData, playhead]);

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
  /** A click or a tap on the picture plays or pauses, at once; while the bed is being outlined a click places a corner instead. */
  const onFrameClick = (e: MouseEvent<HTMLDivElement>) => {
    // The full screen has its own tap (`useScrub`), which also works on the letterbox.
    if (isFull || editing || (e.target as HTMLElement).closest('.stage__pick')) return;
    playhead.toggle();
  };
  const frame = layout.video;
  const showPane = !!pane && view !== 'video' && !isFull;
  // In the wide layout a portrait clip has a stage of its own width (shell.css) instead of a black one: it says how wide.
  const portraitWidth = portrait ? portraitStageWidth(ratio, size.height) : 0;

  return (
    <div
      className="stage"
      ref={viewportRef}
      role="region"
      aria-label={t('stage.region')}
      data-fullscreen={isFull || undefined}
      data-swiping={swiping || undefined}
      {...scrub}
      style={portraitWidth > 0 ? ({ '--stage-w': `${portraitWidth}px` } as CSSProperties) : undefined}
    >
      {url ? (
        <div
          className="stage__frame"
          data-hidden={layout.hidden || undefined}
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
          onClick={onFrameClick}
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
              if (w && h) setVideoSize({ url, width: w, height: h });
              e.currentTarget.playbackRate = speed;
              playhead.setDuration(duration);
            }}
            onDurationChange={(e) => playhead.setDuration(e.currentTarget.duration)}
            onPlay={() => playhead.setPlaying(true)}
            onPause={() => {
              // Playing backwards keeps the video paused on purpose: the player is still "playing".
              if (playerRef.current?.isReversing()) return;
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
      ) : result ? (
        <div
          className="stage__frame stage__frame--data"
          data-hidden={layout.hidden || undefined}
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
          onClick={onFrameClick}
        >
          <canvas ref={canvasRef} className="stage__overlay" aria-hidden="true" />
          <label className="btn btn--secondary stage__pick stage__pick--corner">
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

      {athletes && !isFull && (
        <div className="stage__views stage__athletes">
          <Segmented<string>
            ariaLabel={t('stage.athletes')}
            size="sm"
            value={athletes.compare ? COMPARE : String(athletes.value)}
            onChange={(v) => (v === COMPARE ? athletes.onCompare() : athletes.onChange(Number(v)))}
            options={[
              ...Array.from({ length: athletes.count }, (_, i) => ({
                value: String(i),
                label: t('stage.athlete', { n: i + 1 }),
                title: t('stage.athleteTitle', { n: i + 1 }),
              })),
              { value: COMPARE, label: t('stage.compare'), title: t('stage.compareTitle') },
            ]}
          />
        </div>
      )}

      {onView && !isFull && (
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

      {canFull && !isFull && !editing && (
        <button
          type="button"
          className="icon-btn icon-btn--solid stage__expand"
          data-fs-open
          aria-label={t('fs.enter')}
          onClick={enterFull}
        >
          <svg
            className="icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <polyline points="4 9 4 4 9 4" />
            <polyline points="20 9 20 4 15 4" />
            <polyline points="4 15 4 20 9 20" />
            <polyline points="20 15 20 20 15 20" />
          </svg>
        </button>
      )}

      {isFull && fullscreen && (
        <FullscreenHud
          playhead={playhead}
          fps={fps}
          speed={speed}
          onSpeed={fullscreen.onSpeed}
          jumps={fullscreen.jumps}
          selected={fullscreen.selected}
          onJump={fullscreen.onJump}
          onClose={exitFull}
          swiping={swiping}
          hint={hint}
        />
      )}

      <div className="stage__layer">{children}</div>
    </div>
  );
}
