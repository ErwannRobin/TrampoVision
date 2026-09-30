import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

/**
 * Fallback for files the browser cannot decode (typically iPhone HEVC .mov in desktop Chrome):
 * re-encode to H.264 MP4 with ffmpeg.wasm, entirely in the browser. The runtime files are bundled by Vite as
 * same-origin assets (only fetched when a conversion is needed, so they cost nothing until used).
 * Software decoding in WebAssembly is slow (roughly real time or slower), hence the progress callback.
 */

/** Analysis does not need more resolution than this; smaller output converts and decodes faster. */
const MAX_HEIGHT = 720;

export interface TranscodeOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const clockSeconds = (m: RegExpExecArray) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);

export async function transcodeToH264(file: File, opts: TranscodeOptions = {}): Promise<Blob> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  opts.signal?.addEventListener('abort', abort);
  try {
    // ffmpeg's own `progress` event stays at 0 for some inputs (HEVC .mov with rotation metadata), so the
    // log lines ("Duration: ..." once, then "time=..." per update) are read too. The bar only moves forward.
    let duration = 0;
    let best = 0;
    const report = (fraction: number) => {
      if (!Number.isFinite(fraction) || fraction <= best) return;
      best = Math.min(1, fraction);
      opts.onProgress?.(best);
    };
    ffmpeg.on('progress', ({ progress }) => report(progress));
    ffmpeg.on('log', ({ message }) => {
      const total = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
      if (total) duration = clockSeconds(total);
      const now = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
      if (now && duration > 0) report(clockSeconds(now) / duration);
    });
    await ffmpeg.load({ coreURL, wasmURL });
    await ffmpeg.writeFile('input', new Uint8Array(await file.arrayBuffer()));
    const code = await ffmpeg.exec([
      '-i',
      'input',
      '-vf',
      `scale=-2:min(${MAX_HEIGHT}\\,ih)`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '15',
      '-an',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
    if (code !== 0) throw new Error(`ffmpeg failed to convert the video (exit code ${code}).`);
    const data = await ffmpeg.readFile('out.mp4');
    if (typeof data === 'string') throw new Error('ffmpeg returned no video data.');
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
  } catch (err) {
    if (opts.signal?.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    ffmpeg.terminate();
  }
}
