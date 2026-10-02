// Deletes files from the public Vercel Blob store (assets-upload.mjs never removes anything).
//
//   npm run asset-remove -- <name> [<name>...] [--dry-run]
//
// A name is a path in the store (models/pose_landmarker_lite.task) or, for a sample, its file name (synchro.mp4).
// A sample name without extension (IMG_8368) removes the whole clip: its .mp4, its .MOV and its saved analysis (.pose.json).
// Nothing is guessed beyond that: a name that matches nothing is an error and nothing is deleted.
// Removing a sample rewrites samples/index.json, so its button goes away within a minute.
import { deleteFromStore, hasToken, listStore } from './blob-store.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const names = args.filter((a) => !a.startsWith('--'));
if (!names.length) {
  console.error('usage: npm run asset-remove -- <path in the store | sample name> [...] [--dry-run]');
  process.exit(1);
}
if (!hasToken) {
  console.error('[remove] set BLOB_READ_WRITE_TOKEN (the read-write token of the Blob store)');
  process.exit(1);
}

// samples/IMG_8368.mp4, samples/IMG_8368.MOV and samples/IMG_8368.pose.json are one clip
const clipOf = (pathname) => pathname.replace(/(\.pose\.json|\.[^./]+)$/, '');

const { blobs } = await listStore();
const targets = new Set();
const unknown = [];
for (const name of names) {
  const clip = [...blobs.keys()].filter((p) => p.startsWith('samples/') && clipOf(p) === `samples/${name}`);

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

await deleteFromStore(blobs, targets, dryRun);
