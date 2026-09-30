import type { DatasetApi } from '../dataset/useDataset';
import { DemoSkeleton } from './DemoSkeleton';
import { DatasetBar, EvaluationReport } from './EvaluationView';
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
}

/** The first screen: what the app does, how to start, and the dataset saved on this computer. */
export function Landing({ onFile, onSample, onOpenSeries, dataset, busy }: LandingProps) {
  const hasDataset = dataset.records.length > 0;
  return (
    <div className="landing">
      <section className="landing__hero">
        <div className="landing__copy">
          <h1 className="landing__title t-brand">Measure every jump.</h1>
          <p className="landing__lead">
            Drop a trampoline video. TrampoVision finds each jump and reports height, time in the air, rotation and
            skill, on your device.
          </p>
          <div className="landing__actions">
            <label
              className={
                busy ? 'btn btn--primary btn--lg landing__pick is-busy' : 'btn btn--primary btn--lg landing__pick'
              }
            >
              <Icon name="upload" size={20} />
              Choose video
              <input
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            {onSample && (
              <Button variant="secondary" size="lg" disabled={busy} onClick={onSample}>
                Use the sample video
              </Button>
            )}
          </div>
          <p className="landing__hint">or drop a video anywhere on this page</p>
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
          <ul className="landing__notes">
            <li>
              <Icon name="video" size={17} />
              Best results come from a fixed, level camera at the side, with the whole trampoline in frame.
            </li>
            <li>
              <Icon name="shield" size={17} />
              Runs in your browser. The video never leaves your device.
            </li>
          </ul>
        </div>
        <div className="landing__art">
          <DemoSkeleton />
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
