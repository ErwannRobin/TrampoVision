import type { CSSProperties } from 'react';
import { agrees, PREDICTED_COLUMNS, PREDICTED_TEXT, type Metrics } from '../../dataset/metrics';
import { TRUTH_TEXT } from '../../dataset/types';
import { t } from '../../i18n';
import { pct } from '../format';
import { cx } from '../kit';
import { heatStrength } from './logic';

const HEAD = 'review-cell review-cell--head';
const HEAD_NUM = `${HEAD} review-cell--num`;

/** Precision, recall and accuracy of each of the five classes, and the jumps labeled Unknown, which none of them count. */
export function PerClassTable({ metrics }: { metrics: Metrics }) {
  return (
    <div className="review-scroll" role="region" aria-label={t('table.perClass')} tabIndex={0}>
      <table className="review-table">
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              {t('table.class')}
            </th>
            <th scope="col" className={HEAD_NUM} title={t('table.samplesTitle')}>
              {t('table.samples')}
            </th>
            <th scope="col" className={HEAD_NUM} title={t('table.predictedTitle')}>
              {t('table.predicted')}
            </th>
            <th scope="col" className={HEAD_NUM} title={t('table.precisionTitle')}>
              {t('table.precision')}
            </th>
            <th scope="col" className={HEAD_NUM} title={t('table.recallTitle')}>
              {t('table.recall')}
            </th>
            <th scope="col" className={HEAD_NUM} title={t('table.accuracyTitle')}>
              {t('table.accuracy')}
            </th>
          </tr>
        </thead>
        <tbody>
          {metrics.perClass.map((c) => (
            <tr key={c.label}>
              <th scope="row" className="review-cell review-cell--row review-cell--nowrap">
                {TRUTH_TEXT[c.label]}
              </th>
              <td className="review-cell review-cell--num num">{c.support}</td>
              <td className="review-cell review-cell--num num">{c.predicted}</td>
              <td className="review-cell review-cell--num num">{pct(c.precision)}</td>
              <td className="review-cell review-cell--num num">
                {pct(c.recall)}
                {c.recallCi95 && (
                  <span className="review-cell__ci">
                    {' '}
                    ({pct(c.recallCi95.lo)}–{pct(c.recallCi95.hi)})
                  </span>
                )}
              </td>
              <td className="review-cell review-cell--num num">{pct(c.accuracyOneVsRest)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="review-cell review-cell--row review-cell--nowrap review-cell--muted">
              {TRUTH_TEXT.unknown}
            </th>
            <td className="review-cell review-cell--num review-cell--muted num">{metrics.samplesPerClass.unknown}</td>
            <td className="review-cell review-cell--muted" colSpan={4}>
              {t('table.unknownNote')}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Rows are what the person said, columns what the classifier said. A cell where they agree is tinted with `--ok`, one
 * where they differ with `--danger`; the stronger the tint, the more jumps. The words in the legend and the hidden text
 * in each cell say the same, so the color is never the only signal.
 */
export function ConfusionMatrix({ metrics }: { metrics: Metrics }) {
  const { rows, counts } = metrics.matrix;
  const maxCell = Math.max(1, ...counts.flat());
  return (
    <>
      <div className="review-scroll" role="region" aria-label={t('matrix.aria')} tabIndex={0}>
        <table className="review-table review-table--matrix">
          <caption className="sr-only">{t('matrix.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={`${HEAD} review-cell--nowrap`}>
                {t('matrix.youSaid')}
              </th>
              <th
                scope="colgroup"
                colSpan={PREDICTED_COLUMNS.length}
                className={`${HEAD} review-cell--center review-cell--group`}
              >
                {t('matrix.classifierSaid')}
              </th>
              <th scope="col" rowSpan={2} className={HEAD_NUM}>
                {t('matrix.total')}
              </th>
            </tr>
            <tr>
              {PREDICTED_COLUMNS.map((c) => (
                <th key={c} scope="col" className={`${HEAD} review-cell--center review-cell--column`}>
                  {PREDICTED_TEXT[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row}>
                <th scope="row" className="review-cell review-cell--row review-cell--nowrap">
                  {TRUTH_TEXT[row]}
                </th>
                {PREDICTED_COLUMNS.map((col, j) => {
                  const v = counts[i][j];
                  const good = agrees(row, col);
                  return (
                    <td
                      key={col}
                      className={cx(
                        'review-cell review-cell--center num',
                        v > 0 ? (good ? 'review-cell--agree' : 'review-cell--differ') : 'review-cell--zero',
                      )}
                      style={
                        v > 0
                          ? ({ '--strength': `${Math.round(heatStrength(v, maxCell) * 100)}%` } as CSSProperties)
                          : undefined
                      }
                    >
                      {v}
                      {v > 0 && <span className="sr-only">{good ? t('matrix.agrees') : t('matrix.differsSr')}</span>}
                    </td>
                  );
                })}
                <td className="review-cell review-cell--num review-cell--muted num">{metrics.samplesPerClass[row]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="review-legend">
        <li className="review-legend__item">
          <span className="review-legend__swatch review-legend__swatch--agree" aria-hidden="true" />
          {t('matrix.legendAgrees')}
        </li>
        <li className="review-legend__item">
          <span className="review-legend__swatch review-legend__swatch--differ" aria-hidden="true" />
          {t('matrix.legendDiffers')}
        </li>
        <li>{t('matrix.darker')}</li>
        <li>{t('matrix.unknownAgrees')}</li>
      </ul>
    </>
  );
}
