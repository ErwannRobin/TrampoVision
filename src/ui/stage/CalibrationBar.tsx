import { Button } from '../kit';

export interface CalibrationBarProps {
  /** Corners clicked so far, 0 to 4. */
  corners: number;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}

/** The instruction bar shown on the stage while the four corners of the bed are being set. */
export function CalibrationBar({ corners, onUndo, onClear, onDone }: CalibrationBarProps) {
  const complete = corners >= 4;
  return (
    <div className="calbar" role="group" aria-label="Mark the trampoline">
      <div className="calbar__steps" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < corners ? 'calbar__dot calbar__dot--set' : 'calbar__dot'} />
        ))}
      </div>
      <p className="calbar__text">
        {complete
          ? 'Drag a corner to adjust it, then press Done.'
          : `Click corner ${corners + 1} of 4, going around the bed. Scrub the video first if the bed is hidden.`}
      </p>
      <div className="calbar__actions">
        <Button variant="ghost" size="sm" disabled={corners === 0} onClick={onUndo}>
          Undo
        </Button>
        <Button variant="ghost" size="sm" disabled={corners === 0} onClick={onClear}>
          Clear
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
