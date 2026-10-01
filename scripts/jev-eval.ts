/**
 * Jev against the current classifier on reviewed jumps, offline. Only measurements are sent to Jev, never a video.
 *   TYPESAFE_API_KEY=... make jev-eval FILE=eval/export.ndjson [DEBUG=1]
 * Options: --debug (signature, top 5, reason and final element of every jump), --examples (give the local classifier the reviewed
 * jumps of the other videos too), --json out.json. Without a key, Jev is skipped and the local answer is the fallback.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatCompare, runJevCompare } from '../src/eval/jevCompare';
import { parseLabelled } from '../src/eval/replay';
import { formatJevDebug } from '../src/skills/jev/classify';
import { JEV_BASE_URL } from '../src/skills/jev/client';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a) => !a.startsWith('--') && a !== flag('--json'));
if (!file) {
  console.error('usage: jev-eval <export.ndjson | dataset.json> [--debug] [--examples] [--json out.json]');
  process.exit(2);
}
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) console.error('TYPESAFE_API_KEY is not set: Jev is skipped and the local classifier is the fallback.\n');

const debug = args.includes('--debug');
const rows = await runJevCompare(parseLabelled(readFileSync(file, 'utf8')), {
  client: apiKey ? { apiKey, baseUrl: process.env.TYPESAFE_BASE_URL ?? JEV_BASE_URL } : null,
  references: args.includes('--examples') ? 'leave-one-video-out' : 'none',
  onRow: debug ? (r) => console.log(`--- ${r.id} (truth ${r.truth})\n${formatJevDebug(r.result)}\n`) : undefined,
});
console.log(formatCompare(rows));
const out = flag('--json');
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      rows.map(({ result, ...r }) => ({ ...r, state: result.state, answers: result.answers })),
      null,
      1,
    ),
  );
  console.log(`\nRows saved to ${out}`);
}
