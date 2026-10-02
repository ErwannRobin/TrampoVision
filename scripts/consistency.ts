/**
 * Label-free quality of the rotation measurement, no labels needed.
 *   make eval-consistency FILE=eval/dong-dong.dataset.json     (a dataset JSON saved by the app, the review service's /export, or a saved pose series)
 *   make eval-consistency FILE=... BASELINE=eval/consistency.json     fails when a share fell
 *   make eval-consistency FILE=... SAVE=eval/consistency.json         records the current numbers as the baseline
 * A pose series (Save analysis in the advanced mode) is analyzed again with the current code, so two versions of the pipeline can be compared on the same video.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { computeAnalysis } from '../src/analysis/computeAnalysis';
import { SERIES_SCHEMA, parsePoseSeries } from '../src/analysis/timeSeries';
import {
  consistencyBaselineOf,
  consistencyOf,
  consistencyRegressions,
  formatConsistency,
  inputsFromAnalysis,
  inputsFromRecords,
  type ConsistencyBaseline,
  type ConsistencyInput,
} from '../src/eval/consistency';
import { parseLabelled } from '../src/eval/replay';
import { analyzeTwist } from '../src/pose3d/twist';
import { analyzeSkills } from '../src/skills/analyzeSkills';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find(
  (a) => !a.startsWith('--') && a !== flag('--baseline') && a !== flag('--save') && a !== flag('--json'),
);
if (!file) {
  console.error(
    'usage: consistency <dataset.json | export.ndjson | pose-series.json> [--baseline f.json] [--save f.json] [--json out.json]',
  );
  process.exit(2);
}

function isSeries(text: string): boolean {
  try {
    return (JSON.parse(text) as { schema?: string }).schema === SERIES_SCHEMA;
  } catch {
    return false; // an ndjson export is not one JSON document
  }
}

function load(text: string): { inputs: ConsistencyInput[]; title: string } {
  if (isSeries(text)) {
    const { track, calibration, settings } = parsePoseSeries(text);
    const result = computeAnalysis(track, {
      athleteHeightM: settings.athleteHeightM,
      scaleSource: settings.scaleSource,
      minVisibility: settings.minVisibility,
      calibration: calibration ?? undefined,
    });
    const twist = analyzeTwist({
      world: track.world,
      time: result.time,
      fps: result.meta.fps,
      cycles: result.jumps.cycles,
    });
    const skills = analyzeSkills(result, { twist });
    return { inputs: inputsFromAnalysis(skills, twist), title: 'Pose series analyzed again with the current code' };
  }
  return { inputs: inputsFromRecords(parseLabelled(text).map((j) => j.record)), title: 'Saved jumps' };
}

const { inputs, title } = load(readFileSync(file, 'utf8'));
const report = consistencyOf(inputs);
console.log(formatConsistency(title, report));

const jsonOut = flag('--json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
const save = flag('--save');
if (save) {
  writeFileSync(save, JSON.stringify(consistencyBaselineOf(report), null, 1));
  console.log(`\nBaseline saved to ${save}`);
}
const baselineFile = flag('--baseline');
if (baselineFile) {
  const { problems, notes } = consistencyRegressions(
    report,
    JSON.parse(readFileSync(baselineFile, 'utf8')) as ConsistencyBaseline,
  );
  for (const n of notes) console.log(`\nnote: ${n}`);
  if (problems.length) {
    console.error(`\nWORSE THAN THE BASELINE:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nNot worse than the baseline.');
}
