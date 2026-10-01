import type { CSSProperties } from 'react';
import { t } from '../../i18n';
import { timecode } from '../format';
import { IconButton } from '../kit';
import { useDuration, usePlaying, usePlayheadTime, type Playhead } from '../playhead';
import type { HudJump } from './hud';
import { SPEEDS } from './Transport';

export interface FullscreenHudProps {
  playhead: Playhead;
  fps: number;
  speed: number;
  onSpeed: (speed: number) => void;
  jumps: HudJump[];
  /** The jump under the playhead. */
  selected: number;
  onJump: (delta: -1 | 1) => void;
  onClose: () => void;
  /** A finger is moving the video. */
  swiping: boolean;
  /** Say how to swipe: until the first one. */
  hint: boolean;
}

/** The position in the clip, and a bar to go anywhere in it at once. Its own component: it re-renders at frame rate. */
function SeekBar({ playhead, fps }: { playhead: Playhead; fps: number }) {
  const time = usePlayheadTime(playhead);
  const duration = useDuration(playhead);
  const known = Number.isFinite(duration) && duration > 0;
  const max = known ? duration : 0;
  return (
    <div className="fs__seek" data-stage-control>
      <span className="fs__time num">{timecode(time)}</span>
      <input
        type="range"
        className="fs__range"
        aria-label={t('fs.seek')}
        aria-valuetext={timecode(time)}
        min={0}
        max={max}
        step={fps > 0 ? 1 / fps : 'any'}
        value={Math.min(time, max)}
        disabled={!known}
        style={{ '--fs-progress': `${known ? Math.min(100, (time / duration) * 100) : 0}%` } as CSSProperties}
        onChange={(e) => {
          playhead.pause();
          playhead.seek(Number(e.target.value));
        }}
      />
    </div>
  );
}

/** The time shown large in the middle of the picture while a finger moves the video: the finger hides the rest. */
function SwipeTime({ playhead }: { playhead: Playhead }) {
  const time = usePlayheadTime(playhead);
  return <span className="fs__swipe num">{timecode(time)}</span>;
}

/**
 * What the full screen shows over the picture, and nothing else: the skill under the playhead with its difficulty and execution,
 * the way out, and a slim bar to play, change the jump, change the speed and go anywhere in the clip. The video itself is moved
 * by swiping it (`useScrub`).
 */
export function FullscreenHud({
  playhead,
  fps,
  speed,
  onSpeed,
  jumps,
  selected,
  onJump,
  onClose,
  swiping,
  hint,
}: FullscreenHudProps) {
  const playing = usePlaying(playhead);
  const jump = jumps[selected];
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;

  return (
    <div className="fs">
      <div className="fs__top">
        <IconButton
          className="fs__close"
          data-stage-control
          data-fs-close
          icon="close"
          label={t('fs.exit')}
          variant="solid"
          tip={false}
          onClick={onClose}
        />
        {jump && (
          <div className="fs__skill" aria-live="polite">
            <span className="fs__jump num">{t('fs.jump', { n: selected + 1, total: jumps.length })}</span>
            <span className="fs__name" data-unsure={jump.unsure || undefined}>
              {jump.name}
            </span>
            {(jump.difficulty !== null || jump.deduction !== null) && (
              <span className="fs__figs">
                {jump.difficulty !== null && (
                  <span className="fs__fig">
                    {t('live.difficulty')} <b className="num">{jump.difficulty}</b>
                  </span>
                )}
                {jump.deduction !== null && (
                  <span className="fs__fig">
                    {t('live.execution')} <b className="num">{jump.deduction}</b>
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {swiping ? (
        <SwipeTime playhead={playhead} />
      ) : (
        hint && (
          <p className="fs__hint" role="status">
            {t('fs.hint')}
          </p>
        )
      )}

      <div className="fs__bottom">
        <SeekBar playhead={playhead} fps={fps} />
        <div className="fs__buttons" data-stage-control>
          {jumps.length > 1 && (
            <IconButton
              icon="chevron-left"
              label={t('fs.prevJump')}
              tip={false}
              disabled={selected <= 0}
              onClick={() => onJump(-1)}
            />
          )}
          <IconButton
            className="fs__play"
            icon={playing ? 'pause' : 'play'}
            label={playing ? t('transport.pause') : t('transport.play')}
            variant="primary"
            size="lg"
            iconSize={22}
            tip={false}
            onClick={() => playhead.toggle()}
          />
          {jumps.length > 1 && (
            <IconButton
              icon="chevron-right"
              label={t('fs.nextJump')}
              tip={false}
              disabled={selected >= jumps.length - 1}
              onClick={() => onJump(1)}
            />
          )}
          <button
            type="button"
            className="fs__speed num"
            aria-label={`${t('transport.speed')}: ${speed}×`}
            onClick={() => onSpeed(nextSpeed)}
          >
            {speed}×
          </button>
        </div>
      </div>
    </div>
  );
}
