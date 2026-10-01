import { t } from '../../i18n/core';

export type Busy = 'idle' | 'loading' | 'analyzing';

export interface SetupInputs {
  busy: Busy;
  hasVideo: boolean;
  hasResult: boolean;
  /** The advanced tools are on. */
  advanced: boolean;
}

export interface SetupState {
  /** Model, frame rate, stride, people and GPU wait for whatever is running: a change would not reach it. */
  engineLocked: boolean;
  /** Bed size and scale apply live to a finished analysis, so only a running analysis holds them. */
  calibrationLocked: boolean;
  /** Corners are placed on the video: it has to be there, and nothing may be running on it. */
  canMark: boolean;
  /**
   * The one primary action: start, or start again over a result. Null while analyzing: the stage's overlay is the one place
   * that stops an analysis, so the settings do not offer a second Cancel.
   */
  action: 'analyze' | 'again' | null;
  actionDisabled: boolean;
  /** Why the action is off, in words; null when it is available. */
  hint: string | null;
  /**
   * The live view, analysis running: the settings shrink to what can still reach the result, which is the athlete's height
   * (it only scales the finished analysis) and the review upload (it sends the jumps once they exist). The rest does nothing
   * for this analysis and is left out, not disabled.
   */
  onlyWhatStillApplies: boolean;
}

/** Which settings and which action are available in each state of the app. */
export function setupState({ busy, hasVideo, hasResult, advanced }: SetupInputs): SetupState {
  const analyzing = busy === 'analyzing';
  const base = {
    engineLocked: busy !== 'idle',
    calibrationLocked: analyzing,
    canMark: hasVideo && !analyzing,
    onlyWhatStillApplies: analyzing && !advanced,
  };
  if (analyzing) return { ...base, action: null, actionDisabled: false, hint: null };

  const action = hasResult ? 'again' : 'analyze';
  if (busy === 'loading') return { ...base, action, actionDisabled: true, hint: t('setup.hintLoading') };
  if (!hasVideo) {
    const hint = hasResult ? t('setup.hintOpenVideo') : t('setup.hintChoose');
    return { ...base, action, actionDisabled: true, hint };
  }
  return { ...base, action, actionDisabled: false, hint: null };
}
