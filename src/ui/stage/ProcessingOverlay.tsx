import { useEffect, useRef, useState } from 'react';
import { t, tx } from '../../i18n';
import { Button, ProgressRing } from '../kit';
import type { Status } from '../types';
import { estimateRemaining, formatRemaining, progressMilestone } from './eta';

export interface ProcessingOverlayProps {
  status: Status;
  /** A video is loaded and waiting to be analyzed (there is no result yet). */
  ready: boolean;
  fileName: string;
  /** Runtime of the pose model once analysis started, e.g. "MediaPipe Pose Landmarker · GPU". Only the advanced view shows it. */
  backend: string;
  /**
   * The advanced tools are on: the analysis counts frames and names its runtime. The live view says what is happening
   * in plain words, which is all a coach on the trampoline needs.
   */
  advanced: boolean;
  onAnalyze: () => void;
  onCancel: () => void;
}

const loadingText = () => ({
  downloading: t('busy.downloading'),
  reading: t('busy.reading'),
  measuring: t('busy.measuring'),
  converting: t('busy.converting'),
  model: t('busy.model'),
});

/** Milliseconds since the analysis began, kept across renders so the estimate has something to work from. */
function useElapsed(active: boolean) {
  const started = useRef<number | null>(null);
  useEffect(() => {
    started.current = active ? performance.now() : null;
  }, [active]);
  return () => (started.current === null ? 0 : (performance.now() - started.current) / 1000);
}

/**
 * What a screen reader is told while the app is busy: the stage when it begins (and why, for a conversion), then "halfway"
 * and "almost done". Never each percent, and never the frame count of the advanced view.
 */
export function announcement(status: Status): string {
  if (status.kind === 'loading') {
    const converting = status.stage === 'converting';
    const start = converting ? `${t('busy.converting')} ${t('busy.convertingText')}` : loadingText()[status.stage];
    const progress =
      converting || status.stage === 'downloading' || status.stage === 'model' ? (status.progress ?? 0) : 0;
    return milestoneText(progress, start);
  }
  if (status.kind === 'analyzing') {
    return milestoneText(status.total > 0 ? status.done / status.total : 0, t('busy.analyzingLive'));
  }
  return '';
}

function milestoneText(progress: number, start: string): string {
  const milestone = progressMilestone(progress);
  return milestone === 'half' ? t('busy.half') : milestone === 'almost' ? t('eta.almost') : start;
}

/**
 * A live region that is in the page before it speaks (one that appears already filled is often not read), and that only
 * changes when `text` does. The progress around it changes all the time and is not announced.
 */
function Announce({ text }: { text: string }) {
  const [said, setSaid] = useState('');
  useEffect(() => setSaid(text), [text]);
  return (
    <p className="sr-only" role="status">
      {said}
    </p>
  );
}

/**
 * What covers the video while the app is busy: reading, converting or analyzing with progress, or, once a clip is
 * loaded and waiting, the invitation to analyze it. A scrim keeps the video visible behind it.
 */
export function ProcessingOverlay({
  status,
  ready,
  fileName,
  backend,
  advanced,
  onAnalyze,
  onCancel,
}: ProcessingOverlayProps) {
  const analyzing = status.kind === 'analyzing';
  const elapsed = useElapsed(analyzing);

  if (status.kind === 'loading') {
    const converting = status.stage === 'converting';
    // The pose model's progress is unknown (a ring that turns) until its files start to arrive and again once they are in.
    const progress =
      converting || status.stage === 'downloading'
        ? (status.progress ?? 0)
        : status.stage === 'model'
          ? status.progress
          : undefined;
    const title = loadingText()[status.stage];
    return (
      <div className="busy">
        <div className="busy__panel">
          <ProgressRing value={progress} size={56} label={title}>
            {progress !== undefined && <span className="busy__percent num">{Math.round(progress * 100)}%</span>}
          </ProgressRing>
          <p className="busy__title">{title}</p>
          {converting && <p className="busy__text">{t('busy.convertingText')}</p>}
          <Announce text={announcement(status)} />
        </div>
      </div>
    );
  }

  if (status.kind === 'analyzing') {
    const progress = status.total > 0 ? status.done / status.total : 0;
    const left = estimateRemaining(elapsed(), progress);
    return (
      <div className="busy">
        <div className="busy__panel">
          <ProgressRing value={progress} size={104} stroke={5} label={t('busy.progress')}>
            <span className="busy__percent busy__percent--big num">{Math.round(progress * 100)}%</span>
          </ProgressRing>
          <p className="busy__title">
            {advanced
              ? tx('busy.analyzing', {
                  done: <span className="num">{status.done}</span>,
                  total: <span className="num">{status.total}</span>,
                })
              : t('busy.analyzingLive')}
          </p>
          {/* The line keeps its place while there is nothing to say yet, so the panel does not jump when the estimate comes. */}
          <p className="busy__text" aria-hidden={left === null || undefined}>
            {left === null ? '\u00a0' : formatRemaining(left)}
          </p>
          <p className="busy__text">{advanced && backend ? t('busy.runningOn', { backend }) : t('busy.stays')}</p>
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Announce text={announcement(status)} />
        </div>
      </div>
    );
  }

  if (ready) {
    return (
      <div className="ready">
        <div className="ready__panel">
          <div className="ready__text">
            <p className="ready__name" title={fileName}>
              {fileName || t('busy.yourVideo')}
            </p>
            <p className="ready__hint">{t('busy.ready')}</p>
          </div>
          <Button variant="primary" size="lg" onClick={onAnalyze}>
            {t('setup.analyze')}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
