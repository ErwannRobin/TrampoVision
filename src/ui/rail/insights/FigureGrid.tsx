import { cx, Stat } from '../../kit';
import { Fade } from './Fade';
import type { Figure } from './figures';

/** Four figures in a 2x2 grid, separated by hairlines rather than boxes. */
export function Figures({ jump, figures }: { jump: number; figures: Figure[] }) {
  return (
    <section className="ins-section">
      <Fade on={jump} className="ins-figs">
        {figures.map((f, i) => (
          <Stat
            key={f.key}
            className={cx('ins-fig', i % 2 === 1 && 'ins-fig--end', i >= 2 && 'ins-fig--low')}
            label={<span className="ins-fig__label">{f.label}</span>}
            value={
              f.missing ? (
                <span className="ins-fig__none">{f.value}</span>
              ) : f.word ? (
                <span className="ins-fig__word">{f.value}</span>
              ) : (
                f.value
              )
            }
            unit={f.unit}
            hint={<span className="ins-fig__hint">{f.hint}</span>}
          />
        ))}
      </Fade>
    </section>
  );
}
