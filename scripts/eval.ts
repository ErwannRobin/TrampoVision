/**
 * Scores the current classifier on reviewed jumps, offline.
 *   make eval FILE=eval/export.ndjson        (the review service's /export, or a dataset JSON saved by the app)
 *   make eval FILE=... BASELINE=eval/baseline.json     fails when a change made things worse
 *   make eval FILE=... SAVE=eval/baseline.json         records the current numbers as the baseline
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { baselineOf, formatReport, parseLabelled, regressions, runEval, type Baseline } from '../src/eval/replay';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find(
  (a) => !a.startsWith('--') && a !== flag('--baseline') && a !== flag('--save') && a !== flag('--json'),
);
if (!file) {
  console.error('usage: eval <export.ndjson | dataset.json> [--baseline f.json] [--save f.json] [--json out.json]');
  process.exit(2);
}

const jumps = parseLabelled(readFileSync(file, 'utf8'));
const models = runEval(jumps, { references: 'none' });
const withExamples = runEval(jumps, { references: 'leave-one-video-out' });
console.log(formatReport('Expected movements of the table only', models));
console.log('');
console.log(
  formatReport('With the reviewed jumps of the other videos as examples (leave one video out)', withExamples),
);

const jsonOut = flag('--json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ models, withExamples }, null, 1));
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
