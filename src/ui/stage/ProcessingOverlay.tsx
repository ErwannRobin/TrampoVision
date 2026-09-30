import { useEffect, useRef } from 'react';
import { Button, ProgressRing } from '../kit';
import type { Status } from '../types';
import { estimateRemaining, formatRemaining } from './eta';

export interface ProcessingOverlayProps {
  status: Status;
  /** A video is loaded and waiting to be analyzed (there is no result yet). */
  ready: boolean;
  fileName: string;
  /** Runtime of the pose model once analysis started, e.g. "MediaPipe (GPU delegate)". */
  backend: string;
  onAnalyze: () => void;
  onCancel: () => void;
}

const LOADING_TEXT = {
  reading: 'Reading the video',
  measuring: 'Measuring the frame rate',
  converting: 'Converting the video for this browser',
} as const;

/** Milliseconds since the analysis began, kept across renders so the estimate has something to work from. */
function useElapsed(active: boolean) {
  const started = useRef<number | null>(null);
  useEffect(() => {
    started.current = active ? performance.now() : null;
  }, [active]);
  return () => (started.current === null ? 0 : (performance.now() - started.current) / 1000);
}

/**
 * What covers the video while the app is busy: reading, converting or analyzing with progress, or, once a clip is
 * loaded and waiting, the invitation to analyze it. A scrim keeps the video visible behind it.
 */
export function ProcessingOverlay({ status, ready, fileName, backend, onAnalyze, onCancel }: ProcessingOverlayProps) {
  const analyzing = status.kind === 'analyzing';
  const elapsed = useElapsed(analyzing);

  if (status.kind === 'loading') {
    const converting = status.stage === 'converting';
    const progress = converting ? (status.progress ?? 0) : undefined;
    return (
      <div className="busy" role="status">
        <div className="busy__panel">
          <ProgressRing value={progress} size={56} label={LOADING_TEXT[status.stage]}>
            {progress !== undefined && <span className="busy__percent num">{Math.round(progress * 100)}%</span>}
          </ProgressRing>
          <p className="busy__title">{LOADING_TEXT[status.stage]}</p>
          {converting && <p className="busy__text">Runs on your device and can take a while.</p>}
        </div>
      </div>
    );
  }

  if (status.kind === 'analyzing') {
    const progress = status.total > 0 ? status.done / status.total : 0;
    const left = estimateRemaining(elapsed(), progress);
    return (
      <div className="busy" role="status">
        <div className="busy__panel">
          <ProgressRing value={progress} size={104} stroke={5} label="Analysis progress">
            <span className="busy__percent busy__percent--big num">{Math.round(progress * 100)}%</span>
          </ProgressRing>
          <p className="busy__title">
            Analyzing frame <span className="num">{status.done}</span> of <span className="num">{status.total}</span>
          </p>
          {left !== null && <p className="busy__text">{formatRemaining(left)}</p>}
          <p className="busy__text">{backend ? `Running on ${backend}` : 'The video stays on your device.'}</p>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
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
              {fileName || 'Your video'}
            </p>
            <p className="ready__hint">Ready to analyze. It runs on your device.</p>
          </div>
          <Button variant="primary" size="lg" onClick={onAnalyze}>
            Analyze video
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
