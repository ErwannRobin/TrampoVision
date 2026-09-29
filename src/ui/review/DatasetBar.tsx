import { useState } from 'react';
import { download } from '../../analysis/export';
import { toDatasetCsv, toDatasetJson } from '../../dataset/export';
import type { DatasetApi } from '../../dataset/useDataset';
import { plural } from '../format';
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
      setMessage(`Imported: ${added} added, ${updated} updated, ${kept} kept (already newer here).`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const storage =
    dataset.kind === 'indexeddb'
      ? 'Stored in this browser only (IndexedDB). Nothing is uploaded.'
      : dataset.kind === 'memory'
        ? 'Kept in memory only.'
        : 'Opening the local database…';

  return (
    <div className="review-dataset">
      {/* Outside the disclosure: labels that are not being stored is something to know before labeling. */}
      {dataset.warning && <p className="review-warning">{dataset.warning}</p>}
      {dataset.error && (
        <p className="review-warning review-warning--error" role="alert">
          {dataset.error}
        </p>
      )}
      <Disclosure title="Dataset on this computer" meta={datasetMeta(summary)}>
        <div className="review-dataset__body">
          <p className="review-dataset__summary">
            <span className="num">{summary.jumps}</span> {plural(summary.jumps, 'jump')} from{' '}
            <span className="num">{summary.videos}</span> {plural(summary.videos, 'video')},{' '}
            <span className="num">{summary.labeled}</span> labeled.
          </p>
          <p className="review-note">{storage}</p>
          <div className="review-dataset__actions">
            {onSaveAll && (
              <Button
                size="sm"
                icon="plus"
                disabled={!canSave}
                onClick={onSaveAll}
                title="Stores every detected jump of this video, with its measurements and prediction"
              >
                Save all{saveCount !== undefined && ` ${saveCount} ${plural(saveCount, 'jump')}`}
              </Button>
            )}
            <Button
              size="sm"
              icon="download"
              disabled={empty}
              onClick={() => download(`${baseName}-dataset.json`, toDatasetJson(dataset.records), 'application/json')}
            >
              Dataset JSON
            </Button>
            <Button
              size="sm"
              icon="download"
              disabled={empty}
              onClick={() => download(`${baseName}-dataset.csv`, toDatasetCsv(dataset.records), 'text/csv')}
            >
              Dataset CSV
            </Button>
            <label className="btn btn--secondary btn--sm review-file">
              <Icon name="upload" size={15} />
              Import dataset…
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
                window.confirm(
                  `Delete all ${dataset.records.length} saved jumps and their labels from this browser? Export first if you want to keep them.`,
                ) && void dataset.clear()
              }
            >
              Delete all…
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
