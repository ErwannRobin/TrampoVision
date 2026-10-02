/** What is known of a clip, from its saved analysis or from the video file itself. */
export interface ClipIdentity {
  /** The id of the video (see dataset/videoId); an athlete's `#2` suffix does not count. Absent in older files. */
  videoId?: string;
  width: number;
  height: number;
  /** Null when the length is not known. */
  durationS: number | null;
}

/** A saved analysis stops a frame or so before the end of the clip: this much of a difference is still the same clip. */
const DURATION_TOLERANCE_S = 1.5;

const clipId = (id: string | undefined) => id?.replace(/#\d+$/, '');

/**
 * Whether a saved analysis and a video are the same clip: `same` when their ids are, `different` when the ids (both made from a
 * video file) or the picture size or length tell them apart, `unknown` when the file does not say enough (an older analysis).
 */
export function matchClip(series: ClipIdentity, video: ClipIdentity): 'same' | 'different' | 'unknown' {
  const a = clipId(series.videoId);
  const b = clipId(video.videoId);
  // Ids made from the data of a series (`s-`) are no video's id: only the ones of video files (`v-`) are compared.
  if (a?.startsWith('v-') && b?.startsWith('v-')) return a === b ? 'same' : 'different';
  if (series.width && video.width && (series.width !== video.width || series.height !== video.height))
    return 'different';
  if (
    series.durationS !== null &&
    video.durationS !== null &&
    Math.abs(series.durationS - video.durationS) > DURATION_TOLERANCE_S
  )
    return 'different';
  return 'unknown';
}
