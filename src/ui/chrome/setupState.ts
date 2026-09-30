import { t } from '../../i18n/core';

export type Busy = 'idle' | 'loading' | 'analyzing';

export interface SetupInputs {
  busy: Busy;
  hasVideo: boolean;
  hasResult: boolean;
}

export interface SetupState {
  /** Model, frame rate, stride, people and GPU wait for whatever is running: a change would not reach it. */
  engineLocked: boolean;
  /** Bed size and scale apply live to a finished analysis, so only a running analysis holds them. */
  calibrationLocked: boolean;
  /** Corners are placed on the video: it has to be there, and nothing may be running on it. */
  canMark: boolean;
  /** The one primary action: start, start again over a result, or stop. */
  action: 'analyze' | 'again' | 'cancel';
  actionDisabled: boolean;
  /** Why the action is off, in words; null when it is available. */
  hint: string | null;
}

/** Which settings and which action are available in each state of the app. */
export function setupState({ busy, hasVideo, hasResult }: SetupInputs): SetupState {
  const analyzing = busy === 'analyzing';
  const base = {
    engineLocked: busy !== 'idle',
    calibrationLocked: analyzing,
    canMark: hasVideo && !analyzing,
  };
  if (analyzing) return { ...base, action: 'cancel', actionDisabled: false, hint: null };

  const action = hasResult ? 'again' : 'analyze';
  if (busy === 'loading') return { ...base, action, actionDisabled: true, hint: t('setup.hintLoading') };
  if (!hasVideo) {
    const hint = hasResult ? t('setup.hintOpenVideo') : t('setup.hintChoose');
    return { ...base, action, actionDisabled: true, hint };
  }
  return { ...base, action, actionDisabled: false, hint: null };
}
