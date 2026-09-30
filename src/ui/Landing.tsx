import { useEffect, useState } from 'react';
import { REVIEW_API_URL, fetchQueueCount } from '../sync/reviewSync';
import type { DatasetApi } from '../dataset/useDataset';
import { HeroArcs } from './chrome/HeroArcs';
import { DemoSkeleton } from './DemoSkeleton';
import { DatasetBar, EvaluationReport } from './EvaluationView';
import { useMediaQuery } from './hooks';
import { Button, Icon } from './kit';

export interface LandingProps {
  onFile: (file: File) => void;
  /** Null when no sample video is bundled. */
  onSample: (() => void) | null;
  onOpenSeries: (file: File) => void;
  /** The dataset saved in this browser: shown as its own section when it holds something. */
  dataset: DatasetApi;
  /** A file is being read. */
  busy: boolean;
  /** The advanced tools are on: saved analyses, the reviewer page and the saved dataset. */
  advanced: boolean;
}

/** A link to the reviewer page, with the number of jumps waiting. Only when the build has a review service. */
function ReviewLink() {
  const [waiting, setWaiting] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void fetchQueueCount().then((n) => live && setWaiting(n));
    return () => {
      live = false;
    };
  }, []);
  return (
    <a className="landing__review" href="/review.html">
      <Icon name="check" size={18} />
      <span>
        Review jumps
        <small>{waiting === null ? 'Confirm or correct what the app found' : `${waiting} waiting for a check`}</small>
      </span>
    </a>
  );
}

/** Picks a video from a button; `capture` opens the camera of a phone or a tablet instead of the library. */
function VideoButton({
  label,
  icon,
  primary,
  capture,
  busy,
  onFile,
}: {
  label: string;
  icon: 'upload' | 'video';
  primary: boolean;
  capture?: boolean;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const kind = primary ? 'btn btn--primary btn--lg landing__pick' : 'btn btn--secondary btn--lg landing__pick';
  return (
    <label className={busy ? `${kind} is-busy` : kind}>
      <Icon name={icon} size={20} />
      {label}
      <input
        type="file"
        accept={capture ? 'video/*' : 'video/mp4,video/quicktime,.mp4,.mov'}
        capture={capture ? 'environment' : undefined}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** The first screen: what the app does and how to start. The advanced tools add the saved analyses and the dataset kept in this browser. */
export function Landing({ onFile, onSample, onOpenSeries, dataset, busy, advanced }: LandingProps) {
  const hasDataset = advanced && dataset.records.length > 0;
  // A phone or a tablet can film right away; a computer picks a file.
  const touch = useMediaQuery('(pointer: coarse)');
  return (
    <div className="landing">
      <section className="landing__hero">
        <div className="landing__copy">
          <h1 className="landing__title t-brand">Score every skill.</h1>
          <p className="landing__lead">
            Film a set. TrampoVision names each skill, works out its difficulty, proposes an execution score and tells
            you what to fix. It runs on your device.
          </p>
          <div className="landing__actions">
            {touch ? (
              <>
                <VideoButton label="Film a set" icon="video" primary capture busy={busy} onFile={onFile} />
                <VideoButton label="Choose a video" icon="upload" primary={false} busy={busy} onFile={onFile} />
              </>
            ) : (
              <VideoButton label="Choose a video" icon="upload" primary busy={busy} onFile={onFile} />
            )}
            {onSample && (
              <Button variant="secondary" size="lg" disabled={busy} onClick={onSample}>
                Use the sample video
              </Button>
            )}
          </div>
          <p className="landing__hint">or drop a video anywhere on this page</p>
          {advanced && (
            <label className="landing__link">
              Open a saved analysis
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onOpenSeries(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {advanced && REVIEW_API_URL && <ReviewLink />}
          <ul className="landing__notes">
            <li>
              <Icon name="video" size={17} />
              Best results come from a fixed, level camera at the side, with the whole trampoline in frame and the
              athlete in view from the takeoff of the first skill to the landing of the last.
            </li>
            <li>
              <Icon name="shield" size={17} />
              Runs in your browser. The video never leaves your device.
            </li>
          </ul>
        </div>
        <div className="landing__art">
          <DemoSkeleton />
          <HeroArcs />
        </div>
      </section>

      {hasDataset && (
        <section className="landing__dataset sheet" aria-label="Saved dataset">
          <h2 className="landing__dataset-title">Saved dataset</h2>
          <DatasetBar dataset={dataset} baseName="trampovision" />
          <EvaluationReport
            records={dataset.records}
            videoId={null}
            scope="all"
            onScope={() => {}}
            baseName="trampovision"
            onGoTo={() => {}}
          />
        </section>
      )}
    </div>
  );
}
