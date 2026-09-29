import { useMemo } from 'react';
import { FIG_ELEMENTS, elementById } from '../../skills/fig/elements';
import { Button, SelectField } from '../kit';

interface Props {
  /** The figure saved for this jump (an element id), or null. */
  figure: string | null;
  /** The element the classifier named, offered as a shortcut. */
  predicted: string | null;
  /** Labelled examples per element, over the whole dataset. */
  counts: ReadonlyMap<string, number>;
  disabled: boolean;
  onPick: (elementId: string | null) => void;
}

const NONE = '';

/**
 * Dataset mode: says which figure the jump really was, by picking an element of the table. A jump with a figure is saved as a
 * reference example: later jumps are compared with its trajectories, next to the expected movement of every element.
 */
export function FigurePicker({ figure, predicted, counts, disabled, onPick }: Props) {
  const options = useMemo(
    () => [
      { value: NONE, label: 'Not labelled' },
      ...FIG_ELEMENTS.map((e) => {
        const n = counts.get(e.id) ?? 0;
        return { value: e.id, label: n > 0 ? `${e.name} · ${n} ${n === 1 ? 'example' : 'examples'}` : e.name };
      }),
    ],
    [counts],
  );
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const predictedName = predicted ? elementById(predicted)?.name : undefined;
  return (
    <>
      <SelectField
        label="Which figure was it?"
        value={figure ?? NONE}
        options={options}
        disabled={disabled}
        onChange={(v) => onPick(v === NONE ? null : v)}
        hint="Saved as a reference example: the classifier compares later jumps with it."
      />
      <div className="review-label-foot">
        <p className="review-hint" role="status">
          {total} reference {total === 1 ? 'example' : 'examples'} saved on this computer.
        </p>
        <div className="review-actions">
          <Button size="sm" disabled={disabled || !predicted || predicted === figure} onClick={() => onPick(predicted)}>
            {predictedName ? `It was ${predictedName}` : 'Use the prediction'}
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled || !figure} onClick={() => onPick(null)}>
            Clear
          </Button>
        </div>
      </div>
    </>
  );
}
