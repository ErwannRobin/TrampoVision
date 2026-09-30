import type { ScaleSource } from '../../analysis/types';
import type { ModelVariant, Point } from '../../pose/types';
import { LANGUAGE_NAMES, LOCALES, setLocale, t, useLocale } from '../../i18n';
import { setupState } from '../chrome/setupState';
import { Button, Field, Icon, NumberField, Segmented, SelectField, Switch } from '../kit';
import { syncStatusText } from '../../sync/reviewSync';
import type { SyncState } from '../../sync/useReviewSync';
import type { Locale } from '../../i18n';
import type { Appearance } from '../types';

export interface SetupPanelProps {
  /** Present when the app has a review service to send the analyzed jumps to. */
  review?: { enabled: boolean; onEnabled: (on: boolean) => void; state: SyncState; posted: number };
  /** The advanced tools are on: the trampoline outline, the analysis engine and the saved data. Off, only what a coach needs on the trampoline. */
  advanced: boolean;
  onAdvanced: (on: boolean) => void;
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

const models = (): { value: ModelVariant; label: string }[] => [
  { value: 'lite', label: t('setup.modelLite') },
  { value: 'full', label: t('setup.modelFull') },
  { value: 'heavy', label: t('setup.modelHeavy') },
];
const strides = () => [
  { value: 1, label: t('setup.stride1') },
  { value: 2, label: t('setup.stride2') },
  { value: 3, label: t('setup.stride3') },
  { value: 4, label: t('setup.stride4') },
];
const PEOPLE = [1, 2, 3].map((n) => ({ value: n, label: String(n) }));
const sides = () => [
  { value: 'long' as const, label: t('setup.sideLong') },
  { value: 'short' as const, label: t('setup.sideShort') },
];
const scales = (): { value: ScaleSource | 'auto'; label: string }[] => [
  { value: 'auto', label: t('setup.scaleAuto') },
  { value: 'trampoline', label: t('setup.scaleBed') },
  { value: 'athlete', label: t('setup.scaleAthlete') },
];
const appearances = () =>
  [
    { value: 'system', label: t('setup.appearanceSystem') },
    { value: 'light', label: t('setup.appearanceLight') },
    { value: 'dark', label: t('setup.appearanceDark') },
  ] as const;

const actionText = () =>
  ({ analyze: t('setup.analyze'), again: t('setup.again'), cancel: t('common.cancel') }) as const;

/**
 * The settings page of the rail, and where a new video is set up: the athlete, the trampoline, the analysis engine.
 * Height and the bed change a finished analysis at once; the engine settings need a new analysis.
 */
export function SetupPanel(props: SetupPanelProps) {
  const { calibration: cal } = props;
  const locale = useLocale();
  const state = setupState({ busy: props.busy, hasVideo: props.hasVideo, hasResult: props.hasResult });
  const marked = cal.corners.length === 4;

  return (
    <div className="setup">
      <header className="setup__head">
        <div className="setup__heading">
          <h2 className="setup__title">{t('setup.title')}</h2>
          {props.fileName && (
            <p className="setup__file" title={props.fileName}>
              {props.fileName}
            </p>
          )}
        </div>
        {props.onClose && (
          <Button variant="secondary" size="sm" onClick={props.onClose}>
            {t('setup.done')}
          </Button>
        )}
      </header>

      <section className="setup__section" aria-labelledby="setup-athlete">
        <h3 className="setup__label" id="setup-athlete">
          {t('setup.athlete')}
        </h3>
        <NumberField
          label={t('setup.height')}
          unit="m"
          min={1}
          max={2.3}
          step={0.01}
          value={props.height}
          onChange={props.onHeight}
          hint={t('setup.heightHint')}
        />
      </section>

      {props.review && (
        <section className="setup__section" aria-labelledby="setup-review">
          <h3 className="setup__label" id="setup-review">
            {t('setup.review')}
          </h3>
          <Switch checked={props.review.enabled} onChange={props.review.onEnabled} label={t('setup.reviewSwitch')} />
          <p className="setup__status">
            {t('setup.reviewText')} {syncStatusText(props.review.state, props.review.posted)}
          </p>
        </section>
      )}

      <section className="setup__section" aria-labelledby="setup-advanced">
        <h3 className="setup__label" id="setup-advanced">
          {t('setup.advanced')}
        </h3>
        <Switch checked={props.advanced} onChange={props.onAdvanced} label={t('setup.advancedSwitch')} />
        <p className="setup__status">{t('setup.advancedText')}</p>
      </section>

      {props.advanced && (
        <>
          <section className="setup__section" aria-labelledby="setup-bed">
            <h3 className="setup__label" id="setup-bed">
              {t('setup.trampoline')}
            </h3>
            <p className={cal.error ? 'setup__status setup__status--error' : 'setup__status'}>{cal.status}</p>
            <div className="setup__buttons">
              {cal.editing ? (
                <>
                  <Button variant="primary" size="sm" onClick={() => props.onEditCalibration(false)}>
                    {t('setup.doneMarking')}
                  </Button>
                  <Button size="sm" disabled={cal.corners.length === 0} onClick={props.onUndoCorner}>
                    {t('setup.undoCorner')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  icon="bed"
                  disabled={!state.canMark}
                  title={state.canMark ? undefined : t('setup.chooseFirst')}
                  onClick={() => props.onEditCalibration(true)}
                >
                  {marked ? t('setup.editCorners') : t('setup.markBed')}
                </Button>
              )}
              {cal.corners.length > 0 && (
                <Button variant="ghost" size="sm" disabled={!state.canMark} onClick={props.onClearCalibration}>
                  {t('setup.clear')}
                </Button>
              )}
            </div>
            <div className="setup__grid">
              <NumberField
                label={t('setup.longSide')}
                unit="m"
                min={0.5}
                max={10}
                step={0.01}
                value={cal.bedLong}
                disabled={state.calibrationLocked}
                onChange={props.onBedLong}
              />
              <NumberField
                label={t('setup.shortSide')}
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
              label={t('setup.firstSide')}
              value={cal.firstSide}
              options={sides()}
              disabled={state.calibrationLocked}
              onChange={props.onFirstSide}
            />
            <SelectField
              label={t('setup.metersFrom')}
              value={cal.scaleSource}
              options={scales()}
              disabled={state.calibrationLocked}
              onChange={props.onScaleSource}
            />
          </section>

          <section className="setup__section" aria-labelledby="setup-engine">
            <h3 className="setup__label" id="setup-engine">
              {t('setup.analysis')}
            </h3>
            <SelectField
              label={t('setup.model')}
              value={props.model}
              options={models()}
              disabled={state.engineLocked}
              onChange={props.onModel}
            />
            <div className="setup__grid">
              <NumberField
                label={t('setup.fps')}
                unit="fps"
                min={1}
                max={480}
                step={0.001}
                value={props.fps}
                disabled={state.engineLocked}
                onChange={props.onFps}
                hint={t('setup.fpsHint')}
              />
              <SelectField
                label={t('setup.stride')}
                value={props.stride}
                options={strides()}
                disabled={state.engineLocked}
                onChange={props.onStride}
              />
            </div>
            <SelectField
              label={t('setup.people')}
              value={props.numPoses}
              options={PEOPLE}
              disabled={state.engineLocked}
              onChange={props.onNumPoses}
            />
            <Switch
              checked={props.preferGpu}
              onChange={props.onPreferGpu}
              disabled={state.engineLocked}
              label={t('setup.gpu')}
            />
            <dl className="setup__runtime">
              <div>
                <dt>{t('setup.runtime')}</dt>
                <dd>{props.backend || t('setup.notStarted')}</dd>
              </div>
              <div>
                <dt>{t('setup.webgpu')}</dt>
                <dd>{props.webgpu ? t('setup.webgpuYes') : t('setup.webgpuNo')}</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      <section className="setup__section" aria-labelledby="setup-look">
        <h3 className="setup__label" id="setup-look">
          {t('setup.appearance')}
        </h3>
        <Segmented<Appearance>
          ariaLabel={t('setup.appearance')}
          fill
          value={props.appearance}
          onChange={props.onAppearance}
          options={appearances().map((a) => ({ ...a }))}
        />
      </section>

      <section className="setup__section" aria-labelledby="setup-language">
        <h3 className="setup__label" id="setup-language">
          {t('setup.language')}
        </h3>
        <Segmented<Locale>
          ariaLabel={t('setup.language')}
          fill
          value={locale}
          onChange={setLocale}
          options={LOCALES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }))}
        />
      </section>

      {props.advanced && (
        <section className="setup__section" aria-labelledby="setup-data">
          <h3 className="setup__label" id="setup-data">
            {t('setup.savedData')}
          </h3>
          <Field label={t('setup.skipAnalysis')} hint={t('setup.skipHint')}>
            <label className="btn btn--secondary setup__file-btn">
              <Icon name="file" size={17} />
              {t('setup.openSaved')}
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
              {t('setup.sample')}
            </Button>
          )}
        </section>
      )}

      <div className="setup__action">
        {state.hint && <p className="setup__hint">{state.hint}</p>}
        <Button
          variant={state.action === 'analyze' ? 'primary' : 'secondary'}
          size="lg"
          block
          disabled={state.actionDisabled}
          onClick={state.action === 'cancel' ? props.onCancel : props.onAnalyze}
        >
          {actionText()[state.action]}
        </Button>
      </div>
    </div>
  );
}
