import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { ScaleSource } from '../../analysis/types';
import { POSE_ENGINES } from '../../pose/engines';
import type { ModelVariant, Point, PoseEngineId } from '../../pose/types';
import { t, useLocale } from '../../i18n';
import { setupState } from './setupState';
import { Button, Field, Icon, IconButton, NumberField, Segmented, SelectField, Switch, type IconName } from '../kit';
import { syncStatusText } from '../../sync/reviewSync';
import type { SyncState } from '../../sync/useReviewSync';
import type { Sample } from '../../video/sample';
import type { Appearance } from '../types';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** One line about the analysis ("12 jumps, 14.0 s"); empty before there is one. */
  clipDetail: string;
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
  /** Experimental: the pose model. MediaPipe unless another one was picked. */
  engine: PoseEngineId;
  onEngine: (engine: PoseEngineId) => void;
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
  /** Stopping a running analysis belongs to the overlay on the video, the one place that offers Cancel. */
  onAnalyze: () => void;

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
  /** The sample videos on offer: none when there is no asset host. */
  samples: Sample[];
  onSample: (path: string) => void;
  onOpenSeries: (file: File) => void;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
}

const models = (): { value: ModelVariant; label: string }[] => [
  { value: 'lite', label: t('setup.modelLite') },
  { value: 'full', label: t('setup.modelFull') },
  { value: 'heavy', label: t('setup.modelHeavy') },
];
const engines = (): { value: PoseEngineId; label: string }[] =>
  POSE_ENGINES.map((value) => ({ value, label: t(`setup.engine.${value}`) }));
const strides = () => [
  { value: 1, label: t('setup.stride1') },
  { value: 2, label: t('setup.stride2') },
  { value: 3, label: t('setup.stride3') },
  { value: 4, label: t('setup.stride4') },
];
const people = () => [
  { value: 0, label: t('setup.peopleAuto') },
  ...[1, 2, 3].map((n) => ({ value: n, label: String(n) })),
];
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

const actionText = () => ({ analyze: t('setup.analyze'), again: t('setup.again') }) as const;

/** One of the three parts of the dialog: what it is about, who it applies to, then its controls. */
function Group({ icon, title, text, children }: { icon: IconName; title: string; text: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings__group" aria-labelledby={id}>
      <header className="settings__group-head">
        <span className="settings__group-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <div>
          <h3 className="settings__group-title" id={id}>
            {title}
          </h3>
          <p className="settings__group-text">{text}</p>
        </div>
      </header>
      <div className="settings__group-body">{children}</div>
    </section>
  );
}

/** A labelled block of controls inside a group. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings__block" aria-labelledby={id}>
      <h4 className="settings__label" id={id}>
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * The settings, as a popup over the app (the whole screen on a phone). Three parts that never mix:
 *  - this video: the clip that is open, its trampoline and the button that analyzes it (only when a clip is open);
 *  - video analysis: how any video is measured and analyzed (athlete, engine). Height and scale change a finished analysis at
 *    once; the engine settings need a new analysis;
 *  - app: the look and the optional tools. Nothing here changes an analysis. (The language is the top bar's menu.)
 *
 * While the live view analyzes, the popup shrinks to the height and the review upload, the two settings that can still reach
 * the running analysis (`onlyWhatStillApplies`): the rest is left out, not disabled.
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { calibration: cal, open, onClose } = props;
  useLocale(); // the dialog is made of messages: it is drawn again when the language changes
  const state = setupState({
    busy: props.busy,
    hasVideo: props.hasVideo,
    hasResult: props.hasResult,
    advanced: props.advanced,
  });
  const short = state.onlyWhatStillApplies;
  const marked = cal.corners.length === 4;
  const clip = props.hasVideo || props.hasResult;
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);

  const review = props.review && (
    <Block title={t('setup.review')}>
      <Switch checked={props.review.enabled} onChange={props.review.onEnabled} label={t('setup.reviewSwitch')} />
      <p className="settings__status">
        {t('setup.reviewText')} {syncStatusText(props.review.state, props.review.posted)}
      </p>
    </Block>
  );

  // The native dialog keeps the focus inside, closes on Escape and makes the app behind it inert.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start on the content, not on the close button: no stray focus ring, and the keyboard scrolls the settings.
      d.querySelector<HTMLElement>('.settings__body')?.focus({ preventScroll: true });
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="settings"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click that starts and ends on the backdrop closes it; a text selection dragged out of a field does not.
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {open && (
        <div className="settings__panel">
          <header className="settings__head">
            <h2 className="settings__title" id={titleId}>
              {t('setup.title')}
            </h2>
            <IconButton icon="close" label={t('setup.close')} tip={false} onClick={onClose} />
          </header>

          <div className="settings__body" tabIndex={-1}>
            {clip && !short && (
              <Group icon="video" title={t('setup.groupVideo')} text={t('setup.groupVideoText')}>
                <div className="settings__clip">
                  <p className="settings__clip-name" title={props.fileName ?? undefined}>
                    {props.fileName ?? t('setup.noName')}
                  </p>
                  <p className="settings__clip-detail">{props.clipDetail || t('setup.notAnalyzed')}</p>
                </div>

                {state.action && (
                  <div className="settings__action">
                    {state.hint && <p className="settings__hint">{state.hint}</p>}
                    <Button
                      variant={state.action === 'analyze' ? 'primary' : 'secondary'}
                      size="lg"
                      block
                      disabled={state.actionDisabled}
                      onClick={props.onAnalyze}
                    >
                      {actionText()[state.action]}
                    </Button>
                  </div>
                )}

                {props.advanced && (
                  <>
                    <Block title={t('setup.trampoline')}>
                      <p className={cal.error ? 'settings__status settings__status--error' : 'settings__status'}>
                        {cal.status}
                      </p>
                      <div className="settings__buttons">
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
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!state.canMark}
                            onClick={props.onClearCalibration}
                          >
                            {t('setup.clear')}
                          </Button>
                        )}
                      </div>
                      <div className="settings__grid">
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
                    </Block>

                    <Block title={t('setup.videoInfo')}>
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
                      <dl className="settings__runtime">
                        <div>
                          <dt>{t('setup.runtime')}</dt>
                          <dd>{props.backend || t('setup.notStarted')}</dd>
                        </div>
                        <div>
                          <dt>{t('setup.webgpu')}</dt>
                          <dd>{props.webgpu ? t('setup.webgpuYes') : t('setup.webgpuNo')}</dd>
                        </div>
                      </dl>
                    </Block>
                  </>
                )}
              </Group>
            )}

            <Group
              icon="sliders"
              title={t('setup.groupAnalysis')}
              text={short ? t('setup.analyzingNote') : t('setup.groupAnalysisText')}
            >
              <Block title={t('setup.athlete')}>
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
              </Block>

              {props.advanced && (
                <Block title={t('setup.analysis')}>
                  <SelectField
                    label={t('setup.metersFrom')}
                    value={cal.scaleSource}
                    options={scales()}
                    disabled={state.calibrationLocked}
                    onChange={props.onScaleSource}
                  />
                  {props.engine === 'mediapipe' && (
                    <SelectField
                      label={t('setup.model')}
                      value={props.model}
                      options={models()}
                      disabled={state.engineLocked}
                      onChange={props.onModel}
                    />
                  )}
                  <div className="settings__grid">
                    <SelectField
                      label={t('setup.stride')}
                      value={props.stride}
                      options={strides()}
                      disabled={state.engineLocked}
                      onChange={props.onStride}
                    />
                    <SelectField
                      label={t('setup.people')}
                      value={props.numPoses}
                      options={people()}
                      disabled={state.engineLocked}
                      onChange={props.onNumPoses}
                    />
                  </div>
                  <Switch
                    checked={props.preferGpu}
                    onChange={props.onPreferGpu}
                    disabled={state.engineLocked}
                    label={t('setup.gpu')}
                  />
                </Block>
              )}

              {props.advanced && (
                <Block title={t('setup.experimental')}>
                  <SelectField
                    label={t('setup.engine')}
                    value={props.engine}
                    options={engines()}
                    disabled={state.engineLocked}
                    onChange={props.onEngine}
                    hint={t('setup.engineHint')}
                  />
                </Block>
              )}
              {short && review}
            </Group>

            {!short && (
              <Group icon="gear" title={t('setup.groupApp')} text={t('setup.groupAppText')}>
                <Block title={t('setup.appearance')}>
                  <Segmented<Appearance>
                    ariaLabel={t('setup.appearance')}
                    fill
                    value={props.appearance}
                    onChange={props.onAppearance}
                    options={appearances().map((a) => ({ ...a }))}
                  />
                </Block>

                <Block title={t('setup.advanced')}>
                  <Switch checked={props.advanced} onChange={props.onAdvanced} label={t('setup.advancedSwitch')} />
                  <p className="settings__status">{t('setup.advancedText')}</p>
                </Block>

                {review}

                {props.advanced && (
                  <Block title={t('setup.savedData')}>
                    <Field label={t('setup.skipAnalysis')} hint={t('setup.skipHint')}>
                      <label className="btn btn--secondary settings__file-btn">
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
                    {props.samples.map((sample) => (
                      <Button
                        key={sample.id}
                        variant="secondary"
                        icon="film"
                        disabled={state.engineLocked}
                        onClick={() => props.onSample(sample.path)}
                      >
                        {t(sample.label)}
                      </Button>
                    ))}
                  </Block>
                )}
              </Group>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
