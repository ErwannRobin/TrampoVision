/**
 * Checks the choice of the jumper on a real clip: runs the real pose model (MediaPipe, CPU delegate) over the clip in a headless
 * Chrome, keeps what it found in a cache file, replays the `JumperSelector` over it, and says per second whom it chose — plus a
 * contact sheet with the chosen person's box drawn (yellow) and everybody else's (red), to see with one's eyes that the choice is
 * the jumper and not the spotter.
 *   make pose-eval FILE=clip.mp4                              the lines and the summary
 *   make pose-eval FILE=clip.mp4 SHEET=chosen.png EVERY=2     also the sheet, a frame every 2 s (16 at most)
 *   make pose-eval FILE=clip.mp4 CACHE=clip.poses.json        keep the model's output; a second run replays the choice without the model
 *   make pose-eval FILE=clip.mp4 ATHLETES=2                   a synchro clip
 *   make pose-eval FILE=clip.mp4 ZOOM=1                       the pose model reads a zoomed view of the athlete's box (withMotionMask view.zoom)
 *   make pose-eval FILE=clip.mp4 MASKED=1                     what the app reads: the clip is first run through the motion detector
 *                                                             and rendered with the background hidden (`renderMaskedVideo`), in the browser
 * Needs ffmpeg (the sheet), Google Chrome and `npm i --no-save playwright-core` (the capture; a warm cache needs neither Chrome nor
 * playwright). The model runs at RATE (default 15) frames a second; POSES (default 5) people are looked for, as the app does.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JumperSelector } from '../src/motion/jumperSelect';
import type { EvalFrame, EvalPerson, PoseEvalCapture } from '../src/motion/debug/poseEvalRun';
import type { Signature } from '../src/pose/appearance';
import { LM, LANDMARK_COUNT } from '../src/pose/landmarks';
import type { PoseDetection } from '../src/pose/types';
import { probe } from './clip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const valued = new Set(['--sheet', '--every', '--rate', '--poses', '--athletes', '--cache', '--max', '--model']);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
if (!file) {
  console.error(
    'usage: pose-eval <clip.mp4> [--sheet chosen.png] [--every seconds] [--rate hz] [--poses n] [--athletes n] [--cache file.json] [--max seconds]',
  );
  process.exit(2);
}
const rateHz = Number(flag('--rate') ?? 15);
const numPoses = Number(flag('--poses') ?? 5);
const maxAthletes = Number(flag('--athletes') ?? 1);
const maxS = flag('--max') ? Number(flag('--max')) : undefined;
const cachePath = flag('--cache');
const masked = args.includes('--masked');
const model = flag('--model') ?? 'full';
const zoom = args.includes('--zoom');
const gpu = args.includes('--gpu');
const focused = args.includes('--focused');
const rotate = args.includes('--rotate');
// Replay the choice without the clothes, to measure what they add on the same capture.
const noLooks = args.includes('--no-looks');

/** The model's output over the clip: from the cache when one is given and filled, else from a headless Chrome run (and into the cache). */
async function captureOrCache(): Promise<PoseEvalCapture> {
  if (cachePath && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as PoseEvalCapture;
    if (cached.rateHz === rateHz && cached.numPoses === numPoses && cached.model === model) return cached;
    console.error(`[pose-eval] the cache was made at another rate or pose count; capturing again`);
  }
  const capture = await captureInBrowser();
  if (cachePath) writeFileSync(cachePath, JSON.stringify(capture));
  return capture;
}

/** Runs the pose model over the clip in a headless Chrome served by the dev server, and brings the rows back. */
async function captureInBrowser(): Promise<PoseEvalCapture> {
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('[pose-eval] playwright-core is missing: run `npm i --no-save playwright-core`');
    process.exit(1);
  }
  // The browser cannot read a file of the disk: the clip is copied under the repo, where the dev server serves it.
  const servedDir = join(root, 'node_modules', '.pose-eval');
  mkdirSync(servedDir, { recursive: true });
  const servedName = `clip${extname(file!) || '.mp4'}`;
  copyFileSync(file!, join(servedDir, servedName));
  const port = 5191;
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: root,
    // No asset host: the models come from public/, not downloaded again by each fresh headless browser.
    env: { ...process.env, VITE_REVIEW_API_URL: '', VITE_REVIEW_INGEST_TOKEN: '', VITE_ASSET_BASE_URL: '' },
    stdio: 'ignore',
  });
  const stop = () => {
    server.kill();
    rmSync(servedDir, { recursive: true, force: true });
  };
  process.on('exit', stop);
  for (let i = 0; ; i++) {
    if (
      await fetch(`http://localhost:${port}`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (i > 60) throw new Error('the dev server did not start');
    await new Promise((r) => setTimeout(r, 500));
  }
  const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.text().startsWith('[pose-eval]')) console.log(msg.text());
    });
    await page.goto(`http://localhost:${port}/motion.html`);
    return await page.evaluate(
      async ({ url, options, maskFirst, sourceFps }) => {
        // A plain `import(...)` here would be rewritten by vite-node before the function is sent to the browser.
        const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>;
        let source = url;
        if (maskFirst) {
          const { renderMaskedVideo } = (await load('/src/motion/resultVideo.ts')) as {
            renderMaskedVideo: (o: object) => Promise<{ blob: Blob; hidden: number; frames: number }>;
          };
          const rendered = await renderMaskedVideo({
            url,
            sourceFps,
            stride: 1,
            onProgress: (done: number, total: number) => {
              if (done % 150 === 0) console.log(`[pose-eval] masking ${done} of ${total} frames...`);
            },
          });
          console.log(`[pose-eval] masked video: hidden in ${rendered.hidden} of ${rendered.frames} frames`);
          source = URL.createObjectURL(rendered.blob);
        }
        const { runPoseEval } = (await load('/src/motion/debug/poseEvalRun.ts')) as {
          runPoseEval: (u: string, o: object) => Promise<PoseEvalCapture>;
        };
        return runPoseEval(source, {
          ...options,
          onProgress: (atS: number) => console.log(`[pose-eval] ${atS.toFixed(0)} s into the clip...`),
        });
      },
      {
        url: `/node_modules/.pose-eval/${servedName}`,
        options: { rateHz, numPoses, maxS, zoom, rotate, model, preferGpu: gpu, focused },
        maskFirst: masked,
        sourceFps: probe(file!).fps,
      },
    );
  } finally {
    await browser.close();
    stop();
  }
}

/** The person as the selector reads one: the hips and the torso are what it measures, the rest of the landmarks say nothing. */
function toDetection(p: EvalPerson): PoseDetection {
  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x: p.x, y: p.y, visibility: 0 }));
  landmarks[LM.L_HIP] = landmarks[LM.R_HIP] = { x: p.x, y: p.y, visibility: 1 };
  landmarks[LM.L_SHOULDER] = landmarks[LM.R_SHOULDER] = { x: p.x, y: p.y - p.torso, visibility: 1 };
  return { landmarks };
}

interface Row {
  frame: EvalFrame;
  /** The people the selector chose; null while it does not know (the app would fall back on the motion box). */
  chosen: EvalPerson[] | null;
}

/** The clothes of a captured person, as the selector reads them. */
function toSignature(p: EvalPerson): Signature | null {
  return p.look ? { torso: p.look.t, legs: p.look.l } : null;
}

/** Replays the choice of the jumper over the captured frames. */
function replay(capture: PoseEvalCapture): Row[] {
  const selector = new JumperSelector(maxAthletes);
  return capture.frames.map((frame) => {
    const people = frame.people.map(toDetection);
    const looks = noLooks ? [] : frame.people.map(toSignature);
    const chosen = selector.push(people, frame.t, looks);
    return { frame, chosen: chosen === null ? null : chosen.map((c) => frame.people[people.indexOf(c)]) };
  });
}

function report(capture: PoseEvalCapture, rows: Row[]): void {
  console.log(
    `${file}: ${capture.width} × ${capture.height}, read at ${capture.rateHz} frames a second, ${capture.backend}, ${capture.frames.length} frames`,
  );
  for (let second = 0; second < capture.durationS; second++) {
    const row = rows.find((r) => r.frame.t >= second);
    if (!row) break;
    const people = `${row.frame.people.length} ${row.frame.people.length === 1 ? 'person' : 'people'}`;
    const chosen =
      row.chosen === null
        ? 'does not know yet (motion box decides)'
        : row.chosen.length === 0
          ? 'athlete not seen this frame'
          : row.chosen.map((p) => `athlete at x=${p.x.toFixed(2)} y=${p.y.toFixed(2)}`).join(', ');
    console.log(`${String(second).padStart(3)} s  ${people.padEnd(10)} ${chosen}`);
  }
  const seen = rows.filter((r) => r.frame.people.length > 0);
  const answered = rows.filter((r) => r.chosen !== null);
  const chosenOne = rows.filter((r) => r.chosen !== null && r.chosen.length >= 1);
  const xs = chosenOne.flatMap((r) => r.chosen!.map((p) => p.x));
  const swaps = chosenOne.filter(
    (r, i) =>
      i > 0 && chosenOne[i - 1].chosen!.length && Math.abs(r.chosen![0].x - chosenOne[i - 1].chosen![0].x) > 0.2,
  ).length;
  const pct = (part: number, whole: number) => `${Math.round((100 * part) / Math.max(1, whole))}%`;
  console.log(
    `somebody found ${pct(seen.length, rows.length)}; choice made ${pct(answered.length, rows.length)}; ` +
      `athlete seen ${pct(chosenOne.length, rows.length)}; ` +
      `athlete x ${xs.length ? `${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)}` : '—'}; ` +
      `${swaps} jumps of the choice across the picture`,
  );
}

/** A contact sheet with the chosen person boxed in yellow and everybody else in red, one frame every `--every` seconds. */
function sheet(capture: PoseEvalCapture, rows: Row[], out: string): void {
  const every = Number(flag('--every') ?? 3);
  const clip = probe(file!);
  const display = 640;
  const scaleX = display;
  const scaleY = Math.round((display * capture.height) / capture.width);
  const picks: Row[] = [];
  for (let second = 0; second <= rows[rows.length - 1].frame.t && picks.length < 16; second += every) {
    const row = rows.find((r) => r.frame.t >= second);
    if (row) picks.push(row);
  }
  const box = (p: EvalPerson, n: number, color: string) => {
    const x = Math.round(p.x0 * scaleX);
    const y = Math.round(p.y0 * scaleY);
    const w = Math.max(2, Math.round((p.x1 - p.x0) * scaleX));
    const h = Math.max(2, Math.round((p.y1 - p.y0) * scaleY));
    return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:thickness=3:enable='eq(n\\,${n})'`;
  };
  const filters = picks.flatMap((row) => {
    const n = Math.round(row.frame.t * clip.fps);
    const chosen = new Set(row.chosen ?? []);
    return row.frame.people.map((p) => box(p, n, chosen.has(p) ? 'yellow@0.9' : 'red@0.7'));
  });
  const select = `select='${picks.map((row) => `eq(n\\,${Math.round(row.frame.t * clip.fps)})`).join('+')}'`;
  const cols = 4;
  const vf = [
    `scale=${display}:-2`,
    ...filters,
    select,
    `scale=320:-2`,
    `tile=${cols}x${Math.ceil(picks.length / cols)}`,
  ].join(',');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file!, '-vf', vf, '-frames:v', '1', out]);
  console.log(`sheet: ${out} (${picks.length} frames, one every ${every} s; yellow the chosen, red the others)`);
}

const capture = await captureOrCache();
const rows = replay(capture);
report(capture, rows);
const out = flag('--sheet');
if (out) sheet(capture, rows, out);
process.exit(0);
