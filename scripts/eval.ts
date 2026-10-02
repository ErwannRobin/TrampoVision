/**
 * Scores the current classifier on reviewed jumps, offline.
 *   make eval-run FILE=eval/export.ndjson        (the review service's /export, or a dataset JSON saved by the app; several files are fine)
 *   make eval-run FILE=... BASELINE=eval/baseline.json     fails when a change made things worse
 *   make eval-run FILE=... SAVE=eval/baseline.json         records the current numbers as the baseline
 *   make eval-run FILE=... LABELS=eval/labels              also reads the stage labels written by hand (default: eval/labels when it exists)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyLabels, formatStageReport, parseLabelFile, runStageEval, type LabelFile } from '../src/eval/labels';
import { baselineOf, formatReport, parseLabelled, regressions, runEval, type Baseline } from '../src/eval/replay';

const args = process.argv.slice(2);
const valued = new Set(['--baseline', '--save', '--json', '--labels']);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));
if (!files.length) {
  console.error(
    'usage: eval <export.ndjson | dataset.json>... [--baseline f.json] [--save f.json] [--json out.json] [--labels dir]',
  );
  process.exit(2);
}

let jumps = files.flatMap((f) => parseLabelled(readFileSync(f, 'utf8')));

const labelDir = flag('--labels') ?? 'eval/labels';
if (existsSync(labelDir)) {
  const labelFiles: LabelFile[] = readdirSync(labelDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return parseLabelFile(readFileSync(`${labelDir}/${f}`, 'utf8'));
      } catch (e) {
        console.error(`${labelDir}/${f}: ${e instanceof Error ? e.message : e}`);
        process.exit(2);
      }
    });
  const applied = applyLabels(jumps, labelFiles);
  jumps = applied.jumps;
  const stated = jumps.filter((j) => j.stages).length;
  console.log(
    `Labels from ${labelDir}: ${labelFiles.length} files, ${applied.matched} jumps matched (${stated} with stage labels, ${applied.blank} still blank), ${applied.unmatched.length} labels without a jump`,
  );
  for (const u of applied.unmatched.slice(0, 10))
    console.log(`  no jump for ${u.videoId} at ${u.label.apexS.toFixed(2)} s`);
  console.log('');
} else if (flag('--labels')) {
  console.error(`${labelDir} does not exist`);
  process.exit(2);
}

const models = runEval(jumps, { references: 'none' });
const withExamples = runEval(jumps, { references: 'leave-one-video-out' });
const stageModels = runStageEval(jumps, { references: 'none' });
const stageExamples = runStageEval(jumps, { references: 'leave-one-video-out' });
console.log(formatReport('Expected movements of the table only', models));
console.log('');
console.log(formatStageReport('Stages, expected movements of the table only', stageModels));
console.log('');
console.log(
  formatReport('With the reviewed jumps of the other videos as examples (leave one video out)', withExamples),
);
console.log('');
console.log(formatStageReport('Stages, with the reviewed jumps of the other videos as examples', stageExamples));

const jsonOut = flag('--json');
if (jsonOut)
  writeFileSync(
    jsonOut,
    JSON.stringify({ models, withExamples, stages: { models: stageModels, withExamples: stageExamples } }, null, 1),
  );
const save = flag('--save');
if (save) {
  writeFileSync(save, JSON.stringify({ models: baselineOf(models), withExamples: baselineOf(withExamples) }, null, 1));
  console.log(`\nBaseline saved to ${save}`);
}
const baselineFile = flag('--baseline');
if (baselineFile) {
  const base = JSON.parse(readFileSync(baselineFile, 'utf8')) as { models: Baseline; withExamples: Baseline };
  const problems = [
    ...regressions(models, base.models).map((p) => `table only: ${p}`),
    ...regressions(withExamples, base.withExamples).map((p) => `with examples: ${p}`),
  ];
  if (problems.length) {
    console.error(`\nWORSE THAN THE BASELINE:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nNot worse than the baseline.');
}
