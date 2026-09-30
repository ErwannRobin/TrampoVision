import type { ScaleSource } from '../../analysis/types';
import type { ModelVariant, Point } from '../../pose/types';
import { setupState } from '../chrome/setupState';
import { Button, Field, Icon, NumberField, Segmented, SelectField, Switch } from '../kit';
import { syncStatusText } from '../../sync/reviewSync';
import type { SyncState } from '../../sync/useReviewSync';
import type { Appearance } from '../types';

export interface SetupPanelProps {
  /** Present when the app has a review service to send the analyzed jumps to. */
  review?: { enabled: boolean; onEnabled: (on: boolean) => void; state: SyncState; posted: number };
  hasVideo: boolean;
  hasResult: boolean;
  /** What the app is doing now; controls are locked while it works. */
  busy: 'idle' | 'loading' | 'analyzing';
  fileName: string | null;

  // Analysis engine
  model: ModelVariant;
  onModel: (model: ModelVariant) => void;
  numPoses: number;
  onNumPoses: (n: number) => void;
  /** Analyze every n-th frame. */
  stride: number;
  onStride: (n: number) => void;
  preferGpu: boolean;
  onPreferGpu: (value: boolean) => void;
  fps: number;
  onFps: (fps: number) => void;
  /** Runtime of the pose model once analysis ran ('' before). */
  backend: string;
  /** The browser exposes WebGPU (MediaPipe still uses WebGL or WASM). */
  webgpu: boolean;
  onAnalyze: () => void;
  onCancel: () => void;

  // Athlete
  height: number;
  onHeight: (meters: number) => void;

  // Trampoline calibration
  calibration: {
    corners: Point[];
    editing: boolean;
    bedLong: number;
    bedShort: number;
    firstSide: 'long' | 'short';
    scaleSource: ScaleSource | 'auto';
    /** One sentence about the state of the calibration (or what to do next). */
    status: string;
    /** `status` is an error. */
    error: boolean;
  };
  onEditCalibration: (editing: boolean) => void;
  onUndoCorner: () => void;
  onClearCalibration: () => void;
  onBedLong: (meters: number) => void;
  onBedShort: (meters: number) => void;
  onFirstSide: (side: 'long' | 'short') => void;
  onScaleSource: (source: ScaleSource | 'auto') => void;

  // Data and look
  /** Null when no sample video is bundled. */
  onSample: (() => void) | null;
  onOpenSeries: (file: File) => void;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
  /** Back to the insights (only when there is a result). */
  onClose?: () => void;
}

const MODELS: { value: ModelVariant; label: string }[] = [
  { value: 'lite', label: 'Lite (fast)' },
  { value: 'full', label: 'Full' },
  { value: 'heavy', label: 'Heavy (most accurate)' },
];
const STRIDES = [
  { value: 1, label: 'Every frame' },
  { value: 2, label: 'Every 2nd frame' },
  { value: 3, label: 'Every 3rd frame' },
  { value: 4, label: 'Every 4th frame' },
];
const PEOPLE = [1, 2, 3].map((n) => ({ value: n, label: String(n) }));
const SIDES = [
  { value: 'long' as const, label: 'long side' },
  { value: 'short' as const, label: 'short side' },
];
const SCALES: { value: ScaleSource | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto (the bed if it is marked)' },
  { value: 'trampoline', label: 'The bed' },
  { value: 'athlete', label: "The athlete's height" },
];
const APPEARANCES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const ACTION_TEXT = { analyze: 'Analyze video', again: 'Analyze again', cancel: 'Cancel' } as const;

/**
 * The settings page of the rail, and where a new video is set up: the athlete, the trampoline, the analysis engine.
 * Height and the bed change a finished analysis at once; the engine settings need a new analysis.
 */
export function SetupPanel(props: SetupPanelProps) {
  const { calibration: cal } = props;
  const state = setupState({ busy: props.busy, hasVideo: props.hasVideo, hasResult: props.hasResult });
  const marked = cal.corners.length === 4;

  return (
    <div className="setup">
      <header className="setup__head">
        <div className="setup__heading">
          <h2 className="setup__title">Settings</h2>
          {props.fileName && (
            <p className="setup__file" title={props.fileName}>
              {props.fileName}
            </p>
          )}
        </div>
        {props.onClose && (
          <Button variant="secondary" size="sm" onClick={props.onClose}>
            Done
          </Button>
        )}
      </header>

      <section className="setup__section" aria-labelledby="setup-athlete">
        <h3 className="setup__label" id="setup-athlete">
          Athlete
        </h3>
        <NumberField
          label="Height"
          unit="m"
          min={1}
          max={2.3}
          step={0.01}
          value={props.height}
          onChange={props.onHeight}
          hint="Scales the measurements in meters when the trampoline is not marked."
        />
      </section>

      {props.review && (
        <section className="setup__section" aria-labelledby="setup-review">
          <h3 className="setup__label" id="setup-review">
            Review
          </h3>
          <Switch
            checked={props.review.enabled}
            onChange={props.review.onEnabled}
            label="Send analyzed jumps for review"
          />
          <p className="setup__status">
            Measurements and the answer of the classifier, so a person can check it. No video and no file name leave
            this browser. {syncStatusText(props.review.state, props.review.posted)}
          </p>
        </section>
      )}

      <section className="setup__section" aria-labelledby="setup-bed">
        <h3 className="setup__label" id="setup-bed">
          Trampoline
        </h3>
        <p className={cal.error ? 'setup__status setup__status--error' : 'setup__status'}>{cal.status}</p>
        <div className="setup__buttons">
          {cal.editing ? (
            <>
              <Button variant="primary" size="sm" onClick={() => props.onEditCalibration(false)}>
                Done marking
              </Button>
              <Button size="sm" disabled={cal.corners.length === 0} onClick={props.onUndoCorner}>
                Undo last corner
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              icon="bed"
              disabled={!state.canMark}
              title={state.canMark ? undefined : 'Choose a video first.'}
              onClick={() => props.onEditCalibration(true)}
            >
              {marked ? 'Edit corners' : 'Mark the trampoline'}
            </Button>
          )}
          {cal.corners.length > 0 && (
            <Button variant="ghost" size="sm" disabled={!state.canMark} onClick={props.onClearCalibration}>
              Clear
            </Button>
          )}
        </div>
        <div className="setup__grid">
          <NumberField
            label="Long side"
            unit="m"
            min={0.5}
            max={10}
            step={0.01}
            value={cal.bedLong}
            disabled={state.calibrationLocked}
            onChange={props.onBedLong}
          />
          <NumberField
            label="Short side"
            unit="m"
            min={0.5}
            max={10}
            step={0.01}
            value={cal.bedShort}
            disabled={state.calibrationLocked}
            onChange={props.onBedShort}
          />
        </div>
        <SelectField
          label="Side 1 to 2 is the"
          value={cal.firstSide}
          options={SIDES}
          disabled={state.calibrationLocked}
          onChange={props.onFirstSide}
        />
        <SelectField
          label="Meters from"
          value={cal.scaleSource}
          options={SCALES}
          disabled={state.calibrationLocked}
          onChange={props.onScaleSource}
        />
      </section>

      <section className="setup__section" aria-labelledby="setup-engine">
        <h3 className="setup__label" id="setup-engine">
          Analysis
        </h3>
        <SelectField
          label="Model"
          value={props.model}
          options={MODELS}
          disabled={state.engineLocked}
          onChange={props.onModel}
        />
        <div className="setup__grid">
          <NumberField
            label="Video frame rate"
            unit="fps"
            min={1}
            max={480}
            step={0.001}
            value={props.fps}
            disabled={state.engineLocked}
            onChange={props.onFps}
            hint="Measured from the video. Changing it clears the analysis."
          />
          <SelectField
            label="Analyze"
            value={props.stride}
            options={STRIDES}
            disabled={state.engineLocked}
            onChange={props.onStride}
          />
        </div>
        <SelectField
          label="People to look for"
          value={props.numPoses}
          options={PEOPLE}
          disabled={state.engineLocked}
          onChange={props.onNumPoses}
        />
        <Switch
          checked={props.preferGpu}
          onChange={props.onPreferGpu}
          disabled={state.engineLocked}
          label="Use the GPU if possible"
        />
        <dl className="setup__runtime">
          <div>
            <dt>Runtime</dt>
            <dd>{props.backend || 'not started'}</dd>
          </div>
          <div>
            <dt>WebGPU</dt>
            <dd>
              {props.webgpu
                ? 'available in this browser, but MediaPipe uses WebGL (GPU delegate) or WASM (CPU)'
                : 'not available'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="setup__section" aria-labelledby="setup-look">
        <h3 className="setup__label" id="setup-look">
          Appearance
        </h3>
        <Segmented<Appearance>
          ariaLabel="Appearance"
          fill
          value={props.appearance}
          onChange={props.onAppearance}
          options={APPEARANCES.map((a) => ({ ...a }))}
        />
      </section>

      <section className="setup__section" aria-labelledby="setup-data">
        <h3 className="setup__label" id="setup-data">
          Saved data
        </h3>
        <Field
          label="Skip the analysis"
          hint="Open a saved analysis (JSON) to see its results without running the pose model again."
        >
          <label className="btn btn--secondary setup__file-btn">
            <Icon name="file" size={17} />
            Open saved analysis
            <input
              type="file"
              accept="application/json,.json"
              disabled={props.busy === 'analyzing'}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) props.onOpenSeries(f);
                e.target.value = '';
              }}
            />
          </label>
        </Field>
        {props.onSample && (
          <Button variant="secondary" icon="film" disabled={state.engineLocked} onClick={props.onSample}>
            Use the sample video
          </Button>
        )}
      </section>

      <div className="setup__action">
        {state.hint && <p className="setup__hint">{state.hint}</p>}
        <Button
          variant={state.action === 'analyze' ? 'primary' : 'secondary'}
          size="lg"
          block
          disabled={state.actionDisabled}
          onClick={state.action === 'cancel' ? props.onCancel : props.onAnalyze}
        >
          {ACTION_TEXT[state.action]}
        </Button>
      </div>
    </div>
  );
}
