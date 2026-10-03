import type { PoseTrack } from '../analysis/types';

/** The clip the app shows: what a track made from its masked copy is measured against. */
export interface ClipFrame {
  width: number;
  height: number;
  sourceFps: number;
  /** Every how many frames of the clip the analysis looks at. */
  stride: number;
}

/**
 * The pose model reads the masked copy of the clip, which can be smaller than the clip (the encoder caps the size) and has only the frames
 * the analysis looks at. Its track is then put back on the clip: the landmarks in the clip's pixels (the skeleton lands on the athlete in the
 * picture that is shown) and the rates the clip has, as if the pose model had read the clip itself. Times and 3D landmarks are unchanged.
 */
export function fitTrackToClip(track: PoseTrack, clip: ClipFrame): PoseTrack {
  const sx = clip.width / track.width;
  const sy = clip.height / track.height;
  return {
    ...track,
    width: clip.width,
    height: clip.height,
    fps: clip.sourceFps / clip.stride,
    sourceFps: clip.sourceFps,
    frames: track.frames.map((frame) => frame && frame.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy }))),
  };
}
