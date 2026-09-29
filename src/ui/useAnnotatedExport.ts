import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { canExportVideo, exportAnnotatedVideo, saveBlob } from '../video/exportVideo';
import type { CalibrationDraw, OverlayOptions } from '../video/overlay';
import type { Playhead } from './playhead';

interface Args {
  url: string | null;
  fps: number;
  result: AnalysisResult | null;
  skills: SkillAnalysis | null;
  overlay: OverlayOptions;
  /** The bed outline is exported when it is visible. */
  calibration: CalibrationDraw | null;
  baseName: string;
  playhead: Playhead;
}

/** The annotated-video export, lifted out of the player so a menu can start it and a toast can show its progress. */
export function useAnnotatedExport(args: Args) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(args);
  latest.current = args;
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(async () => {
    const a = latest.current;
    if (!a.url || abort.current) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setError('');
    setProgress(0);
    a.playhead.pause();
    try {
      const blob = await exportAnnotatedVideo({
        url: a.url,
        fps: a.fps,
        result: a.result,
        skills: a.skills,
        overlay: a.overlay,
        calibration: a.calibration,
        signal: ctl.signal,
        onProgress: setProgress,
      });
      saveBlob(blob, `${a.baseName}-annotated.mp4`);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);
  const clearError = useCallback(() => setError(''), []);

  return { exporting: progress !== null, progress, error, clearError, start, cancel, available: canExportVideo() };
}
