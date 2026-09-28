/** Frame timing helpers shared by the analysis loop and the player. */

/** Time to seek to so the decoder shows frame `k` (middle of its interval avoids rounding errors). */
export const frameSeekTime = (k: number, fps: number) => (k + 0.5) / fps;

/** Frame index shown at `time`. Works for both seek targets (k+0.5) and playback times (~k). */
export const frameAtTime = (time: number, fps: number) => Math.max(0, Math.floor(time * fps + 0.25));

export function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => resolve(video);
    video.onerror = () =>
      reject(new Error('This browser cannot decode the video. Try an MP4 (H.264) file.'));
    video.src = url;
  });
}

/** Resolves once the decoder shows the frame at `time`. */
export function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 8000): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1e-6) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error(`Seek to ${time.toFixed(3)}s timed out`));
    }, timeoutMs);
    const onSeeked = () => {
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = time;
  });
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240];

/**
 * Browsers don't expose the frame rate, so play the (muted) video briefly and measure the gap
 * between presented frames with requestVideoFrameCallback. Falls back to `fallback` when the
 * API is missing or playback is blocked. The result is snapped to common frame rates.
 */
export async function estimateFps(video: HTMLVideoElement, fallback = 30): Promise<number> {
  if (!('requestVideoFrameCallback' in video)) return fallback;
  const times: number[] = [];
  const wasMuted = video.muted;
  video.muted = true;
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
        times.push(meta.mediaTime);
        if (times.length >= 14) {
          clearTimeout(timer);
          resolve();
        } else video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
      video.play().catch(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    video.pause();
    video.muted = wasMuted;
    video.currentTime = 0;
  }
  const deltas = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 1e-4);
  if (deltas.length < 3) return fallback;
  deltas.sort((a, b) => a - b);
  const measured = 1 / deltas[Math.floor(deltas.length / 2)];
  const nearest = COMMON_FPS.reduce((best, f) => (Math.abs(f - measured) < Math.abs(best - measured) ? f : best));
  return Math.abs(nearest - measured) / nearest < 0.06 ? nearest : Math.round(measured * 100) / 100;
}
