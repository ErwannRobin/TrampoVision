import { frameAtTime } from '../video/frames';
import type { AnalysisResult } from './types';

/** Analysis sample that corresponds to the video time (nearest analyzed frame). */
export function sampleIndexAt(meta: AnalysisResult['meta'], time: number): number {
  const stride = meta.sourceFps / meta.fps;
  const idx = Math.round(frameAtTime(time, meta.sourceFps) / stride);
  return Math.min(Math.max(idx, 0), meta.count - 1);
}
