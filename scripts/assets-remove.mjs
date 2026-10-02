// Deletes a whole kind of asset from the public Vercel Blob store, after a confirmation (one file: asset-remove.mjs).
//
//   npm run assets-remove                          asks what to remove
//   npm run assets-remove -- videos                the sample videos (.mp4, .MOV), not their saved analysis
//   npm run assets-remove -- samples               the sample videos and their saved analysis (.pose.json)
//   npm run assets-remove -- models                models/ (pose models)
//   npm run assets-remove -- wasm                  mediapipe/, ffmpeg/ and ort/ (the wasm runtimes)
//   npm run assets-remove -- all                   everything
//   add --yes to skip the confirmation, --dry-run to only list what would go
//
// Removing samples rewrites samples/index.json, so their buttons go away within a minute.
import { createInterface } from 'node:readline/promises';
import { deleteFromStore, hasToken, listStore } from './blob-store.mjs';

const groups = {
  videos: ['the sample videos only (samples/*.mp4, *.MOV)', (p) => /^samples\/.+\.(mp4|mov)$/i.test(p)],
  samples: [
    'the sample videos and their saved analysis (samples/)',
    (p) => p.startsWith('samples/') && p !== 'samples/index.json',
  ],
  models: ['the models (models/)', (p) => p.startsWith('models/')],
  wasm: ['the wasm runtimes (mediapipe/, ffmpeg/, ort/)', (p) => /^(mediapipe|ffmpeg|ort)\//.test(p)],
  all: ['everything', (p) => p !== 'samples/index.json'],
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes');
let group = args.find((a) => !a.startsWith('--'));
if (!hasToken) {
  console.error('[remove] set BLOB_READ_WRITE_TOKEN (the read-write token of the Blob store)');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q).then((a) => a.trim().toLowerCase());
const quit = (code, msg) => {
  if (msg) console.error(msg);
  rl.close();
  process.exit(code);
};

if (group && !groups[group]) quit(1, `[remove] unknown "${group}". Choose one of: ${Object.keys(groups).join(', ')}`);
if (!group) {
  const names = Object.keys(groups);
  names.forEach((n, i) => console.log(`  ${i + 1}) ${n.padEnd(8)} ${groups[n][0]}`));
  group = names[Number(await ask('What to remove? (number, empty to cancel) ')) - 1];
  if (!group) quit(0, '[remove] cancelled');
}

const { blobs } = await listStore();
const targets = new Set([...blobs.keys()].filter(groups[group][1]));
if (!targets.size) quit(0, `[remove] nothing to remove for "${group}"`);

const size = [...targets].reduce((sum, p) => sum + blobs.get(p).size, 0);
console.log(`[remove] ${targets.size} file(s), ${(size / 1e6).toFixed(1)} MB: ${groups[group][0]}`);
if (!dryRun && !yes && (await ask('Delete them for good? (yes/no) ')) !== 'yes')
  quit(0, '[remove] cancelled, nothing deleted');
rl.close();
await deleteFromStore(blobs, targets, dryRun);
