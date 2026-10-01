import type { JumpRecord } from '../dataset/types';

/**
 * A labeling sheet: one line per detected jump with what the app measured and guessed, and the command that makes a filmstrip of the
 * jump, so a person can look at a flight and write down what it was in `eval/labels/<videoId>.json` (see `labels.ts`).
 */

export interface SheetRow {
  videoId: string;
  jumpId: number;
  fileName: string;
  takeoffS: number | null;
  apexS: number;
  landingS: number | null;
  flightS: number | null;
  guess: string;
  confidence: number;
  rotationTurns: number | null;
  rotationConfidence: number;
  facingConfidence: number;
  twistConfidence: number | null;
  poseQuality: number;
}

export function sheetRows(records: readonly JumpRecord[]): SheetRow[] {
  return records
    .map<SheetRow>((r) => ({
      videoId: r.videoId,
      jumpId: r.jumpId,
      fileName: r.source.fileName,
      takeoffS: r.timestamps.takeoffS,
      apexS: r.timestamps.apexS,
      landingS: r.timestamps.landingS,
      flightS: r.timestamps.flightTimeS,
      guess: r.prediction.label,
      confidence: r.prediction.confidence,
      rotationTurns: r.features.rotation.turns,
      rotationConfidence: r.features.rotation.confidence,
      facingConfidence: r.features.facing.confidence,
      twistConfidence: r.twist?.estimate.available ? r.twist.estimate.confidence : null,
      poseQuality: r.features.quality.pose,
    }))
    .sort((a, b) => a.videoId.localeCompare(b.videoId) || a.apexS - b.apexS);
}

const num = (v: number | null, digits = 2) => (v === null || !Number.isFinite(v) ? '' : v.toFixed(digits));

const COLUMNS: [string, (r: SheetRow) => string][] = [
  ['video', (r) => r.videoId],
  ['jump', (r) => String(r.jumpId)],
  ['takeoff_s', (r) => num(r.takeoffS, 3)],
  ['apex_s', (r) => num(r.apexS, 3)],
  ['landing_s', (r) => num(r.landingS, 3)],
  ['flight_s', (r) => num(r.flightS)],
  ['guess', (r) => r.guess],
  ['guess_confidence', (r) => num(r.confidence)],
  ['rotation_turns', (r) => num(r.rotationTurns)],
  ['rotation_confidence', (r) => num(r.rotationConfidence)],
  ['facing_confidence', (r) => num(r.facingConfidence)],
  ['twist_confidence', (r) => num(r.twistConfidence)],
  ['pose_quality', (r) => num(r.poseQuality)],
];

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const sheetCsv = (rows: readonly SheetRow[]): string =>
  [COLUMNS.map(([h]) => h).join(','), ...rows.map((r) => COLUMNS.map(([, f]) => csvCell(f(r))).join(','))].join('\n') +
  '\n';

/** Shell quoting for a path or a filter inside a command line. */
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Frames of a filmstrip: 12 in 6 columns. */
const STRIP_FRAMES = 12;

/** The file a jump's filmstrip is written to, under `dir`. */
export const stripPath = (dir: string, r: SheetRow) => `${dir}/${r.videoId}-j${String(r.jumpId).padStart(2, '0')}.png`;

/**
 * The ffmpeg arguments that tile the flight of a jump (a little before the takeoff to a little after the landing) into one picture.
 * A jump cut off by the clip uses a window of two seconds around its apex.
 */
export function filmstripArgs(r: SheetRow, video: string, dir: string): string[] {
  const from = r.takeoffS !== null ? r.takeoffS - 0.1 : r.apexS - 1;
  const to = r.landingS !== null ? r.landingS + 0.1 : r.apexS + 1;
  const start = Math.max(0, from);
  const length = Math.max(0.2, to - start);
  const fps = STRIP_FRAMES / length;
  return [
    '-v',
    'error',
    '-y',
    '-ss',
    start.toFixed(3),
    '-t',
    length.toFixed(3),
    '-i',
    video,
    '-vf',
    `fps=${fps.toFixed(3)},scale=320:-1,tile=6x${STRIP_FRAMES / 6}`,
    '-frames:v',
    '1',
    stripPath(dir, r),
  ];
}

/** The same as a command line. */
export const filmstripCommand = (r: SheetRow, video: string, dir: string): string =>
  ['ffmpeg', ...filmstripArgs(r, video, dir).map((a) => (/^[\w./:=,-]+$/.test(a) ? a : quote(a)))].join(' ');

export function sheetMarkdown(
  rows: readonly SheetRow[],
  opts: { video?: string; stripDir?: string; labelFile: string },
): string {
  const out: string[] = [];
  const video = rows[0]?.videoId ?? '';
  out.push(
    `# Labeling sheet: ${video}${rows[0]?.fileName ? ` (${rows[0].fileName})` : ''}`,
    '',
    `Fill in \`${opts.labelFile}\` (one entry per jump, matched by \`apexS\`). Leave a field null when you cannot say; set \`cannotTell\` or \`badSegmentation\` instead of guessing.`,
    '',
    '| jump | takeoff | apex | landing | flight | guess | conf | rotation (turns) | rot. conf | facing conf | twist conf |',
    '| ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const r of rows)
    out.push(
      `| ${r.jumpId} | ${num(r.takeoffS)} | ${num(r.apexS)} | ${num(r.landingS)} | ${num(r.flightS)} | ${r.guess} | ${num(r.confidence)} | ${num(r.rotationTurns)} | ${num(r.rotationConfidence)} | ${num(r.facingConfidence)} | ${num(r.twistConfidence)} |`,
    );
  if (opts.video && opts.stripDir) {
    out.push(
      '',
      '## Filmstrips',
      '',
      'One picture per jump (12 frames from just before the takeoff to just after the landing):',
      '',
      '```sh',
    );
    out.push(`mkdir -p ${quote(opts.stripDir)}`);
    for (const r of rows) out.push(filmstripCommand(r, opts.video, opts.stripDir));
    out.push('```');
  } else {
    out.push('', 'Pass `--video <file>` to get the ffmpeg commands that make a filmstrip of each jump.');
  }
  return out.join('\n') + '\n';
}
