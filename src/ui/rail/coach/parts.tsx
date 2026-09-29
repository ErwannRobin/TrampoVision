import type { ReactNode } from 'react';
import { DASH } from '../../format';
import { cx } from '../../kit';
import type { Figure, FigureRow, Glyph } from './figures';

/** The small pieces every tab of the coach's rail is made of: dense rows, groups with a quiet heading, limitations. */

/** Figures are set in condensed numerals; words keep the normal width. */
const isFigure = (value: string) => value === DASH || /^[+−-]?\d/.test(value);

function Reading({ figure }: { figure: Figure }) {
  return (
    <span className={cx('coach__fig', figure.muted && 'coach__fig--muted')}>
      <span className={isFigure(figure.value) ? 'num' : undefined}>{figure.value}</span>
      {figure.unit && <span className="coach__unit">{figure.unit}</span>}
    </span>
  );
}

interface RowProps {
  label: ReactNode;
  hint?: string;
  glyph?: Glyph;
  figures?: Figure[];
  /** Anything else on the right of the row (a badge). */
  children?: ReactNode;
}

/** One line of a dense list: the label at the left, the readings at the right. */
export function Row({ label, hint, glyph, figures = [], children }: RowProps) {
  return (
    <div className="coach__row">
      <dt className="coach__label">
        {label}
        {hint && <span className="coach__hint">{hint}</span>}
      </dt>
      <dd className="coach__val">
        {glyph && <span className={`coach__glyph coach__glyph--${glyph}`} aria-hidden="true" />}
        {figures.map((f, n) => (
          <Reading key={n} figure={f} />
        ))}
        {children}
      </dd>
    </div>
  );
}

/** The rows of a list, without the list around them (so that live rows can sit between them). */
export function RowList({ rows }: { rows: FigureRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <Row key={r.key} label={r.label} hint={r.hint} glyph={r.glyph} figures={r.figures} />
      ))}
    </>
  );
}

export function Rows({ rows }: { rows: FigureRow[] }) {
  return (
    <dl className="coach__rows">
      <RowList rows={rows} />
    </dl>
  );
}

/** A section of a tab: a quiet heading, an optional reading at its right, then its content. */
export function Group({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="coach__group">
      <div className="coach__gh">
        <h3 className="coach__heading">{title}</h3>
        {meta && <span className="coach__meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

interface Limit {
  signal: string;
  problem: string;
  needed?: string;
}

/** What could not be settled, one item after the other. The dashed edge says these are gaps, not facts. */
export function Limits({ items }: { items: Limit[] }) {
  return (
    <ul className="coach__limits">
      {items.map((l) => (
        <li key={l.signal + l.problem} className="coach__limit">
          <strong>{l.signal}.</strong> {l.problem}
          {l.needed && (
            <span className="coach__needed">
              <em>Needed:</em> {l.needed}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
