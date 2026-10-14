/**
 * Runs the experimental motion detector over a real clip, offline, and says what it found: one line a second, a summary (how often an
 * athlete was found, how wide the box is, how much of the picture is kept), and a contact sheet with the box drawn on the frames.
 *   make motion-eval FILE=clip.mp4                      the lines and the summary
 *   make motion-eval FILE=clip.mp4 SHEET=boxes.png      also the sheet, a frame every 3 s (EVERY=1 for every second, 16 frames at most)
 *   make motion-eval FILE=clip.mp4 CONFIG='{"maxAthletes":2}'
 * The clip is decoded with ffmpeg (which must be installed) the way the page reads it: made 128 pixels wide, gray, averaged down. The
 * detector's thresholds were first tuned on synthetic scenes; this is how a change is checked on footage before it is kept.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { TrampolineMotionDetector } from '../src/motion/detector';
import type { MotionConfig } from '../src/motion/config';
import { formatSeconds, formatSummary, summarize, type FrameRow } from '../src/motion/report';
import { workSize } from '../src/motion/pixels';

const args = process.argv.slice(2);
const valued = new Set(['--sheet', '--every', '--config']);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
if (!file) {
  console.error('usage: motion-eval <clip.mp4> [--sheet boxes.png] [--every seconds] [--config json]');
  process.exit(2);
}
const config: Partial<MotionConfig> = flag('--config') ? JSON.parse(flag('--config')!) : {};
const workWidth = config.workWidth ?? new TrampolineMotionDetector().config.workWidth;

/** The size and frame rate of the clip as it is shown, from ffprobe: a phone clip stored sideways with a rotation tag is turned, as ffmpeg and the browser turn it. */
function probe(path: string): { width: number; height: number; fps: number } {
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

/** Every frame of the clip as a gray picture `width` × `height`, 8 bits a pixel, decoded the way the page reads a video: supersampled and averaged down. */
function decode(path: string, width: number, height: number): Uint8Array {
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      path,
      '-vf',
      `scale=${3 * width}:${3 * height}:flags=lanczos,scale=${width}:${height}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      '-',
    ],
    { maxBuffer: 1 << 30 },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  return new Uint8Array(result.stdout);
}

const clip = probe(file);
const size = workSize(clip.width, clip.height, workWidth);
const bytes = decode(file, size.width, size.height);
const n = size.width * size.height;
const frames = Math.floor(bytes.length / n);
const detector = new TrampolineMotionDetector(config);
const data = new Float32Array(n);
const rows: FrameRow[] = [];
const started = Date.now();
for (let k = 0; k < frames; k++) {
  for (let i = 0; i < n; i++) data[i] = bytes[k * n + i] / 255;
  const r = detector.push({ width: size.width, height: size.height, data }, Math.round((k / clip.fps) * 1000));
  rows.push({
    t: k / clip.fps,
    found: r.found,
    box: r.athletes[0] ? { ...r.athletes[0] } : null,
    type: r.camera.type,
    coverage: r.coverage,
    periodS: r.periodS,
  });
}
const ms = (Date.now() - started) / Math.max(1, frames);

console.log(
  `${file}: ${clip.width} × ${clip.height}, ${clip.fps.toFixed(2)} fps, read as ${size.width} × ${size.height}`,
);
console.log(formatSeconds(rows).join('\n'));
console.log(`${formatSummary(summarize(rows))}; ${ms.toFixed(1)} ms a frame`);

const sheet = flag('--sheet');
if (sheet) {
  const every = Number(flag('--every') ?? 3);
  const picks: number[] = [];
  for (let second = 0; second <= rows[rows.length - 1].t && picks.length < 16; second += every) {
    picks.push(Math.min(frames - 1, Math.round(second * clip.fps)));
  }
  const scale = 640 / size.width;
  const filters = picks.flatMap((k) => {
    const b = rows[k].box;
    if (!b) return [];
    const x = Math.round(b.x0 * scale);
    const y = Math.round(b.y0 * scale);
    const w = Math.round((b.x1 - b.x0 + 1) * scale);
    const h = Math.round((b.y1 - b.y0 + 1) * scale);
    return [`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=yellow@0.9:thickness=4:enable='eq(n\\,${k})'`];
  });
  const select = `select='${picks.map((k) => `eq(n\\,${k})`).join('+')}'`;
  const cols = 4;
  const vf = [
    `scale=640:-2`,
    ...filters,
    select,
    `scale=320:-2`,
    `tile=${cols}x${Math.ceil(picks.length / cols)}`,
  ].join(',');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', vf, '-frames:v', '1', sheet]);
  console.log(`sheet: ${sheet} (${picks.length} frames, one every ${every} s)`);
}
