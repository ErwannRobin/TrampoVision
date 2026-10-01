import { t } from '../../i18n';
import { frameAtTime } from '../../video/frames';
import type { OverlayOptions } from '../../video/overlay';
import { timecode } from '../format';
import { useMediaQuery } from '../hooks';
import { IconButton, Segmented, type IconName } from '../kit';
import { useDuration, usePlaying, usePlayheadTime, type Playhead } from '../playhead';
import { frameCount } from './player';

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2];

export interface TransportProps {
  playhead: Playhead;
  fps: number;
  speed: number;
  onSpeed: (speed: number) => void;
  /** Which layers are drawn on the video. */
  overlay: OverlayOptions;
  onOverlay: (next: OverlayOptions) => void;
  hasVideo: boolean;
  /** Layers need an analysis to draw. */
  hasResult: boolean;
  /** Only what a coach on the trampoline needs: play, the frame steps and the speed. No ten-frame jumps, frame counter or layers. */
  simple?: boolean;
}

const layers = (): { key: 'skeleton' | 'com' | 'trail' | 'hud'; label: string; icon: IconName }[] => [
  { key: 'skeleton', label: t('transport.skeleton'), icon: 'person' },
  { key: 'com', label: t('transport.com'), icon: 'target' },
  { key: 'trail', label: t('transport.trail'), icon: 'route' },
  { key: 'hud', label: t('transport.hud'), icon: 'tag' },
];

/** The position in the clip, as a video editor shows it. Its own component: it re-renders at frame rate, the buttons do not. */
function Timecode({ playhead, fps, simple }: { playhead: Playhead; fps: number; simple?: boolean }) {
  const time = usePlayheadTime(playhead);
  const duration = useDuration(playhead);
  const total = frameCount(duration, fps);
  return (
    <div className="transport__time">
      <span className="transport__code num">{timecode(time)}</span>
      {total > 0 && !simple && (
        <span className="transport__frame num">
          {t('transport.frame', { n: Math.min(frameAtTime(time, fps) + 1, total), total })}
        </span>
      )}
    </div>
  );
}

/** Play, frame steps, speed and the layers on the video. It drives the video through the player bus only. */
export function Transport({
  playhead,
  fps,
  speed,
  onSpeed,
  overlay,
  onOverlay,
  hasVideo,
  hasResult,
  simple,
}: TransportProps) {
  const playing = usePlaying(playhead);
  // The speed is a select where the bar is narrow: a phone upright, or on its side, where the transport has a column of its own.
  const narrow = useMediaQuery(
    '(max-width: 720px), (max-width: 1099px) and (max-height: 520px) and (orientation: landscape)',
  );
  const off = !hasVideo;

  return (
    <div className="transport">
      <div className="transport__buttons">
        {!simple && (
          <IconButton
            className="transport__far"
            icon="chevron-left"
            label={t('transport.back10')}
            disabled={off}
            onClick={() => playhead.step(-10)}
          />
        )}
        <IconButton icon="step-back" label={t('transport.prev')} disabled={off} onClick={() => playhead.step(-1)} />
        <IconButton
          className="transport__play"
          icon={playing ? 'pause' : 'play'}
          label={playing ? t('transport.pause') : t('transport.play')}
          variant="primary"
          size="lg"
          iconSize={20}
          disabled={off}
          onClick={() => playhead.toggle()}
        />
        <IconButton icon="step-forward" label={t('transport.next')} disabled={off} onClick={() => playhead.step(1)} />
        {!simple && (
          <IconButton
            className="transport__far"
            icon="chevron-right"
            label={t('transport.forward10')}
            disabled={off}
            onClick={() => playhead.step(10)}
          />
        )}
      </div>

      <Timecode playhead={playhead} fps={fps} simple={simple} />

      <div className="transport__tools">
        {narrow ? (
          <select
            className="select select--sm select--pill transport__speed"
            aria-label={t('transport.speed')}
            value={String(speed)}
            disabled={off}
            onChange={(e) => onSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={String(s)}>
                {s}×
              </option>
            ))}
          </select>
        ) : (
          <Segmented<string>
            ariaLabel={t('transport.speed')}
            size="sm"
            value={String(speed)}
            onChange={(v) => onSpeed(Number(v))}
            options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, disabled: off }))}
          />
        )}
        {!simple && (
          <div className="transport__layers" role="group" aria-label={t('transport.layers')}>
            {layers().map((l) => (
              <IconButton
                key={l.key}
                icon={l.icon}
                label={l.label}
                size="sm"
                pressed={overlay[l.key]}
                disabled={off || !hasResult}
                onClick={() => onOverlay({ ...overlay, [l.key]: !overlay[l.key] })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
