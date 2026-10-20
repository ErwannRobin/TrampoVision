// Puts the videos of the Trampoline-AQA dataset in the library: the R2 bucket of the shared clips (EU), under `library/<id>.mp4`, plus
// `library/index.json`, the list of them with their titles, which the review Worker serves (worker/src/library.ts) and the app offers on
// its first screen. It goes through wrangler, so it needs `wrangler login` (or CLOUDFLARE_API_TOKEN) and no key of its own.
//
//   npm run library-upload                                  every video of video-sample/Trampoline-AQA
//   npm run library-upload -- --dir path/to/Trampoline-AQA  the dataset folder: Label.csv and Trampoline-AQA/<n>.mp4
//   npm run library-upload -- --dry-run                     list what would be uploaded, touch nothing
//   npm run library-upload -- --force                       also re-upload what the library already lists (by default it is skipped)
//   npm run library-upload -- --only 1,2,40                 only these video numbers
//
// The id of a video is the app's own (`videoIdOf`, src/dataset/videoId.ts), so the analysis the app makes of the downloaded file carries
// the id the library expects.
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './asset-store.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dir = flag('--dir') ?? join(root, 'video-sample', 'Trampoline-AQA');
const only = flag('--only')
  ?.split(',')
  .map((n) => Number(n));

const BUCKET = process.env.R2_SHARES_BUCKET || 'trampovision-shares';
const SAMPLE = 256 * 1024;

/** The same id as `videoIdOf` in the app: SHA-256 of `size:<bytes>:`, the first 256 KiB and the last 256 KiB, 12 hex digits. */
function videoIdOfBytes(bytes) {
  const head = bytes.subarray(0, SAMPLE);
  const tail = bytes.subarray(Math.max(0, bytes.length - SAMPLE));
  const hash = createHash('sha256').update(`size:${bytes.length}:`).update(head).update(tail).digest('hex');
  return `v-${hash.slice(0, 12)}`;
}

const decimal = (text) => {
  const n = Number(String(text).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const titleCase = (name) => name.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/** The rows of Label.csv by video number: `;` separated, a decimal comma. */
function readLabels(text) {
  const [head, ...rows] = text.split(/\r?\n/).filter(Boolean);
  const names = head.split(';');
  const labels = new Map();
  for (const row of rows) {
    const cells = row.split(';');
    const get = (name) => cells[names.indexOf(name)]?.trim() ?? '';
    const no = Number(cells[0]);
    if (!Number.isInteger(no)) continue;
    const competition = get('Trampoline Competition ID').replace(/_/g, ' ');
    const stage = get('Competition Stages');
    const athlete = titleCase(get('Name'));
    labels.set(no, {
      title: `${athlete} · ${competition} · ${stage}`,
      no,
      competition,
      stage,
      athlete,
      gender: get('Gender'),
      nation: get('Nation'),
      difficulty: decimal(get('Difficulty')),
      execution: decimal(get('Execution')),
      flight: decimal(get('Flight Time')),
      horizontal: decimal(get('Horizontal')),
      penalties: decimal(get('Penalties')),
      score: decimal(get('Score')),
      rank: decimal(get('Rank')),
    });
  }
  return labels;
}

function probe(file) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  const { streams, format } = JSON.parse(out);
  return {
    width: streams?.[0]?.width ?? null,
    height: streams?.[0]?.height ?? null,
    durationS: Number(format.duration),
  };
}

const wrangler = (...a) =>
  new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...a, '--remote', '--jurisdiction', 'eu'], {
      cwd: join(root, 'worker'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`wrangler ${a[0]} ${a[1]} failed: ${err || out}`)),
    );
  });

const labelFile = join(dir, 'Label.csv');
const videoDir = join(dir, 'Trampoline-AQA');
if (!existsSync(labelFile) || !existsSync(videoDir)) {
  console.error(`[library] ${dir} has no Label.csv and Trampoline-AQA/ folder (use --dir)`);
  process.exit(1);
}

/** What the library lists now: id -> entry. Empty before the first upload. */
async function readIndex() {
  try {
    const out = await wrangler('r2', 'object', 'get', `${BUCKET}/library/index.json`, '--pipe');
    return new Map(JSON.parse(out).clips.map((c) => [c.id, c]));
  } catch (e) {
    if (/does not exist|not found|10007|NoSuchKey/i.test(String(e))) return new Map();
    throw e;
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'library-'));
async function writeIndex(clips) {
  const file = join(scratch, 'index.json');
  writeFileSync(file, JSON.stringify({ clips: [...clips.values()].sort((a, b) => a.no - b.no) }));
  await wrangler(
    'r2',
    'object',
    'put',
    `${BUCKET}/library/index.json`,
    '--file',
    file,
    '--content-type',
    'application/json',
    '--cache-control',
    'no-cache',
  );
}

const labels = readLabels(readFileSync(labelFile, 'utf8'));
const numbers = [...labels.keys()].filter((n) => !only || only.includes(n)).sort((a, b) => a - b);
const listed = dryRun ? new Map() : await readIndex();
const clips = new Map(listed);
let uploaded = 0;
let skipped = 0;
let missing = 0;
let sinceIndex = 0;
const queue = [...numbers];

async function work() {
  for (let no = queue.shift(); no !== undefined; no = queue.shift()) {
    const file = join(videoDir, `${no}.mp4`);
    if (!existsSync(file)) {
      console.warn(`[library] ${no}.mp4 is not in ${videoDir}, skipped`);
      missing++;
      continue;
    }
    const bytes = readFileSync(file);
    const id = videoIdOfBytes(bytes);
    if (!force && listed.has(id)) {
      skipped++;
      continue;
    }
    const entry = { id, size: bytes.length, ...labels.get(no), ...probe(file) };
    console.log(
      `[library] ${dryRun ? 'would upload' : 'uploading'} library/${id}.mp4  ${(statSync(file).size / 1e6).toFixed(1)} MB  ${entry.title}`,
    );
    if (!dryRun) {
      await wrangler(
        'r2',
        'object',
        'put',
        `${BUCKET}/library/${id}.mp4`,
        '--file',
        file,
        '--content-type',
        'video/mp4',
        '--cache-control',
        'public, max-age=86400',
      );
      clips.set(id, entry);
      // Listed as they arrive: a run that stops half way leaves a library that works.
      if (++sinceIndex >= 20) {
        sinceIndex = 0;
        await writeIndex(clips);
      }
    }
    uploaded++;
  }
}

await Promise.all([work(), work(), work()]);
if (!dryRun && (sinceIndex > 0 || !listed.size)) await writeIndex(clips);
console.log(
  `[library] ${dryRun ? 'would upload' : 'uploaded'} ${uploaded}, already there ${skipped}${missing ? `, missing ${missing}` : ''}; the library lists ${clips.size}`,
);
