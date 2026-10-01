import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { REVIEW_API_URL, fetchQueueCount } from '../sync/reviewSync';
import type { DatasetApi } from '../dataset/useDataset';
import { ABOUT_HASH } from './chrome/aboutRoute';
import { HeroArcs } from './chrome/HeroArcs';
import { RecentSets, type RecentSetsProps } from './chrome/RecentSets';
import { DemoSkeleton } from './DemoSkeleton';
import { DatasetBar, EvaluationReport } from './EvaluationView';
import type { Sample } from '../video/sample';
import { useMediaQuery } from './hooks';
import { Icon, Menu } from './kit';

export interface LandingProps {
  onFile: (file: File) => void;
  /** The sample videos on offer: none when there is no asset host. */
  samples: Sample[];
  onSample: (path: string) => void;
  onOpenSeries: (file: File) => void;
  /** The dataset saved in this browser: shown as its own section when it holds something. */
  dataset: DatasetApi;
  /** The sets analyzed before, kept on this device: listed under the first actions, hidden when there are none. */
  recent?: Omit<RecentSetsProps, 'busy'>;
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
        {t('landing.review')}
        <small>{waiting === null ? t('landing.reviewIdle') : t('landing.reviewWaiting', { n: waiting })}</small>
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
export function Landing({ onFile, samples, onSample, onOpenSeries, dataset, recent, busy, advanced }: LandingProps) {
  const hasDataset = advanced && dataset.records.length > 0;
  // A phone or a tablet can film right away; a computer picks a file.
  const touch = useMediaQuery('(pointer: coarse)');
  return (
    <div className="landing">
      <section className="landing__hero">
        <div className="landing__copy">
          <h1 className="landing__title t-brand">{t('landing.title')}</h1>
          <p className="landing__lead">{t('landing.lead')}</p>
          <div className="landing__actions">
            {touch ? (
              <>
                <VideoButton label={t('landing.film')} icon="video" primary capture busy={busy} onFile={onFile} />
                <VideoButton label={t('landing.choose')} icon="upload" primary={false} busy={busy} onFile={onFile} />
              </>
            ) : (
              <VideoButton label={t('landing.choose')} icon="upload" primary busy={busy} onFile={onFile} />
            )}
            {samples.length > 0 && (
              <Menu
                label={t('landing.sample')}
                icon="film"
                size="lg"
                align="start"
                groups={[
                  {
                    id: 'samples',
                    items: samples.map((sample) => ({
                      id: sample.id,
                      label: sample.label,
                      disabled: busy,
                      onSelect: () => onSample(sample.path),
                    })),
                  },
                ]}
              />
            )}
          </div>
          <p className="landing__hint">{t('landing.drop')}</p>
          {advanced && (
            <label className="landing__link">
              {t('landing.openSaved')}
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
          <a className="landing__link" href={ABOUT_HASH}>
            {t('landing.about')}
          </a>
          {recent && <RecentSets {...recent} busy={busy} />}
          <ul className="landing__notes">
            <li>
              <Icon name="video" size={17} />
              {t('landing.noteCamera')}
            </li>
            <li>
              <Icon name="shield" size={17} />
              {t('landing.notePrivacy')}
            </li>
          </ul>
        </div>
        <div className="landing__art">
          <DemoSkeleton />
          <HeroArcs />
        </div>
      </section>

      {hasDataset && (
        <section className="landing__dataset sheet" aria-label={t('landing.savedDataset')}>
          <h2 className="landing__dataset-title">{t('landing.savedDataset')}</h2>
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
