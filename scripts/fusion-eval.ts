/**
 * Replays the check of the pose and the merge of two pose models offline, from two saved analyses of the same clip (Save analysis in
 * the advanced mode): one by MediaPipe, one by the second model read on every frame. The check (analysis/poseCheck.ts) picks the
 * frames the second model would have read again, the merge (pose/fusion.ts) builds the track, and the label-free rotation checks
 * compare the three.
 *   make eval-fusion FIRST=mediapipe.json SECOND=rtmpose.json        [ALL=1: merge every frame, not only the doubtful ones]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { checkPose, DOUBTS } from '../src/analysis/poseCheck';
import { computeAnalysis } from '../src/analysis/computeAnalysis';
import { parsePoseSeries, type ParsedSeries } from '../src/analysis/timeSeries';
import type { PoseTrack } from '../src/analysis/types';
import { consistencyOf, inputsFromAnalysis } from '../src/eval/consistency';
import { FUSED_FROM, fusePoseTracks } from '../src/pose/fusion';
import { HALPE26 } from '../src/pose/onnx/keypointMaps';
import { analyzeTwist } from '../src/pose3d/twist';
import { analyzeSkills } from '../src/skills/analyzeSkills';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [firstFile, secondFile] = args.filter(
  (a, i) => !a.startsWith('--') && !['--json', '--opt'].includes(args[i - 1] ?? ''),
);
if (!firstFile || !secondFile) {
  console.error('usage: fusion-eval <first.json> <second.json> [--all] [--json fused-series.json]');
  process.exit(2);
}
const all = args.includes('--all');

const load = (f: string): ParsedSeries => parsePoseSeries(readFileSync(f, 'utf8'));
const a = load(firstFile);
const b = load(secondFile);
if (a.track.frames.length !== b.track.frames.length)
  throw new Error(
    `the two analyses have ${a.track.frames.length} and ${b.track.frames.length} frames: not the same clip or stride`,
  );

const settings = { athleteHeightM: a.settings.athleteHeightM, scaleSource: a.settings.scaleSource } as const;

function measure(name: string, track: PoseTrack): void {
  const result = computeAnalysis(track, settings);
  const twist = analyzeTwist({
    world: track.world,
    time: result.time,
    fps: result.meta.fps,
    cycles: result.jumps.cycles,
  });
  const skills = analyzeSkills(result, { twist });
  const report = consistencyOf(inputsFromAnalysis(skills, twist));
  const seen = track.frames.filter(Boolean).length;
  const flight = new Set<number>();
  for (const c of result.jumps.cycles)
    if (c.takeoff !== null && c.landing !== null) for (let f = c.takeoff; f <= c.landing; f++) flight.add(f);
  const inFlight = [...flight].filter((f) => track.frames[f]).length;
  const turns = result.jumps.cycles.map((c) => (c.rotationDeg === null ? NaN : c.rotationDeg / 360));
  const pct = (s: number | null) => (s === null ? '–' : `${Math.round(s * 100)}%`);
  console.log(
    `${name.padEnd(8)} athlete ${seen}/${track.frames.length}  jumps ${result.jumps.cycles.length}  flight frames with athlete ${inFlight}/${flight.size}  ` +
      `flips ${result.meta.orientationFlippedFrames}  rotating ${report.rotating}  clean ${report.clean.pass}/${report.clean.n}  ` +
      `monotonic ${pct(report.checks.monotonic.share)} noFlip ${pct(report.checks.noFlip.share)} crossCheck ${pct(report.checks.crossCheck.share)} onGrid ${pct(report.checks.onGrid.share)} twist ${pct(report.checks.twist.share)}  ` +
      `turns [${turns.map((t) => t.toFixed(2)).join(' ')}]`,
  );
}

const first = a.track;
const check = checkPose(first, computeAnalysis(first, settings));
const checked = all ? new Uint8Array(first.frames.length).fill(1) : check.frames;
console.log(`${firstFile.split('/').pop()} + ${secondFile.split('/').pop()}`);
console.log(
  `check: ${check.flights.filter((f) => f.doubts.length).length}/${check.flights.length} flights doubtful, ${check.lostFrames} frames lost near the athlete, ${check.count}/${first.frames.length} frames to read again${all ? ' (merging all of them: --all)' : ''}`,
);
for (const d of DOUBTS) {
  const flights = check.flights.filter((f) => f.doubts.includes(d));
  if (flights.length) console.log(`  ${d.padEnd(10)} ${flights.map((f) => f.jump + 1).join(' ')}`);
}

// --opt key=value,key=value: fusion options to try (numbers).
const tried = Object.fromEntries(
  (flag('--opt') ?? '')
    .split(',')
    .filter(Boolean)
    .map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])]),
);
const fused = fusePoseTracks(
  {
    first: first.frames,
    firstWorld: first.world,
    second: b.track.frames,
    checked,
    secondJoints: HALPE26.filter((k) => k >= 0),
  },
  tried,
);
const c = fused.counts;
console.log(
  `merge: ${c.checked} checked → both ${c.both}, first kept ${c.first}, second ${c.second} (over a first reading ${c.replaced}), dropped ${c.dropped}, none ${c.none}`,
);
const fusedTrack: PoseTrack = {
  ...first,
  frames: fused.frames,
  world: fused.world,
  backend: `${first.backend} + ${b.track.backend}`,
};
measure('first', first);
measure('second', b.track);
measure('fused', fusedTrack);

const out = flag('--json');
if (out) {
  writeFileSync(
    out,
    JSON.stringify({ from: Array.from(fused.from), names: Object.keys(FUSED_FROM), counts: fused.counts }, null, 0),
  );
}
