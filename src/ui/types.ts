/** UI state shared between the app shell and the parts of the interface. */

/** Who the interface speaks to: plain insights for the athlete, every measurement for the coach. */
export type Audience = 'athlete' | 'coach';

/** What the stage shows: the video, the video next to the 3D skeleton, or the 3D skeleton alone. */
export type StageView = 'video' | 'split' | '3d';

/** Sections of the coach's rail. */
export type CoachTab = 'skill' | 'metrics' | 'twist' | 'review' | 'classification' | 'data';

export type Appearance = 'system' | 'light' | 'dark';

export type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; stage: 'downloading' | 'reading' | 'measuring' | 'converting' | 'model'; progress?: number }
  | { kind: 'analyzing'; done: number; total: number }
  /** `severity: 'warning'` = the app carried on with a fallback and the user may want to check it. */
  | { kind: 'error'; message: string; severity?: 'warning' };
