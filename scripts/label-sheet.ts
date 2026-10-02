/**
 * Makes what a person needs to label real jumps, from a dataset JSON saved by the app (or the review service's export):
 *   make eval-label-sheet FILE=eval/dong-dong.dataset.json VIDEO=video-sample/dong-dong-2011-landscape.mp4
 *
 * For every video in the file it writes, under `eval/sheets/` (`--out`): a markdown sheet and a CSV (one line per jump: times, the app's
 * guess, the measured rotation) and, with `--video`, a shell script with one ffmpeg command per jump that makes a filmstrip of the flight
 * (`--strips` runs it). It also creates `eval/labels/<videoId>.json` (`--labels`) with a blank entry per jump, or adds blank entries for
 * the jumps a label file does not have yet. Labels already written are never touched.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { APEX_TOLERANCE_S, blankLabel, blankLabelFile, parseLabelFile, type LabelFile } from '../src/eval/labels';
import { parseLabelled } from '../src/eval/replay';
import { filmstripArgs, filmstripCommand, sheetCsv, sheetMarkdown, sheetRows, stripPath } from '../src/eval/sheet';

const args = process.argv.slice(2);
const valued = new Set(['--video', '--out', '--labels']);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
if (!files.length) {
  console.error(
    'usage: label-sheet <dataset.json | export.ndjson>... [--video file.mp4] [--out eval/sheets] [--labels eval/labels] [--strips]',
  );
  process.exit(2);
}
const video = flag('--video');
const outDir = flag('--out') ?? 'eval/sheets';
const labelDir = flag('--labels') ?? 'eval/labels';
const runStrips = args.includes('--strips');
if (runStrips && !video) {
  console.error('--strips needs --video');
  process.exit(2);
}

const records = files.flatMap((f) => parseLabelled(readFileSync(f, 'utf8')).map((j) => j.record));
const rows = sheetRows(records);
const videoIds = [...new Set(rows.map((r) => r.videoId))];
const safe = (s: string) => s.replace(/[^\w.-]/g, '_');
mkdirSync(outDir, { recursive: true });
mkdirSync(labelDir, { recursive: true });

for (const id of videoIds) {
  const mine = rows.filter((r) => r.videoId === id);
  const fileName = mine[0].fileName;
  // One video file given for a dataset of one video is that video; with several, the one whose name matches.
  const useVideo = video && (videoIds.length === 1 || basename(video) === fileName) ? video : undefined;
  const labelFile = `${labelDir}/${safe(id)}.json`;
  const stripDir = `${outDir}/${safe(id)}-strips`;

  // The label file: created blank, or completed with blank entries for new jumps.
  const entries = mine.map((r) => ({ apexS: r.apexS, jumpId: r.jumpId }));
  let added = entries.length;
  let file: LabelFile = blankLabelFile(id, fileName, entries);
  if (existsSync(labelFile)) {
    file = parseLabelFile(readFileSync(labelFile, 'utf8'));
    const fresh = entries.filter((e) => !file.jumps.some((l) => Math.abs(l.apexS - e.apexS) <= APEX_TOLERANCE_S));
    added = fresh.length;
    file.jumps = [...file.jumps, ...fresh.map((e) => blankLabel(e.apexS, e.jumpId))].sort((a, b) => a.apexS - b.apexS);
  }
  if (added || !existsSync(labelFile)) writeFileSync(labelFile, JSON.stringify(file, null, 2) + '\n');

  const base = `${outDir}/${safe(id)}`;
  writeFileSync(`${base}.md`, sheetMarkdown(mine, { video: useVideo, stripDir, labelFile }));
  writeFileSync(`${base}.csv`, sheetCsv(mine));
  const written = [`${base}.md`, `${base}.csv`];
  if (useVideo) {
    const script = [
      '#!/bin/sh',
      `mkdir -p '${stripDir}'`,
      ...mine.map((r) => filmstripCommand(r, useVideo, stripDir)),
    ].join('\n');
    writeFileSync(`${base}-strips.sh`, script + '\n');
    written.push(`${base}-strips.sh`);
    if (runStrips) {
      mkdirSync(stripDir, { recursive: true });
      for (const r of mine) {
        execFileSync('ffmpeg', filmstripArgs(r, useVideo, stripDir), { stdio: 'inherit' });
        console.log(stripPath(stripDir, r));
      }
    }
  }
  console.log(`${id} (${fileName}): ${mine.length} jumps`);
  console.log(`  labels: ${labelFile} (${added} blank entries added)`);
  console.log(`  sheet:  ${written.join(', ')}`);
}
