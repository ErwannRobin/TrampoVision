// Deletes files from the public Vercel Blob store (upload-assets.mjs never removes anything).
//
//   npm run remove-asset -- <name> [<name>...] [--dry-run]
//
// A name is a path in the store (models/pose_landmarker_lite.task) or, for a sample, its file name (synchro.mp4).
// A sample name without extension (IMG_8368) removes the whole clip: its .mp4 and its .MOV.
// Nothing is guessed beyond that: a name that matches nothing is an error and nothing is deleted.
// Removing a sample rewrites samples/index.json, so its button goes away within a minute.
import { del } from '@vercel/blob';
import { hasToken, listStore, writeSampleIndex } from './blob-store.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const names = args.filter((a) => !a.startsWith('--'));
if (!names.length) {
  console.error('usage: npm run remove-asset -- <path in the store | sample name> [...] [--dry-run]');
  process.exit(1);
}
if (!hasToken) {
  console.error('[remove] set BLOB_READ_WRITE_TOKEN (the read-write token of the Blob store)');
  process.exit(1);
}

const { blobs } = await listStore();
const targets = new Set();
const unknown = [];
for (const name of names) {
  const clip = [...blobs.keys()].filter(
    (p) => p.startsWith('samples/') && p.slice(0, p.lastIndexOf('.')) === `samples/${name}`,
  );
  const found = [name, `samples/${name}`].filter((p) => blobs.has(p) && p !== 'samples/index.json');
  const hits = found.length ? found : clip;
  if (!hits.length) unknown.push(name);
  for (const hit of hits) targets.add(hit);
}
if (unknown.length) {
  console.error(`[remove] not in the store: ${unknown.join(', ')}. Nothing deleted. In the store:`);
  for (const p of [...blobs.keys()].sort()) console.error(`  ${p}`);
  process.exit(1);
}

for (const pathname of targets) {
  console.log(
    `[remove] ${dryRun ? 'would delete' : 'deleting'} ${pathname} (${(blobs.get(pathname).size / 1e6).toFixed(1)} MB)`,
  );
}
if (dryRun) process.exit(0);

await del([...targets].map((p) => blobs.get(p).url));
if ([...targets].some((p) => p.startsWith('samples/'))) await writeSampleIndex('remove');
console.log(
  `[remove] done. Anything cached by a browser or the CDN (a year for the files) can outlive the delete for a while.`,
);
