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
}

const LAYERS: { key: 'skeleton' | 'com' | 'trail' | 'hud'; label: string; icon: IconName }[] = [
  { key: 'skeleton', label: 'Skeleton', icon: 'person' },
  { key: 'com', label: 'Center of mass', icon: 'target' },
  { key: 'trail', label: 'Trajectory', icon: 'route' },
  { key: 'hud', label: 'Labels', icon: 'tag' },
];

/** The position in the clip, as a video editor shows it. Its own component: it re-renders at frame rate, the buttons do not. */
function Timecode({ playhead, fps }: { playhead: Playhead; fps: number }) {
  const time = usePlayheadTime(playhead);
  const duration = useDuration(playhead);
  const total = frameCount(duration, fps);
  return (
    <div className="transport__time">
      <span className="transport__code num">{timecode(time)}</span>
      {total > 0 && (
        <span className="transport__frame num">
          Frame {Math.min(frameAtTime(time, fps) + 1, total)} of {total}
        </span>
      )}
    </div>
  );
}

/** Play, frame steps, speed and the layers on the video. It drives the video through the player bus only. */
export function Transport({ playhead, fps, speed, onSpeed, overlay, onOverlay, hasVideo, hasResult }: TransportProps) {
  const playing = usePlaying(playhead);
  const narrow = useMediaQuery('(max-width: 720px)');
  const off = !hasVideo;

  return (
    <div className="transport">
      <div className="transport__buttons">
        <IconButton
          className="transport__far"
          icon="chevron-left"
          label="Back 10 frames (Shift + ←)"
          disabled={off}
          onClick={() => playhead.step(-10)}
        />
        <IconButton icon="step-back" label="Previous frame (←)" disabled={off} onClick={() => playhead.step(-1)} />
        <IconButton
          className="transport__play"
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause (Space)' : 'Play (Space)'}
          variant="primary"
          size="lg"
          iconSize={20}
          disabled={off}
          onClick={() => playhead.toggle()}
        />
        <IconButton icon="step-forward" label="Next frame (→)" disabled={off} onClick={() => playhead.step(1)} />
        <IconButton
          className="transport__far"
          icon="chevron-right"
          label="Forward 10 frames (Shift + →)"
          disabled={off}
          onClick={() => playhead.step(10)}
        />
      </div>

      <Timecode playhead={playhead} fps={fps} />

      <div className="transport__tools">
        {narrow ? (
          <select
            className="select select--sm select--pill transport__speed"
            aria-label="Playback speed"
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
            ariaLabel="Playback speed"
            size="sm"
            value={String(speed)}
            onChange={(v) => onSpeed(Number(v))}
            options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, disabled: off }))}
          />
        )}
        <div className="transport__layers" role="group" aria-label="Layers on the video">
          {LAYERS.map((l) => (
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
      </div>
    </div>
  );
}
