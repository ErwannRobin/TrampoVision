import { execFileSync } from 'node:child_process';

/**
 * The size and frame rate of a clip as it is shown, from ffprobe: a phone clip stored sideways with a rotation tag is turned, as
 * ffmpeg and the browser turn it.
 */
export function probe(path: string): { width: number; height: number; fps: number } {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate:stream_side_data=rotation',
    '-of',
    'default=nw=1:nk=1',
    path,
  ])
    .toString()
    .trim()
    .split('\n');
  const [num, den] = out[2].split('/').map(Number);
  const rotation = Math.abs(Number(out[3] ?? 0)) % 180;
  const sideways = rotation === 90;
  return {
    width: Number(sideways ? out[1] : out[0]),
    height: Number(sideways ? out[0] : out[1]),
    fps: num / (den || 1),
  };
}
