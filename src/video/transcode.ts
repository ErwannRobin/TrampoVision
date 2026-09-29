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

export async function transcodeToH264(file: File, opts: TranscodeOptions = {}): Promise<Blob> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  opts.signal?.addEventListener('abort', abort);
  try {
    ffmpeg.on('progress', ({ progress }) => {
      if (Number.isFinite(progress)) opts.onProgress?.(Math.min(1, Math.max(0, progress)));
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
