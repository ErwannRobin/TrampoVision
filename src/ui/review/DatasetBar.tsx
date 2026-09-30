import { useState } from 'react';
import { download } from '../../analysis/export';
import { toDatasetCsv, toDatasetJson } from '../../dataset/export';
import type { DatasetApi } from '../../dataset/useDataset';
import { t, tp, tx } from '../../i18n';
import { Button, Disclosure, Icon } from '../kit';
import { datasetMeta, summarizeDataset } from './logic';

export interface DatasetBarProps {
  dataset: DatasetApi;
  baseName: string;
  onSaveAll?: () => void;
  saveCount?: number;
  canSave?: boolean;
}

/** Counts, save, export, import and delete of the dataset stored in this browser. Closed until it is needed. */
export function DatasetBar({ dataset, baseName, onSaveAll, saveCount, canSave }: DatasetBarProps) {
  const [message, setMessage] = useState('');
  const summary = summarizeDataset(dataset.records);
  const empty = summary.jumps === 0;
  const onImport = async (f: File) => {
    try {
      const { added, updated, kept } = await dataset.importText(await f.text());
      setMessage(t('dataset.imported', { added, updated, kept }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const storage =
    dataset.kind === 'indexeddb'
      ? t('dataset.indexeddb')
      : dataset.kind === 'memory'
        ? t('dataset.memory')
        : t('dataset.opening');

  return (
    <div className="review-dataset">
      {/* Outside the disclosure: labels that are not being stored is something to know before labeling. */}
      {dataset.warning && <p className="review-warning">{dataset.warning}</p>}
      {dataset.error && (
        <p className="review-warning review-warning--error" role="alert">
          {dataset.error}
        </p>
      )}
      <Disclosure title={t('dataset.title')} meta={datasetMeta(summary)}>
        <div className="review-dataset__body">
          <p className="review-dataset__summary">
            {tx('dataset.summary', {
              jumps: <span className="num">{tp('count.jumps', summary.jumps)}</span>,
              videos: <span className="num">{tp('count.videos', summary.videos)}</span>,
              labeled: <span className="num">{summary.labeled}</span>,
            })}
          </p>
          <p className="review-note">{storage}</p>
          <div className="review-dataset__actions">
            {onSaveAll && (
              <Button size="sm" icon="plus" disabled={!canSave} onClick={onSaveAll} title={t('dataset.saveTitle')}>
                {saveCount !== undefined
                  ? t('dataset.saveAllCount', { jumps: tp('count.jumps', saveCount) })
                  : t('dataset.saveAll')}
              </Button>
            )}
            <Button
              size="sm"
              icon="download"
              disabled={empty}
              onClick={() => download(`${baseName}-dataset.json`, toDatasetJson(dataset.records), 'application/json')}
            >
              {t('dataset.json')}
            </Button>
            <Button
              size="sm"
              icon="download"
              disabled={empty}
              onClick={() => download(`${baseName}-dataset.csv`, toDatasetCsv(dataset.records), 'text/csv')}
            >
              {t('dataset.csv')}
            </Button>
            <label className="btn btn--secondary btn--sm review-file">
              <Icon name="upload" size={15} />
              {t('dataset.import')}
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = '';
                }}
              />
            </label>
            <Button
              className="review-dataset__delete"
              variant="danger"
              size="sm"
              icon="trash"
              disabled={empty}
              onClick={() =>
                window.confirm(tp('dataset.deleteConfirm', dataset.records.length)) && void dataset.clear()
              }
            >
              {t('dataset.delete')}
            </Button>
          </div>
          {message && (
            <p className="review-note" role="status">
              {message}
            </p>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
