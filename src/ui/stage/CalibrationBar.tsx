import { t } from '../../i18n';
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
    <div className="calbar" role="group" aria-label={t('calibration.group')}>
      <div className="calbar__steps" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < corners ? 'calbar__dot calbar__dot--set' : 'calbar__dot'} />
        ))}
      </div>
      <p className="calbar__text">{complete ? t('calibration.adjust') : t('calibration.click', { n: corners + 1 })}</p>
      <div className="calbar__actions">
        <Button variant="ghost" size="sm" disabled={corners === 0} onClick={onUndo}>
          {t('common.undo')}
        </Button>
        <Button variant="ghost" size="sm" disabled={corners === 0} onClick={onClear}>
          {t('common.clear')}
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  );
}
