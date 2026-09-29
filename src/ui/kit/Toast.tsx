import { Button } from './Button';

/** Work that runs in the background (an export): what it is, how far along, and a way to stop it. */
export function ActivityToast({
  label,
  progress,
  onCancel,
}: {
  label: string;
  /** 0..1; omit when unknown. */
  progress?: number;
  onCancel?: () => void;
}) {
  const pct = progress === undefined ? undefined : Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  return (
    <div className="toast" role="status" aria-live="polite">
      <div className="toast__body">
        <span className="toast__label">
          {label}
          {pct !== undefined && <span className="num muted"> {pct}%</span>}
        </span>
        {progress !== undefined && (
          <div className="meter">
            <div className="meter__fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}
