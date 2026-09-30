import { t } from '../i18n/core';

/** Frame timing helpers shared by the analysis loop and the player. */

/** Time to seek to so the decoder shows frame `k` (middle of its interval avoids rounding errors). */
export const frameSeekTime = (k: number, fps: number) => (k + 0.5) / fps;

/** Frame index shown at `time`. Works for both seek targets (k+0.5) and playback times (~k). */
export const frameAtTime = (time: number, fps: number) => Math.max(0, Math.floor(time * fps + 0.25));

const LOAD_TIMEOUT_MS = 20000;

/** The decoder stopped answering to seeks: what to do about it is in the message. */
export class SeekTimeoutError extends Error {}

/** Frees the decoder and removes the hidden element created by `loadVideo`. */
export function disposeVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

/**
 * Loads a video into a hidden element and resolves once its size and duration are known. Never
 * waits forever: it rejects on a decode error, on a video without a decodable picture, and after
 * `timeoutMs`. The element sits in the page (invisible) because some browsers, e.g. Safari, do not
 * load or present frames for detached elements. Call `disposeVideo` when done.
 */
export function loadVideo(url: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    Object.assign(video.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });

    const readyEvents = ['loadedmetadata', 'loadeddata', 'canplay'];
    const cleanup = () => {
      clearTimeout(timer);
      readyEvents.forEach((name) => video.removeEventListener(name, onReady));
      video.removeEventListener('error', onError);
    };
    const fail = (message: string) => {
      cleanup();
      disposeVideo(video);
      reject(new Error(message));
    };
    const onReady = (e: Event) => {
      if (video.videoWidth > 0) {
        cleanup();
        resolve(video);
      } else if (e.type !== 'loadedmetadata') fail(t('err.unsupportedVideo')); // data is there but no picture
    };
    const onError = () => fail(t('err.unsupportedVideo'));
    const timer = setTimeout(
      () => fail(t('err.loadTimeout', { ready: video.readyState, network: video.networkState })),
      timeoutMs,
    );

    readyEvents.forEach((name) => video.addEventListener(name, onReady));
    video.addEventListener('error', onError);
    document.body.appendChild(video);
    video.src = url;
  });
}

const SEEK_ATTEMPT_MS = 2500;
const SEEK_ATTEMPTS = 3;

/** One seek attempt. Resolves on `seeked`, or by polling if the event was missed (seen on desktop Chrome). */
function seekOnce(video: HTMLVideoElement, time: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      clearInterval(poll);
      video.removeEventListener('seeked', onSeeked);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    const poll = setInterval(() => {
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.5 / 1000) done(true);
    }, 50);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

/**
 * Resolves once the decoder shows the frame at `time`. A stalled seek is retried: first by nudging
 * the playhead away and back (which forces the decoder to re-seek), so one lost event does not
 * abort a whole analysis.
 */
export async function seekTo(video: HTMLVideoElement, time: number, timeoutMs = SEEK_ATTEMPT_MS): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1e-6 && !video.seeking) return;
  for (let attempt = 0; attempt < SEEK_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const away = Math.max(0, time + (time > 0.5 ? -0.25 : 0.25));
      await seekOnce(video, away, timeoutMs);
    }
    if (await seekOnce(video, time, timeoutMs)) return;
  }
  throw new SeekTimeoutError(
    t('err.seekTimeout', {
      time: time.toFixed(3),
      attempts: SEEK_ATTEMPTS,
      ready: video.readyState,
      network: video.networkState,
      seeking: String(video.seeking),
      current: video.currentTime.toFixed(3),
    }),
  );
}

/**
 * True when the browser can really decode this video: seeking to a few points must present a frame.
 * Metadata loads even for codecs the browser cannot decode (HEVC in desktop Chrome), so this is what
 * tells the app to convert the file. Leaves the playhead at the start.
 */
export async function canDecode(video: HTMLVideoElement, timeoutMs = 3000): Promise<boolean> {
  try {
    for (const fraction of [0.3, 0.6, 0.9]) {
      if (!(await seekOnce(video, video.duration * fraction, timeoutMs))) return false;
    }
    return await seekOnce(video, 0, timeoutMs);
  } catch {
    return false;
  }
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240];

/**
 * Browsers don't expose the frame rate, so play the (muted) video briefly and measure the gap
 * between presented frames with requestVideoFrameCallback. Returns null when the API is missing,
 * playback is blocked or no frames arrive in time, so the caller can say the rate is a guess.
 * The result is snapped to common frame rates.
 */
export async function estimateFps(video: HTMLVideoElement, timeoutMs = 5000): Promise<number | null> {
  if (!('requestVideoFrameCallback' in video)) return null;
  const times: number[] = [];
  const wasMuted = video.muted;
  video.muted = true;
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
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
  const deltas = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((d) => d > 1e-4);
  if (deltas.length < 3) return null;
  deltas.sort((a, b) => a - b);
  const measured = 1 / deltas[Math.floor(deltas.length / 2)];
  const nearest = COMMON_FPS.reduce((best, f) => (Math.abs(f - measured) < Math.abs(best - measured) ? f : best));
  return Math.abs(nearest - measured) / nearest < 0.06 ? nearest : Math.round(measured * 100) / 100;
}
